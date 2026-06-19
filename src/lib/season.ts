// ── Season domain logic ────────────────────────────────────────────────
// Pure functions, no I/O — shared by the season room UI and MIRRORED by the
// SQL RPCs (default_lineup / set_lineup / play_round in the season migration).
// Keep these rules in sync with that SQL, same contract as draft.ts ↔ SQL.
//
// Scoring itself runs server-side (simulated in play_round); the client only
// READS player_scores / team_rounds. What lives here is the lineup math
// (validation + the default best-XI split), the formation contract, and the
// standings/timeline derivations the views render.

import {
  type Position,
  type RosterTemplate,
  type Formation,
  POSITIONS,
  SQUAD_QUOTA,
  formationsOf,
  formationByName,
  DEFAULT_FORMATION,
} from "./draft";

// ── Lineup shape (mirror of team_rounds.lineup JSONB) ────────────────────
// `formation` is the XI shape the manager picked (e.g. "4-4-2"). Older rows
// without it default to DEFAULT_FORMATION.
export type Lineup = { xi: string[]; bench: string[]; formation: string };

/** A squad player with the fields lineup/standings math needs. */
export type SquadPlayer = {
  id: string;
  position: Position | null;
  rating: number;
};

// ── Per-player round performance (mirror of player_scores.stats) ─────────
// Raw event counts (what the player actually did) plus the team-level context
// (gf/ga/won/clean) used by the scoring formula. Both the real feed and the
// offline sim fill this; the UI re-derives the points breakdown from it via
// scorePlayerMatch() in scoring.ts.
export type PlayerRoundStats = {
  played: boolean;
  minutes?: number;
  goals?: number;
  assists?: number;
  shots_on?: number;
  red?: number;
  yellow?: number;
  pen_saved?: number;
  gf?: number;
  ga?: number;
  won?: boolean;
  clean?: boolean;
};

/** Map stored player_scores.stats → the PlayerMatchRaw scoring input. */
export function rawFromStats(s: PlayerRoundStats): {
  minutes: number;
  goals: number;
  assists: number;
  shotsOn: number;
  red: number;
  yellow: number;
  penaltySaved: number;
} {
  return {
    minutes: s.minutes ?? 0,
    goals: s.goals ?? 0,
    assists: s.assists ?? 0,
    shotsOn: s.shots_on ?? 0,
    red: s.red ?? 0,
    yellow: s.yellow ?? 0,
    penaltySaved: s.pen_saved ?? 0,
  };
}

// ── Default best XI ──────────────────────────────────────────────────────
/** Per-position XI counts for a formation (or the template's slots if none). */
function xiSlotsFor(
  template: RosterTemplate,
  formation: string | null,
): Record<string, number> {
  const f = formationByName(template, formation ?? DEFAULT_FORMATION);
  if (f) return f.slots;
  // Positionless / no formations: XI shape == the squad slots.
  return Object.fromEntries(template.slots.map((s) => [s.code, s.count]));
}

/**
 * Fill the chosen formation's slots with the top-rated players of each position;
 * the rest become the bench (rating-ordered). Mirror of SQL default_lineup. Used
 * for the editor's initial/auto state and as an always-valid fallback.
 */
export function defaultLineup(
  squad: SquadPlayer[],
  template: RosterTemplate,
  formation: string | null = null,
): Lineup {
  const name = formationByName(template, formation)?.name ?? DEFAULT_FORMATION;
  const slots = xiSlotsFor(template, name);
  const byRating = [...squad].sort((a, b) => b.rating - a.rating);
  const xi: string[] = [];

  for (const [code, count] of Object.entries(slots)) {
    const picked = byRating
      .filter((p) => p.position === code && !xi.includes(p.id))
      .slice(0, count);
    xi.push(...picked.map((p) => p.id));
  }

  const bench = byRating.filter((p) => !xi.includes(p.id)).map((p) => p.id);
  return { xi, bench, formation: name };
}

/**
 * Re-shape an existing lineup to a new formation, keeping the highest-rated
 * players per position in the XI; everyone else benches. Always returns a valid
 * lineup for `formation` (the squad quota guarantees enough of each position).
 */
export function applyFormation(
  squad: SquadPlayer[],
  template: RosterTemplate,
  formation: string,
): Lineup {
  return defaultLineup(squad, template, formation);
}

// ── Formation validation (mirror of set_lineup checks) ───────────────────
export type LineupError =
  | { kind: "partition" }
  | { kind: "overlap" }
  | { kind: "foreign" }
  | { kind: "badformation"; name: string }
  | { kind: "formation"; code: string; need: number; got: number };

/**
 * Validate that xi+bench is an exact partition of the squad and the XI matches
 * the lineup's chosen formation exactly. Returns the first problem, or null if
 * valid. When the template has formations, the XI must match the named one;
 * otherwise it must match the template slots (positionless/legacy).
 */
export function validateLineup(
  lineup: Lineup,
  squad: SquadPlayer[],
  template: RosterTemplate,
): LineupError | null {
  const squadIds = new Set(squad.map((p) => p.id));
  const all = [...lineup.xi, ...lineup.bench];

  // exact partition: same length, no overlap, no foreigners
  if (all.length !== squadIds.size) return { kind: "partition" };
  if (new Set(all).size !== all.length) return { kind: "overlap" };
  for (const id of all) if (!squadIds.has(id)) return { kind: "foreign" };

  const posById = new Map(squad.map((p) => [p.id, p.position]));
  const formations = formationsOf(template);

  // Target XI shape: the named formation, or the slots when there are none.
  let target: Array<[string, number]>;
  if (formations.length > 0) {
    const f = formations.find((x) => x.name === lineup.formation);
    if (!f) return { kind: "badformation", name: lineup.formation };
    target = Object.entries(f.slots);
  } else {
    target = template.slots.map((s) => [s.code, s.count]);
  }

  for (const [code, need] of target) {
    const got = lineup.xi.filter((id) => posById.get(id) === code).length;
    if (got !== need) return { kind: "formation", code, need, got };
  }
  return null;
}

