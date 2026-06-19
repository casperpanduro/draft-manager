# Scoring — event-driven points model

How a player's points are calculated each round. This is the canonical reference;
the **points table is rendered straight from `src/lib/scoring.ts`** (the rules page
in the season room reads the same config), and the SQL `play_round` RPC mirrors the
formula. Change the numbers in **one place** (`SCORING_WEIGHTS` in `scoring.ts`) and
the SQL mirror, then bump `SCORING_VERSION`.

## The points table

| Event | Points | Conditions |
|---|---|---|
| Appearance | +1 / +2 | 1–59 min / 60+ min |
| Goal — FWD / MID / DEF / GK | 4 / 5 / 6 / 6 | per goal |
| Assist | +3 | any position |
| Shot on target (non-scoring) | +1 | `max(0, shots_on − goals)` |
| Clean sheet — GK / DEF / MID / FWD | 4 / 4 / 1 / 0 | team conceded 0, **60+ min** |
| Goals conceded — GK/DEF | −1 per 2 conceded | **60+ min** |
| Penalty save | +5 | GK only |
| Red card | −3 | max one per match |

Notes:
- **No rating, no random "form".** Points come only from what a player actually did.
  Rating still drives the *draft* (who's good beforehand), never the live score.
- **Shots on target** count only *non-scoring* shots (`shots.on` from the feed
  already includes goals, which are scored separately) — so a goal and its shot are
  never double-counted.
- **Clean sheet / goals-conceded** use the **team's** goals-against (not a per-player
  stat), gated at 60+ minutes so a half-time sub doesn't claim a sheet.

## Where the numbers / data live

- **`src/lib/scoring.ts`** — `SCORING_WEIGHTS`, `SCORING_VERSION`, `PlayerMatchRaw`,
  `scorePlayerMatch(raw, position, teamGoalsAgainst) → { total, breakdown }`, and
  `SCORING_RULES` (the human-readable rows the rules page renders). **Single source
  of truth**; mirrored by the SQL formula inside `play_round`.
- **`player_match_stats`** (catalog table, admin-seeded) — the real per-player,
  per-fixture raw counts: `minutes, goals, assists, shots_on, red, yellow,
  penalty_saved`. Keyed on `(competition_id, event_id, player_id)`; idempotent
  upsert; snapshotted into `seed.sql`. This is the seam a live feed fills later.
- **`player_scores`** (per league/round) — derived by `play_round`: `points` is the
  total, `stats` stores the raw counts (so the UI can show the per-category
  breakdown by re-running `scorePlayerMatch`).

## How a round is scored (`play_round`)

A round is **real** when its fixtures already have `player_match_stats` rows;
otherwise it falls back to **simulation** (only when `leagues.sim_fallback` is on —
the offline/demo default). Both paths produce the *same shapes* and run through the
*same scoring formula*:

1. **Scoreline → `match_results`.** Real: copied from `events.result` (the real final
   score). Sim: a deterministic scoreline from club strength. Either way the team
   goals-against used for clean-sheet/conceded comes from here.
2. **Per-player raw stats → `player_scores`.** Real: read from `player_match_stats`.
   Sim: deterministically generated into the same shape. Then `scorePlayerMatch`
   (mirrored in SQL) turns raw counts + team GA into the total; raw counts are stored
   in `player_scores.stats`.
3. **Auto-sub + lock.** Unplayed starters are swapped for same-position bench who
   featured; the XI total is stored on `team_rounds` and the round is locked.
4. **Advance** `current_round` (or finish the season).

For **real play** you set `leagues.sim_fallback = false`: a round then becomes
playable only once its fixtures are finished and ingested (re-seed pulls each newly
finished matchday). `db:reset` / local demos keep `sim_fallback = true` so a full
season is clickable offline with no API key.

## Roadmap

- **Now (snapshot):** seed real per-fixture stats at seed time → `db:dump` → offline
  `seed.sql`. Refresh newly-finished matchdays by re-seeding.
- **Later (live):** a cron/Edge Function writes into the same `player_match_stats`
  table as matches finish — nothing downstream changes.
- **Immutability:** `scoring_version` is stamped so past rounds can later be recomputed
  with the weights that were live when they were played.
