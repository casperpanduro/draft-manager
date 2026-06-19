# Season Mode — Post-Draft Manager Loop

Turns the post-draft view from a static "Draft complete" banner into a real
fantasy-manager season loop: simulated rounds, per-athlete stats, lineup
management, transfers, standings, and team-progression tracking.

This is the design agreed in the planning grill. It extends the prototype past
its original scope (`AGENTS.md` lists the season loop / scoring / transfers as
"later") — the `events` table + `players.value`/`base_value` columns were the
seams left for exactly this.

## Design decisions (locked)

| Area         | Decision                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------- |
| Points source| **Simulation now**, behind a swappable interface so a live stats feed drops in later               |
| Round unit   | Anchored to the **real WC fixture calendar** (MD1–3, R16, QF, SF, Final); **commissioner-triggered** |
| Scoring      | **Per-athlete fantasy points** from `rating` + variance, **light position-awareness**             |
| Lineup       | Editable **XI from your 16** each round (formation-valid); **manual subs + best-eligible auto-sub** |
| Transfers    | **Free-agent pickups** (undrafted pool); **3 free/round** then flat fee from a coin **budget**     |
| Progression  | Per-manager **timeline** (round pts, cumulative, rank ▲▼, squad ⌀rating) + **standings**; SVG only |

## Architecture fit

- **All season mutations go through `SECURITY DEFINER` RPCs**, exactly like the
  draft. Clients only ever *read* + subscribe to realtime; never write season
  state from the client.
- **Simulation runs in plpgsql inside `play_round`** (deterministic via
  `setseed(hash(league, round))`), **mirrored in `src/lib/scoring.ts`** for
  typing/preview — the same "mirror `draft.ts` in SQL" pattern already used by
  the draft engine.
- **Swap seam for live data**: later, `play_round` reads a real per-competition
  results table instead of simulating. The boundary is "where `player_scores`
  rows come from" — nothing downstream (lineups, standings, stats) changes.

## Scoring model (light position-awareness)

Per player whose nation has a fixture in the round:

- Baseline ≈ `rating / 10` ± a random performance swing (deterministic per
  league+round+player).
- Match-result bonus from the simulated fixture:
  - Attackers (FWD/MID): bonus when their nation scores.
  - Defenders/keeper: bonus on a clean sheet; penalty on goals conceded.
- Players whose nation did **not** play that round (no fixture / eliminated)
  score nothing → drives substitutions and transfers.

Team round score = sum of the **starting XI that actually played** (after
auto-subs).

## Lineup & substitutions

- Squad = the 16 from the draft (XI 1-4-4-2 + 5 bench, per `roster_template`).
- Managers can adjust their XI from their 16 each round; formation must stay
  valid (reuses `position_draftable` / template logic in `draft.ts` + SQL).
- **Manual subs**: swap any starter ↔ bench while the round is unlocked.
- **Auto-sub safety net**: if a starter's nation had no fixture (or is
  eliminated), the highest-rated eligible bench player who *did* play is
  auto-subbed in (best-eligible, rating-ordered; manual bench ordering deferred).
- Lineup is editable until the **commissioner plays the round**, then it locks
  and results simulate against the locked XI. Past rounds are read-only.

## Transfers

- **Free-agent / waiver model**: drop one of your 16, pick up any **undrafted**
  player (no `draft_picks` row for them in this league). Added player must keep
  the roster formation-valid. No inter-manager trading yet.
- **Fee**: each team starts with a coin **budget** (league setting, default
  200). **3 free transfers/round**; each additional transfer costs a flat fee
  (default 25). Budget at zero → no more paid transfers that round.
- Allowed **only between rounds** (same lock boundary as substitutions).
- The floating-price market (buy/sell at `players.value`) is **deferred** — the
  columns exist for it, but pricing dynamics are out of scope for v1.

## Progression & standings

- Per-manager **timeline**: one entry per completed round — round points,
  cumulative total, league rank with movement (▲2 / ▼1), squad ⌀rating (+/-).
- League **standings table**: all managers, totals, rank.
- Charts are **CSS/SVG sparklines** — no chart library.

## Schema (one new migration)

- `leagues`: `+ current_round int default 0`, `+ season_status text`
  (`draft | in_season | finished`).
