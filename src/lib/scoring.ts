// ── Scoring engine ─────────────────────────────────────────────────────
// Event-driven fantasy points: a player's score comes only from what they
// actually did in a match — never from rating or randomness (rating drives the
// DRAFT, not the live score). Pure functions, no I/O.
//
// SINGLE SOURCE OF TRUTH for the point values. MIRRORED by the SQL formula in
// play_round (supabase/migrations/*_real_scoring.sql) — keep in sync, same
// contract as draft.ts ↔ SQL and season.ts ↔ SQL. See SCORING.md.
//
// Both the real-data path and the offline simulation produce the same
// PlayerMatchRaw shape and run through scorePlayerMatch(), so the per-category
// breakdown the season room renders is identical for real and simulated rounds.

import type { Position } from "./draft";

// Bump when the weights change so past rounds can be recomputed with the
// weights that were live when they were played (stamped on each league/round).
export const SCORING_VERSION = 1;

// ── Point values ─────────────────────────────────────────────────────────
export const SCORING_WEIGHTS = {
  /** Appearance: featured at all / played 60+ minutes. */
  appearance: { played: 1, sixty: 2 },
  /** Points per goal, by position (rarer for a position ⇒ worth more). */
  goal: { GK: 6, DEF: 6, MID: 5, FWD: 4 } as Record<Position, number>,
  /** Points per assist, any position. */
  assist: 3,
  /** Points per non-scoring shot on target. */
  shotOnTarget: 1,
  /** Clean sheet (team conceded 0, 60+ min), by position. */
  cleanSheet: { GK: 4, DEF: 4, MID: 1, FWD: 0 } as Record<Position, number>,
  /** Penalty: −1 for every N team goals conceded (GK/DEF, 60+ min). */
  concededPer: 2,
  /** Penalty save (GK only). */
  penaltySave: 5,
  /** Red card (capped at one per match). */
  redCard: -3,
} as const;

/** Minutes needed to qualify for clean-sheet / conceded scoring. */
export const SIXTY_MIN = 60;

// ── Raw per-match stat line (mirror of player_match_stats / the sim) ──────
// What the player actually did. The real feed and the simulation both fill it.
export type PlayerMatchRaw = {
  minutes: number;
  goals: number;
  assists: number;
  /** Shots on target (INCLUDES goals, like the provider's `shots.on`). */
  shotsOn: number;
  /** Red cards in the match (capped to 1 when scored). */
  red: number;
  /** Yellow cards — stored for future use, not scored today. */
  yellow?: number;
  /** Penalty saves (goalkeepers). */
  penaltySaved: number;
};

// ── Breakdown ──────────────────────────────────────────────────────────────
export type ScoreLine = { label: string; detail: string; points: number };
export type ScoreBreakdown = { total: number; lines: ScoreLine[] };

const POS_GOAL = (p: Position) => SCORING_WEIGHTS.goal[p] ?? 0;

/**
 * Turn a raw stat line + the player's position + their team's goals-against into
 * a points total and a per-category breakdown. teamGoalsAgainst is the TEAM
 * fact (from the real fixture scoreline), not a per-player stat — clean sheets
 * and the conceded penalty derive from it.
 *
 * MIRRORED in SQL (play_round). Any change here must change there too.
 */
