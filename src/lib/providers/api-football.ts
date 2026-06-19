// ── api-football adapter (API-SPORTS family) ────────────────────────────
// Direct API-SPORTS host (dashboard.api-football.com): auth via `x-apisports-key`.
// Maps api-football's league+season model onto the neutral provider shapes and
// derives a single composite `rating` from a recency-weighted window of recent
// seasons (≈ "last ~100 matches", assembled from cheap season aggregates rather
// than per-fixture pulls that would shred the rate limit).

import type {
  ProviderClub,
  ProviderConfig,
  ProviderEvent,
  ProviderFixturePlayerStat,
  ProviderLeague,
  ProviderPlayer,
  SportsProvider,
} from "./types";

// ── Minimal shapes for the bits of the API we consume ────────────────────
type ApiResponse<T> = {
  response: T[];
  paging?: { current: number; total: number };
  errors?: unknown;
};

type LeagueEntry = {
  league: { id: number; name: string; type?: string; logo?: string };
  country?: { name?: string };
  seasons?: { year: number }[];
};
type TeamEntry = { team: { id: number; name: string; logo?: string } };
type PlayerEntry = {
  player: { id: number; name: string };
  statistics: {
    team?: { id: number; name: string };
    games?: {
      appearences?: number | null;
      minutes?: number | null;
      position?: string | null;
      rating?: string | null;
    };
    goals?: { total?: number | null; assists?: number | null };
  }[];
};
type FixtureEntry = {
  fixture: { id: number; date: string; status?: { short?: string } };
  teams: { home?: { name?: string }; away?: { name?: string } };
  goals: { home?: number | null; away?: number | null };
};
type SquadPlayer = { id: number; name: string; position?: string | null };
type SquadEntry = { team: { id: number; name: string }; players: SquadPlayer[] };
// fixtures/players: per-team blocks, each with its players' fixture stat lines.
type FixturePlayersEntry = {
  team: { id: number; name: string };
  players: {
    player: { id: number; name: string };
    statistics: {
      games?: { minutes?: number | null };
      shots?: { on?: number | null };
      goals?: { total?: number | null; assists?: number | null; saves?: number | null };
      penalty?: { saved?: number | null };
      cards?: { yellow?: number | null; red?: number | null };
    }[];
  }[];
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const POSITION_MAP: Record<string, string> = {
  Goalkeeper: "GK",
  Defender: "DEF",
  Midfielder: "MID",
  Attacker: "FWD",
};

// Per-position attacking weights for the rating bonus (goals/assists per game).
const ATTACK_WEIGHTS: Record<string, { g: number; a: number }> = {
  GK: { g: 0, a: 0 },
  DEF: { g: 4, a: 3 },
  MID: { g: 6, a: 5 },
  FWD: { g: 8, a: 4 },
};

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

type SeasonStat = {
  weight: number;
  rating: number | null;
  goals: number;
  assists: number;
  apps: number;
  position: string | null;
};

export class ApiFootballProvider implements SportsProvider {
  readonly key = "api-football";
  private readonly host: string;
  private readonly apiKey: string;
  private readonly ratingSeasons: number;

  constructor(config: ProviderConfig = {}) {
    this.host = config.host ?? process.env.API_FOOTBALL_HOST ?? "v3.football.api-sports.io";
    this.apiKey = process.env.API_FOOTBALL_KEY ?? "";
    this.ratingSeasons = Math.max(1, config.ratingSeasons ?? 2);
    if (!this.apiKey) throw new Error("Missing API_FOOTBALL_KEY");
  }

  // ── HTTP ────────────────────────────────────────────────────────────────
  private async get<T>(path: string, params: Record<string, string | number>): Promise<ApiResponse<T>> {
    const url = new URL(`https://${this.host}/${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

    // Retry on rate-limit (429) with backoff — the heavy squad/club-form seed
    // can brush the per-minute cap.
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, { headers: { "x-apisports-key": this.apiKey } });
      if (res.status === 429) {
        if (attempt >= 6) throw new Error(`api-football ${path} → HTTP 429 (gave up)`);
        const retryAfter = Number(res.headers.get("retry-after"));
        const wait = (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 2 ** attempt) * 1000;
        await sleep(wait + 250);
        continue;
      }
      if (!res.ok) throw new Error(`api-football ${path} → HTTP ${res.status}`);
      const json = (await res.json()) as ApiResponse<T>;
      // api-football also signals rate limits in the body's errors object.
      const errObj = json.errors;
      const rateLimited =
        errObj && !Array.isArray(errObj) && typeof errObj === "object" && "rateLimit" in errObj;
      if (rateLimited) {
        if (attempt >= 6) throw new Error(`api-football ${path} → rate limited (gave up)`);
        await sleep(2 ** attempt * 1000 + 250);
        continue;
      }
      const errCount = Array.isArray(errObj) ? errObj.length : errObj ? Object.keys(errObj).length : 0;
      if (errCount > 0) throw new Error(`api-football ${path} → ${JSON.stringify(errObj)}`);
      return json;
    }
  }

  /** Fetch every page of a paginated endpoint. */
  private async getAllPages<T>(path: string, params: Record<string, string | number>): Promise<T[]> {
    const first = await this.get<T>(path, { ...params, page: 1 });
    const out = [...first.response];
    const total = first.paging?.total ?? 1;
    for (let page = 2; page <= total; page++) {
      const next = await this.get<T>(path, { ...params, page });
      out.push(...next.response);
    }
    return out;
  }

  // ── Discovery ─────────────────────────────────────────────────────────────
  async searchLeagues(query: string): Promise<ProviderLeague[]> {
    const { response } = await this.get<LeagueEntry>("leagues", { search: query });
    return response.map((e) => ({
      externalRef: String(e.league.id),
      name: e.league.name,
      country: e.country?.name ?? null,
      logo: e.league.logo ?? null,
      type: e.league.type ?? null,
      seasons: (e.seasons ?? []).map((s) => s.year).sort((a, b) => a - b),
    }));
  }

  async getSeasons(leagueRef: string): Promise<number[]> {
    const { response } = await this.get<LeagueEntry>("leagues", { id: leagueRef });
    const seasons = response[0]?.seasons ?? [];
    return seasons.map((s) => s.year).sort((a, b) => a - b);
  }

  // ── Clubs (chunk units) ──────────────────────────────────────────────────
  async getClubs(leagueRef: string, season: number): Promise<ProviderClub[]> {
    const { response } = await this.get<TeamEntry>("teams", { league: leagueRef, season });
    return response.map((e) => ({
      externalRef: String(e.team.id),
      name: e.team.name,
      logo: e.team.logo ?? null,
    }));
  }

  // ── Players ───────────────────────────────────────────────────────────────
  // Prefer in-tournament/league stats. For an upcoming/ongoing tournament whose
  // aggregated player stats aren't published yet (e.g. a World Cup mid-event),
  // fall back to the squad list + a rating derived from each player's recent
  // CLUB form — so the pool is the real squad with meaningful ratings.
  async getPlayers(leagueRef: string, season: number, club: ProviderClub): Promise<ProviderPlayer[]> {
    const withStats = await this.getPlayersWithStats(leagueRef, season, club);
    if (withStats.length > 0) return withStats;
    return this.getPlayersFromSquads(season, club);
  }

  // Standard path: rating from the competition's own season stats, recency-
  // weighted across the rating window.
  private async getPlayersWithStats(
    leagueRef: string,
    season: number,
    club: ProviderClub,
  ): Promise<ProviderPlayer[]> {
    // Aggregate each player across the rating window, keyed by player id.
    // Weight: most recent season 1.0, then ×0.6 per season back.
    const agg = new Map<string, { name: string; seasons: SeasonStat[] }>();

    for (let i = 0; i < this.ratingSeasons; i++) {
      const yr = season - i;
      const weight = Math.pow(0.6, i);
      let entries: PlayerEntry[];
      try {
        entries = await this.getAllPages<PlayerEntry>("players", {
          league: leagueRef,
          season: yr,
          team: club.externalRef,
        });
      } catch {
        continue; // a missing/empty season in the window is fine
      }

      for (const e of entries) {
        const id = String(e.player.id);
        const stat = e.statistics?.[0];
        const games = stat?.games ?? {};
        const season_stat: SeasonStat = {
          weight,
          rating: games.rating ? Number(games.rating) : null,
          goals: stat?.goals?.total ?? 0,
          assists: stat?.goals?.assists ?? 0,
          apps: games.appearences ?? 0,
          position: games.position ? POSITION_MAP[games.position] ?? null : null,
        };
        const existing = agg.get(id);
        if (existing) existing.seasons.push(season_stat);
        else agg.set(id, { name: e.player.name, seasons: [season_stat] });
      }
    }

    return [...agg.entries()].map(([id, v]) => {
      const position = v.seasons.find((s) => s.position)?.position ?? null;
      return {
        externalRef: id,
        name: v.name,
        position,
        clubExternalRef: club.externalRef,
        clubName: club.name,
        rating: deriveRating(v.seasons, position),
        stats: { seasons: v.seasons },
      } satisfies ProviderPlayer;
    });
  }

  // Cold-start path: real squad list + rating from each player's recent club
  // form (most recent completed club season in the window with data).
  private async getPlayersFromSquads(season: number, club: ProviderClub): Promise<ProviderPlayer[]> {
    let squad: SquadPlayer[];
    try {
      const { response } = await this.get<SquadEntry>("players/squads", { team: club.externalRef });
      squad = response?.[0]?.players ?? [];
    } catch {
      return [];
    }

    const out: ProviderPlayer[] = [];
    for (const sp of squad) {
      const position = sp.position ? POSITION_MAP[sp.position] ?? null : null;
      const { rating, season: ratedSeason, stat } = await this.clubFormRating(String(sp.id), season, position);
      out.push({
        externalRef: String(sp.id),
        name: sp.name,
        position,
        clubExternalRef: club.externalRef,
        clubName: club.name,
        rating,
        stats: { source: "squad", clubFormSeason: ratedSeason, stat },
      });
      await sleep(150); // stay clear of the per-minute rate limit
    }
    return out;
  }

  // Rate a player from their most recent completed club season that has data.
  private async clubFormRating(
    playerId: string,
    season: number,
    position: string | null,
  ): Promise<{ rating: number; season: number | null; stat: SeasonStat | null }> {
    for (let i = 1; i <= this.ratingSeasons; i++) {
      const yr = season - i;
      let stats: PlayerEntry["statistics"];
      try {
        const { response } = await this.get<PlayerEntry>("players", { id: playerId, season: yr });
        stats = response?.[0]?.statistics ?? [];
      } catch {
        continue;
      }
      // The club where they played the most that season is the form signal.
      let best: PlayerEntry["statistics"][number] | null = null;
      for (const s of stats) {
        if (!best || (s.games?.appearences ?? 0) > (best.games?.appearences ?? 0)) best = s;
      }
      if (best && (best.games?.appearences ?? 0) > 0) {
        const stat: SeasonStat = {
          weight: 1,
          rating: best.games?.rating ? Number(best.games.rating) : null,
          goals: best.goals?.total ?? 0,
          assists: best.goals?.assists ?? 0,
          apps: best.games?.appearences ?? 0,
          position,
        };
        return { rating: deriveRating([stat], position), season: yr, stat };
      }
    }
    return { rating: 62, season: null, stat: null }; // no recent club data
  }

  // ── Fixtures ──────────────────────────────────────────────────────────────
  async getFixtures(leagueRef: string, season: number): Promise<ProviderEvent[]> {
    const { response } = await this.get<FixtureEntry>("fixtures", { league: leagueRef, season });
    return response.map((e) => ({
      externalRef: String(e.fixture.id),
      label: `${e.teams.home?.name ?? "?"} vs ${e.teams.away?.name ?? "?"}`,
      startsAt: e.fixture.date ?? null,
      status: e.fixture.status?.short ?? null,
      result: {
        home: { name: e.teams.home?.name ?? null, goals: e.goals.home ?? null },
        away: { name: e.teams.away?.name ?? null, goals: e.goals.away ?? null },
      },
    }));
  }

  // ── Per-fixture player stats (scoring feed) ───────────────────────────────
  // One call per fixture. shots.on already includes goals (the scoring engine
  // nets goals out for the non-scoring SoT bonus). minutes drives appearance +
  // the 60' gates for clean sheets / conceded.
  async getFixturePlayerStats(fixtureRef: string): Promise<ProviderFixturePlayerStat[]> {
    const { response } = await this.get<FixturePlayersEntry>("fixtures/players", {
      fixture: fixtureRef,
    });
    const out: ProviderFixturePlayerStat[] = [];
    for (const team of response) {
      for (const pl of team.players ?? []) {
        const s = pl.statistics?.[0];
        if (!s) continue;
        out.push({
          playerExternalRef: String(pl.player.id),
          minutes: s.games?.minutes ?? 0,
          goals: s.goals?.total ?? 0,
          assists: s.goals?.assists ?? 0,
          shotsOn: s.shots?.on ?? 0,
          red: s.cards?.red ?? 0,
          yellow: s.cards?.yellow ?? 0,
          penaltySaved: s.penalty?.saved ?? 0,
        });
      }
    }
    return out;
  }
}

// ── Composite, position-aware rating → ~40–95 scalar ─────────────────────
// Small samples are shrunk toward a neutral mean so a player with two great
// games doesn't outrank a season-long star (Bayesian-style regression).
const RATING_REF = 6.7; // typical avg match rating
const SHRINK_K = 12; // appearances at which ~half the signal is trusted

export function deriveRating(seasons: SeasonStat[], position: string | null): number {
  const totalW = seasons.reduce((s, x) => s + x.weight, 0);
  if (totalW === 0) return 62;

  // Weighted average match rating across seasons that report one.
  const rated = seasons.filter((s) => s.rating != null);
  const ratingW = rated.reduce((s, x) => s + x.weight, 0);
  const avgRating =
    ratingW > 0 ? rated.reduce((s, x) => s + (x.rating as number) * x.weight, 0) / ratingW : null;

  // Weighted per-appearance production.
  const apps = seasons.reduce((s, x) => s + x.apps * x.weight, 0);
  const goals = seasons.reduce((s, x) => s + x.goals * x.weight, 0);
  const assists = seasons.reduce((s, x) => s + x.assists * x.weight, 0);
  const goalsPer = apps > 0 ? goals / apps : 0;
  const assistsPer = apps > 0 ? assists / apps : 0;

  // Shrink toward the mean by sample size: few apps ⇒ rating stays near neutral.
  const totalApps = seasons.reduce((s, x) => s + x.apps, 0);
  const shrink = totalApps / (totalApps + SHRINK_K); // 0..1

  const w = ATTACK_WEIGHTS[position ?? ""] ?? ATTACK_WEIGHTS.MID;
  const productionBonus = clamp(goalsPer * w.g + assistsPer * w.a, 0, 8) * shrink;

  // Availability nudge for genuine regulars / clear fringe players.
  const availabilityAdj = totalApps >= 25 ? 2 : totalApps <= 3 ? -2 : 0;

  // Match-rating signal shrunk toward RATING_REF; no signal ⇒ neutral baseline.
  const base =
    avgRating != null
      ? 40 + (RATING_REF + (avgRating - RATING_REF) * shrink - 5) * 17
      : 60;

  return Math.round(clamp(base + productionBonus + availabilityAdj, 40, 95));
}