/** Human-readable message for a lineup error. */
export function lineupErrorMessage(e: LineupError): string {
  switch (e.kind) {
    case "partition":
      return "Your XI and bench must use your whole squad exactly once.";
    case "overlap":
      return "A player can't be in both the XI and the bench.";
    case "foreign":
      return "That player isn't in your squad.";
    case "badformation":
      return `Unknown formation: ${e.name}.`;
    case "formation":
      return `Invalid formation: need ${e.need} ${e.code}, have ${e.got}.`;
  }
}

/**
 * Try to move a player into the XI, swapping out a same-position starter so the
 * formation stays valid. Returns the new lineup, or null if no legal swap (e.g.
 * moving a starter that would break the formation). Used by the tap-to-sub UI.
 */
export function swapIntoXi(
  lineup: Lineup,
  playerId: string,
  squad: SquadPlayer[],
): Lineup | null {
  if (lineup.xi.includes(playerId)) return lineup;
  const posById = new Map(squad.map((p) => [p.id, p.position]));
  const pos = posById.get(playerId);
  // find a starter of the same position to drop
  const victim = lineup.xi.find((id) => posById.get(id) === pos);
  if (!victim) return null;
  return {
    xi: lineup.xi.map((id) => (id === victim ? playerId : id)),
    bench: lineup.bench.map((id) => (id === playerId ? victim : id)),
    formation: lineup.formation,
  };
}

// ── Standings + progression ──────────────────────────────────────────────
export type TeamRoundRow = {
  teamId: string;
  round: number;
  points: number | null;
};

export type StandingRow = {
  teamId: string;
  total: number;
  played: number;
  rank: number;
};

/** League table from all played team_rounds rows, ranked by total points. */
export function computeStandings(rows: TeamRoundRow[]): StandingRow[] {
  const totals = new Map<string, { total: number; played: number }>();
  for (const r of rows) {
    if (r.points == null) continue;
    const cur = totals.get(r.teamId) ?? { total: 0, played: 0 };
    cur.total += r.points;
    cur.played += 1;
    totals.set(r.teamId, cur);
  }
  const ranked = [...totals.entries()]
    .map(([teamId, v]) => ({ teamId, ...v }))
    .sort((a, b) => b.total - a.total || a.teamId.localeCompare(b.teamId));
  return ranked.map((r, i) => ({ ...r, rank: i + 1 }));
}

export type TimelineEntry = {
  round: number;
  points: number;
  cumulative: number;
  rank: number;
  rankDelta: number; // + = climbed, - = dropped (vs previous round)
};

/**
 * Per-round progression for one team: its points, running total, league rank
 * after that round, and movement vs the round before. Derived from every
 * team's per-round points so rank is computed against the whole league.
 */
export function computeTimeline(
  teamId: string,
  allRows: TeamRoundRow[],
): TimelineEntry[] {
  const rounds = [...new Set(allRows.map((r) => r.round))].sort((a, b) => a - b);
  const cumByTeam = new Map<string, number>();
  const out: TimelineEntry[] = [];
  let prevRank: number | null = null;

  for (const round of rounds) {
    const upto = allRows.filter((r) => r.round <= round && r.points != null);
    const standings = computeStandings(
      upto.map((r) => ({ teamId: r.teamId, round: r.round, points: r.points })),
    );
    const mine = allRows.find((r) => r.round === round && r.teamId === teamId);
    if (!mine || mine.points == null) continue;

    const cumulative = (cumByTeam.get(teamId) ?? 0) + mine.points;
    cumByTeam.set(teamId, cumulative);
    const rank = standings.find((s) => s.teamId === teamId)?.rank ?? 0;
    const rankDelta = prevRank == null ? 0 : prevRank - rank;
    prevRank = rank;

    out.push({ round, points: mine.points, cumulative, rank, rankDelta });
  }
  return out;
}

/** Mean XI rating — the "squad strength" progression signal. */
export function squadStrength(xiRatings: number[]): number {
  if (xiRatings.length === 0) return 0;
  return Math.round(xiRatings.reduce((a, b) => a + b, 0) / xiRatings.length);
}

// ── Round labelling ──────────────────────────────────────────────────────
/** Display label for a season round (group stage by default; stages later). */
export function roundLabel(round: number, totalRounds: number): string {
  if (totalRounds <= 0) return `Round ${round}`;
  return `Round ${round} of ${totalRounds}`;
}

/**
 * Short round label, with knockout-stage names inferred from how many fixtures
 * the round has (a final has 1, a semi 2, …). Only the trailing rounds get
 * stage names, so league gameweeks (many matches) stay "Round N". Heuristic
 * until the provider's real `league.round` is stored — see the season migration.
 */
export function stageLabel(
  round: number,
  totalRounds: number,
  fixtureCount?: number,
): string {
  if (fixtureCount != null && round > totalRounds - 6) {
    const byCount: Record<number, string> = {
      1: "Final",
      2: "Semi-final",
      4: "Quarter-final",
      8: "Round of 16",
      16: "Round of 32",
      32: "Round of 64",
    };
    if (byCount[fixtureCount]) return byCount[fixtureCount];
  }
  return `Round ${round}`;
}

// Re-exports the season UI leans on so it imports from one place.
export { POSITIONS, SQUAD_QUOTA, formationsOf, DEFAULT_FORMATION };
export type { Position, RosterTemplate, Formation };
