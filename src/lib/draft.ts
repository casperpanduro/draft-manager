// ── Core draft domain logic ────────────────────────────────────────────
// Pure functions, no I/O — shared by the draft room UI and (mirrored) by the
// auto-pick Edge Function / SQL RPCs.
//
// The roster SHAPE is data (a RosterTemplate), not hardcoded — this is what
// lets a new sport be config rather than a migration. Football's 1-4-4-2+5 is
// just one template; positionless sports (golf/motorsport) use an empty
// `slots` + an explicit `rosterSize`. The SQL side mirrors these rules in
// template_roster_size / position_draftable.

// ── Roster template (mirror of the JSONB on `competitions.roster_template`) ──
export type RosterSlot = { code: string; label?: string; count: number };
/** A pickable XI shape: how many of each position START. Sum is always 11. */
export type Formation = { name: string; slots: Record<string, number> };
export type RosterTemplate = {
  /** Per-position SQUAD quota — the fixed number drafted of each position. */
  slots: RosterSlot[];
  /** Flexible bench size (any position). 0 for fixed-quota templates. */
  bench?: number;
  /** Explicit size for positionless sports (slots empty). */
  rosterSize?: number;
  /** Selectable XI formations (football). Absent ⇒ XI shape == slots. */
  formations?: Formation[];
};

/**
 * Selectable football formations. A name "D-M-F" means D defenders, M
 * midfielders, F forwards + 1 GK = 11. MIRRORED in SQL (football_template).
 */
export const FOOTBALL_FORMATIONS: Formation[] = [
  { name: "4-4-2", slots: { GK: 1, DEF: 4, MID: 4, FWD: 2 } },
  { name: "4-3-3", slots: { GK: 1, DEF: 4, MID: 3, FWD: 3 } },
  { name: "3-5-2", slots: { GK: 1, DEF: 3, MID: 5, FWD: 2 } },
  { name: "3-4-3", slots: { GK: 1, DEF: 3, MID: 4, FWD: 3 } },
  { name: "5-3-2", slots: { GK: 1, DEF: 5, MID: 3, FWD: 2 } },
  { name: "5-4-1", slots: { GK: 1, DEF: 5, MID: 4, FWD: 1 } },
];

export const DEFAULT_FORMATION = FOOTBALL_FORMATIONS[0].name; // "4-4-2"

/**
 * Canonical football template: a FIXED squad quota (GK 2 · DEF 5 · MID 6 ·
 * FWD 3 = 16, no flexible bench) plus the formations the XI can take. Drafting
 * is capped per position by the quota; the season XI is any one formation, the
 * remaining 5 players are the bench.
 */
export const FOOTBALL_TEMPLATE: RosterTemplate = {
  slots: [
    { code: "GK", label: "Goalkeeper", count: 2 },
    { code: "DEF", label: "Defender", count: 5 },
    { code: "MID", label: "Midfielder", count: 6 },
    { code: "FWD", label: "Forward", count: 3 },
  ],
  bench: 0,
  formations: FOOTBALL_FORMATIONS,
};

/** Total roster size for a template. */
export function rosterSizeOf(t: RosterTemplate): number {
  if (t.rosterSize != null) return t.rosterSize;
  return t.slots.reduce((sum, s) => sum + s.count, 0) + (t.bench ?? 0);
}

function countCodes(positions: (string | null | undefined)[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const p of positions) {
    if (p == null) continue;
    counts[p] = (counts[p] ?? 0) + 1;
  }
  return counts;
}

/**
 * A position is draftable while a template slot for it is open OR the bench has
 * room. Positionless templates (no slots): any athlete fits until the roster is
 * full. Blocked only when the per-position slots are full AND the bench is full.
 */
export function canDraftFromTemplate(
  t: RosterTemplate,
  rosterPositions: (string | null)[],
  position: string | null,
): boolean {
  if (rosterPositions.length >= rosterSizeOf(t)) return false;
  if (t.slots.length === 0) return true; // positionless

  const counts = countCodes(rosterPositions);
  const xiUsed = t.slots.reduce(
    (sum, s) => sum + Math.min(counts[s.code] ?? 0, s.count),
    0,
  );
  const benchUsed = rosterPositions.length - xiUsed;
  const benchOpen = (t.bench ?? 0) - benchUsed;

  const slot = position == null ? undefined : t.slots.find((s) => s.code === position);
  const xiOpenForPos = slot ? slot.count - (counts[slot.code] ?? 0) > 0 : false;
  return xiOpenForPos || benchOpen > 0;
}

/** True once a roster is full for a given template. */
export function isRosterCompleteFor(t: RosterTemplate, count: number): boolean {
  return count >= rosterSizeOf(t);
}

// ── Football shorthands (derived from FOOTBALL_TEMPLATE — single source) ──
// The draft room is a football pitch view and uses these directly. Once a
// non-football competition is playable, render from the competition's template.
export type Position = "GK" | "DEF" | "MID" | "FWD";

export const POSITIONS: Position[] = ["GK", "DEF", "MID", "FWD"];

export const POSITION_LABEL: Record<Position, string> = {
  GK: "Goalkeeper",
  DEF: "Defender",
  MID: "Midfielder",
  FWD: "Forward",
};

/** Squad quota per position (how many of each you draft). GK2 · DEF5 · MID6 · FWD3. */
export const SQUAD_QUOTA: Record<Position, number> = Object.fromEntries(
  FOOTBALL_TEMPLATE.slots.map((s) => [s.code, s.count]),
) as Record<Position, number>;