- `teams`: `+ budget int default 200`.
- `events`: `+ round int`, `+ stage text` — backfilled on the existing snapshot
  by date-clustering; api-football `league.round` on next re-seed.
- New `team_players (league_id, team_id, player_id, acquired_round, active)` —
  current squad, seeded from `draft_picks` at draft completion. `draft_picks`
  stays immutable draft history.
- New `team_rounds (league_id, team_id, round, lineup jsonb, points int,
  locked bool)` — lineup + score per round.
- New `player_scores (league_id, round, player_id, points int, stats jsonb)` —
  per-round performances (per-league for the prototype; per-competition when live).
- New `transfers (league_id, team_id, round, out_player_id, in_player_id,
  fee int)` — log.
- RLS: authenticated read; writes RPC-only. Add all four new tables to the
  realtime publication.

## RPCs (SECURITY DEFINER, atomic)

- `finalize_squad(league_id)` — on draft complete: seed `team_players`, set
  `season_status='in_season'`, `current_round=0`.
- `set_lineup(league_id, xi[], bench[])` — formation-validated, only while the
  round is unlocked.
- `make_transfer(league_id, out_player_id, in_player_id)` — validates ownership +
  free-agent availability + roster validity; enforces 3-free-then-fee against
  `budget`; swaps `team_players`; logs `transfers`.
- `play_round(league_id)` — commissioner only: lock lineups → auto-sub unplayed →
  simulate `player_scores` for the round's fixtures → roll up `team_rounds.points`
  → `current_round++` (or `finished`). Fires realtime.

## UI — the new view

New route `src/app/league/[id]/season/page.tsx` + `src/components/season-room.tsx`
(the draft page redirects here when `status=complete`). Tabbed, mobile-first,
"Broadcast Tactical":

- **Overview** — last round pts, rank, next fixtures, commissioner *Play Round N*.
- **My XI** — tactical pitch, tap-to-sub, bench, lock state, unplayed warnings.
- **Transfers** — free-agent market (sort by rating/value/pos), budget + free left.
- **Standings** — all managers, totals, rank movement.
- **Fixtures** — round-grouped (enhances `fixtures-list.tsx`), highlights your players.
- **Stats** — squad/leader points, per-round breakdown, progression timeline + sparkline.

## Build order

1. **Migration**: columns, tables, RLS, realtime, `events.round` backfill →
   `db:reset` + `db:types`.
2. **RPCs**: `finalize_squad`, `set_lineup`, `make_transfer`, `play_round` (SQL sim).
3. **Libs**: `src/lib/scoring.ts` (TS mirror) + `src/lib/season.ts`
   (round/standings/timeline helpers).
4. Season view shell + routing + Overview + My XI lineup editing.
5. Transfers market.
6. Standings + round-grouped Fixtures + Stats/progression.
7. Commissioner Play-Round + realtime wiring.
8. **Verify**: `tsc --noEmit`, `lint`, `build`, `scripts/shots.mjs`.

## Dev seeding & QA

- `npm run db:seed-dev` — builds a ready-to-play "Demo Season" league of test
  managers (gaffer@demo.dev + rivals) with the draft auto-completed so every team
  has a preselected squad. `npm run db:seed-dev -- 2` also pre-plays 2 rounds.
  Sign in as `gaffer@demo.dev` (commissioner); magic link lands in Mailpit.
  Enrolls any `%@demo.dev` user, so add managers by creating more demo users.
- `scripts/test-season.sql` — end-to-end engine regression (draft → 3 rounds) in
  pure SQL, run via `docker exec -i … psql … < scripts/test-season.sql`.
- `scripts/season-shots.mjs <leagueId>` — Playwright screenshots of every season
  tab (mirrors `scripts/shots.mjs`).

## Notes / deviations from the original plan

- **No separate `src/lib/scoring.ts`.** A client-side mirror of the simulation
  would be dead code — the client only reads `player_scores` / `team_rounds`.
  The lineup math, validation, and standings/timeline derivations live in
  `src/lib/season.ts`; the simulation itself is server-only (plpgsql `play_round`).
- **`events.round` is derived, not stored** (the `event_rounds` view), because
  migrations run before `seed.sql`. Going live can store the provider's real
  round/stage instead.

## Out of scope (v1)

- Inter-manager trades / negotiations.
- Floating-price transfer market.
- Live real-world data ingestion (designed-for, not built).
- Manual bench auto-sub ordering.
