// ── Sports-data provider abstraction ────────────────────────────────────
// One adapter per data source (api-football now; handball/F1/golf later).
// The seeding pipeline talks only to this interface, so adding a sport is an
// adapter + a `sports` row — never a change to the seeder or the draft engine.
//
// Every adapter normalizes its source into these neutral shapes:
//  - positions map to the sport's roster-template codes (football: GK/DEF/MID/FWD)
//  - `rating` is a single derived scalar (~40–99); HOW it's derived is the
//    adapter's business (football: composite form; F1: points; golf: ranking)
//  - `stats` carries the raw provider payload so rating can be recomputed later.

export type ProviderLeague = {
  externalRef: string;
  name: string;
  country?: string | null;
  logo?: string | null;
  type?: string | null; // "League" | "Cup"
  seasons: number[]; // available seasons, ascending
};

export type ProviderClub = {
  externalRef: string;
  name: string;
  logo?: string | null;
};

export type ProviderPlayer = {
  externalRef: string;
  name: string;
  position: string | null; // mapped roster-template code, null = positionless
  clubExternalRef: string;
  clubName: string;
  rating: number; // derived scalar, normalized ~40–99
  stats: unknown; // raw provider payload (stored in players.stats)
};

export type ProviderEvent = {
  externalRef: string;
  label: string;
  startsAt: string | null; // ISO
  status: string | null;
  result: unknown; // sport-shaped payload (football: home/away + score)
};

/** A player's real raw stat line for a single fixture (the scoring seam). */
export type ProviderFixturePlayerStat = {
  playerExternalRef: string;
  minutes: number;
  goals: number;
  assists: number;
  shotsOn: number; // shots on target — INCLUDES goals
  red: number;
  yellow: number;
  penaltySaved: number;
};

export interface SportsProvider {
  /** Provider key, matches `competitions.provider` / `sports.provider`. */
  readonly key: string;

  /** Search the catalog (admin discovery). */
  searchLeagues(query: string): Promise<ProviderLeague[]>;

  /** Seasons available for a league (admin season dropdown). */
  getSeasons(leagueRef: string): Promise<number[]>;

  /** Clubs / national sides in a league-season (the seed's chunk units). */
  getClubs(leagueRef: string, season: number): Promise<ProviderClub[]>;

  /** Players for one club, with positions + a derived rating. */
  getPlayers(
    leagueRef: string,
    season: number,
    club: ProviderClub,
  ): Promise<ProviderPlayer[]>;

  /** Fixtures / events for a league-season (seeded into `events`). */
  getFixtures(leagueRef: string, season: number): Promise<ProviderEvent[]>;

  /**
   * Real per-player raw stats for one (finished) fixture — the scoring feed.
   * Optional: a provider/sport without per-fixture player data simply omits it
   * (the season then relies on the simulation fallback).
   */
  getFixturePlayerStats?(
    fixtureRef: string,
  ): Promise<ProviderFixturePlayerStat[]>;
}

/** Config persisted on the `sports` row (sports.provider_config). */
export type ProviderConfig = {
  host?: string;
  ratingSeasons?: number; // how many recent seasons feed the rating window
  [k: string]: unknown;
};