export const ROSTER_SIZE = rosterSizeOf(FOOTBALL_TEMPLATE); // 16

/** Starting XI size — every formation sums to this. */
export const XI_SIZE = 11;

export const BENCH_SIZE = ROSTER_SIZE - XI_SIZE; // 5

export const TOTAL_ROUNDS = ROSTER_SIZE; // one pick per round

/** Allowed formations for a template (football). Empty for non-football. */
export function formationsOf(t: RosterTemplate): Formation[] {
  return t.formations ?? [];
}

/** Look up a formation by name; falls back to the template's first formation. */
export function formationByName(
  t: RosterTemplate,
  name: string | null | undefined,
): Formation | null {
  const fs = formationsOf(t);
  if (fs.length === 0) return null;
  return fs.find((f) => f.name === name) ?? fs[0];
}

/** Count drafted players per position. */
export function countByPosition(positions: Position[]): Record<Position, number> {
  const counts: Record<Position, number> = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
  for (const p of positions) counts[p] += 1;
  return counts;
}

/** Football roster slot check (delegates to the generic template engine). */
export function canDraftPosition(
  rosterPositions: Position[],
  position: Position,
): boolean {
  return canDraftFromTemplate(FOOTBALL_TEMPLATE, rosterPositions, position);
}

/** True once a (football) roster is full. */
export function isRosterComplete(rosterPositions: Position[]): boolean {
  return rosterPositions.length >= ROSTER_SIZE;
}

/**
 * Snake draft. Given the number of teams and a 1-based overall pick number,
 * return the 1-based draft position (seat) that is on the clock.
 *
 * Round 1: 1,2,3,...,N. Round 2: N,...,2,1. Etc.
 */
export function seatForPick(pickNumber: number, teamCount: number): number {
  const round = Math.floor((pickNumber - 1) / teamCount); // 0-based
  const indexInRound = (pickNumber - 1) % teamCount; // 0-based
  const seatIndex =
    round % 2 === 0 ? indexInRound : teamCount - 1 - indexInRound;
  return seatIndex + 1; // 1-based
}

/** 1-based round number for an overall pick. */
export function roundForPick(pickNumber: number, teamCount: number): number {
  return Math.floor((pickNumber - 1) / teamCount) + 1;
}

export function totalPicks(teamCount: number): number {
  return teamCount * TOTAL_ROUNDS;
}

// ── Player market value (transfer economy) ───────────────────────────────
// A player's coin value blends their OWN rating with how strong their club is
// (mean rating of the club's best XI), then maps the blend through a convex
// curve so elite players cost dramatically more than squad fillers.
// MIRRORED IN SQL: compute_player_value() + recompute_competition_values()
// in the migration — keep these constants in sync.

/** How many of a club's best players define its strength. */
export const TEAM_STRENGTH_TOP_N = 11;

/** Blend weights: value leans on the player; team strength only nudges it. */
export const VALUE_WEIGHT_PLAYER = 0.7;
export const VALUE_WEIGHT_TEAM = 0.3;

/** Convex curve mapping the blended ~40–95 score onto a coin value. */
export const VALUE_SCORE_FLOOR = 40; // score at/below which value bottoms out
export const VALUE_SCORE_SPAN = 55; // floor + span ≈ the top score (~95)
export const VALUE_MAX = 200; // coins at the very top of the curve
export const VALUE_FLOOR = 8; // minimum coin price for any player
export const VALUE_CURVE_EXP = 2.2; // > 1 ⇒ convex (elite cost much more)

/** Default starting transfer budget for a manager, in coins. */
export const DEFAULT_TEAM_BUDGET = 250;

/** Spread retained by the house on a sale: managers get back 90% of value. */
export const SELL_RETURN_FACTOR = 0.9;

/** Value may drift within this fraction of base_value over a season. */
export const VALUE_DRIFT_BAND = 0.4;

const clampNum = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Club strength = mean rating of its best TEAM_STRENGTH_TOP_N players. */
export function teamStrength(ratings: number[]): number {
  if (ratings.length === 0) return 0;
  const top = [...ratings].sort((a, b) => b - a).slice(0, TEAM_STRENGTH_TOP_N);
  return top.reduce((s, r) => s + r, 0) / top.length;
}

/**
 * A player's coin value: a player/team-strength blend pushed through a convex
 * curve. `strength` is the club strength from teamStrength(); pass the player's
 * own rating when the club is unknown (value reduces to a pure-rating curve).
 */
export function playerValue(rating: number, strength: number): number {
  const score = VALUE_WEIGHT_PLAYER * rating + VALUE_WEIGHT_TEAM * strength;
  const norm = clampNum((score - VALUE_SCORE_FLOOR) / VALUE_SCORE_SPAN, 0, 1);
  return Math.max(VALUE_FLOOR, Math.round(VALUE_MAX * Math.pow(norm, VALUE_CURVE_EXP)));
}

/** Coins returned when selling a player at the current value (after the spread). */
export function sellReturn(value: number): number {
  return Math.floor(value * SELL_RETURN_FACTOR);
}

/** Clamp a (future) drifted value to the allowed band around its base value. */
export function clampToDriftBand(value: number, baseValue: number): number {
  return Math.round(
    clampNum(value, baseValue * (1 - VALUE_DRIFT_BAND), baseValue * (1 + VALUE_DRIFT_BAND)),
  );
}

/** Fisher–Yates shuffle (returns a new array). */
export function shuffle<T>(input: T[], rand: () => number = Math.random): T[] {
  const a = [...input];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