export function scorePlayerMatch(
  raw: PlayerMatchRaw,
  position: Position,
  teamGoalsAgainst: number,
): ScoreBreakdown {
  const lines: ScoreLine[] = [];
  const w = SCORING_WEIGHTS;
  const played60 = raw.minutes >= SIXTY_MIN;

  // Didn't feature at all → no points.
  if (raw.minutes <= 0) return { total: 0, lines: [] };

  // Appearance
  const appPts = played60 ? w.appearance.sixty : w.appearance.played;
  lines.push({
    label: "Appearance",
    detail: played60 ? "60+ min" : "<60 min",
    points: appPts,
  });

  // Goals
  if (raw.goals > 0) {
    const per = POS_GOAL(position);
    lines.push({
      label: "Goals",
      detail: `${raw.goals} × ${per}`,
      points: raw.goals * per,
    });
  }

  // Assists
  if (raw.assists > 0) {
    lines.push({
      label: "Assists",
      detail: `${raw.assists} × ${w.assist}`,
      points: raw.assists * w.assist,
    });
  }

  // Shots on target (non-scoring only)
  const nonScoringSot = Math.max(0, raw.shotsOn - raw.goals);
  if (nonScoringSot > 0) {
    lines.push({
      label: "Shots on target",
      detail: `${nonScoringSot} × ${w.shotOnTarget}`,
      points: nonScoringSot * w.shotOnTarget,
    });
  }

  // Clean sheet (team conceded 0, 60+ min)
  if (played60 && teamGoalsAgainst === 0) {
    const cs = w.cleanSheet[position] ?? 0;
    if (cs !== 0) lines.push({ label: "Clean sheet", detail: "", points: cs });
  }

  // Goals conceded penalty (GK/DEF, 60+ min)
  if (played60 && (position === "GK" || position === "DEF") && teamGoalsAgainst > 0) {
    const penalty = -Math.floor(teamGoalsAgainst / w.concededPer);
    if (penalty !== 0) {
      lines.push({
        label: "Goals conceded",
        detail: `${teamGoalsAgainst} conceded`,
        points: penalty,
      });
    }
  }

  // Penalty save (GK)
  if (position === "GK" && raw.penaltySaved > 0) {
    lines.push({
      label: "Penalty save",
      detail: `${raw.penaltySaved} × ${w.penaltySave}`,
      points: raw.penaltySaved * w.penaltySave,
    });
  }

  // Red card (capped at one)
  if (raw.red > 0) {
    lines.push({ label: "Red card", detail: "", points: w.redCard });
  }

  const total = lines.reduce((s, l) => s + l.points, 0);
  return { total, lines };
}

// ── Rules-page description (rendered by <ScoringRules>) ───────────────────
// Generated from SCORING_WEIGHTS so the page never drifts from the formula.
export type ScoringRuleRow = { event: string; value: string; note?: string };

export const SCORING_RULES: ScoringRuleRow[] = [
  {
    event: "Appearance",
    value: `+${SCORING_WEIGHTS.appearance.played} / +${SCORING_WEIGHTS.appearance.sixty}`,
    note: "played 1–59 min / 60+ min",
  },
  {
    event: "Goal",
    value: `GK ${SCORING_WEIGHTS.goal.GK} · DEF ${SCORING_WEIGHTS.goal.DEF} · MID ${SCORING_WEIGHTS.goal.MID} · FWD ${SCORING_WEIGHTS.goal.FWD}`,
    note: "per goal — rarer for a position, worth more",
  },
  { event: "Assist", value: `+${SCORING_WEIGHTS.assist}`, note: "any position" },
  {
    event: "Shot on target",
    value: `+${SCORING_WEIGHTS.shotOnTarget}`,
    note: "per non-scoring shot on target",
  },
  {
    event: "Clean sheet",
    value: `GK ${SCORING_WEIGHTS.cleanSheet.GK} · DEF ${SCORING_WEIGHTS.cleanSheet.DEF} · MID ${SCORING_WEIGHTS.cleanSheet.MID} · FWD ${SCORING_WEIGHTS.cleanSheet.FWD}`,
    note: `team conceded 0, ${SIXTY_MIN}+ min`,
  },
  {
    event: "Goals conceded",
    value: `−1 per ${SCORING_WEIGHTS.concededPer}`,
    note: `GK & DEF, ${SIXTY_MIN}+ min`,
  },
  {
    event: "Penalty save",
    value: `+${SCORING_WEIGHTS.penaltySave}`,
    note: "goalkeepers",
  },
  { event: "Red card", value: `${SCORING_WEIGHTS.redCard}`, note: "max one per match" },
];
