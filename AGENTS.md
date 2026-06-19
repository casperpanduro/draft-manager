<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Draft Manager

A mobile-first, multiplayer **football drafting game**. Create a league for a real
competition, invite friends with a code, and when the commissioner starts it,
everyone drafts a squad live via a **snake draft** with a pick clock — then play
out a **post-draft season** (lineups, transfers, per-round scoring, a league
table). See `SPEC.md` for the design rationale, `SCORING.md` for the points
model, and `README.md` for run instructions.

## Scope (current)

Full loop: **lobby → invite → live snake draft → final rosters → season**
(per-round lineups + free-agent transfers, event-driven scoring, standings).
Deliberately **out of scope** (later): auction drafts, co-managers, pause/undo,
spectators, and **live in-match ingestion** (scoring is snapshot-at-seed-time
today; the `player_match_stats` table is the seam a live feed fills later).

Rules that are settled (don't relitigate without reason):
- **Snake draft**, round-1 order randomised at start over exactly who's present.
- League **locks** on start; absent managers are covered by auto-pick; rejoin
  rebuilds live state from the DB.
- **Roster shape is DATA, not code** — a per-competition JSONB `roster_template`
  (`{slots:[{code,label,count}], bench, formations:[{name,slots}]}`), mirrored by
  `src/lib/draft.ts` + `template_*` SQL helpers. Football is a **FIXED per-position
  squad quota** — **GK 2 · DEF 5 · MID 6 · FWD 3 = 16, `bench:0`** — plus six
  selectable XI **formations** (4-4-2, 4-3-3, 3-5-2, 3-4-3, 5-3-2, 5-4-1), all in
  `football_template()`. With `bench:0`, `position_draftable` caps drafting at each
  position's quota — a filled position is undraftable (draft UI shows `x/quota` per
  position). Under-filling allowed mid-draft; the 16 quota slots force the exact
  composition by the end. The season **XI is any one formation** (11), the leftover
  5 are the bench; the manager switches formation in the lineup editor and
  `set_lineup(…, p_formation)` validates the XI against it (`lineup.formation` is
  stored on `team_rounds.lineup`). Positionless sports (golf/motorsport) use empty
  `slots` + an explicit `rosterSize` → draft any N athletes. **Football is the only
  sport wired today; the model is multi-sport-ready (see Real-data seeding).**
- **2–20 managers.** Pick clock default 60s.
- One user → many leagues, **one team per league**.
- **Scoring is event-driven**, not rating-based: points come from what a player
  actually did in their match (goals by position, assists, shots on target, clean
  sheets, conceded, penalty saves, red cards). Rating drives the *draft*, never
  the live score. Weights live in `src/lib/scoring.ts` (mirrored by the
  `score_player_match` SQL fn) — single source of truth, version-tagged. See
  `SCORING.md`. Rounds are **derived** from the fixture calendar (ISO-week
  buckets via the `event_rounds` view).
- Competitions are **season snapshots** (provider + league + season), seeded via
  `/admin` or `scripts/seed-competition.ts`. The seeded data is snapshotted to
  `supabase/seed.sql` (`npm run db:dump`) so `db:reset` reproduces it OFFLINE —
  no API key needed for a working app. The shipped pool is **World Cup 2026**
  (real api-football squads; ratings from club form — see cold-start below).

## Stack

- **Next.js 16** (App Router, Turbopack) · React 19 · TypeScript
- **Supabase**: Postgres, Auth (email magic link), Realtime, Edge Functions
- **Tailwind v4 + shadcn/ui** — note: this shadcn build is on **Base UI**, not
  Radix. Use the `render` prop (not `asChild`); active tab state is `data-active`.
- **motion** (Framer Motion) for draft-room pick reveals
- Route middleware lives in `src/proxy.ts` (Next 16 renamed `middleware`→`proxy`).

## Architecture

- **All draft mutations go through `SECURITY DEFINER` Postgres RPCs** so turn
  logic is atomic and race-free. Clients only ever *read* tables directly
  (+ realtime). Never write draft state from the client.
  - `create_league`, `join_league`, `start_draft`, `make_pick`, `auto_pick`
    (+ internal `record_pick`). Helpers: `seat_for_pick`, `position_draftable`
    (reads the competition's `roster_template` — keep in sync with `draft.ts`).
- **Season mutations are RPCs too** (same SECURITY DEFINER model): `finalize_squad`
  (draft complete → seeds `team_players`, opens round 1, flips to `in_season`),
  `set_lineup`, `make_transfer`, and **`play_round`** (commissioner scores + locks
  the open round). Season lineup/formation math is in `src/lib/season.ts` (mirrored
  by `default_lineup`/`set_lineup` SQL); scoring math is in `src/lib/scoring.ts`
  (mirrored by `score_player_match`). Keep both in sync, same as `draft.ts` ↔ SQL.
- **`play_round` scoring**: uses **real** per-fixture player stats from
  `player_match_stats` when the round's fixtures have them (team goals-against read
  from the real `events.result` scoreline); otherwise falls back to a
  **deterministic simulation** (only when `leagues.sim_fallback` is on — the
  offline/demo default; real leagues set it false to gate on real data). Both paths
  generate the same raw-stat shape and run the *one* `score_player_match` formula,
  so the per-category breakdown is identical for real and simulated rounds. Season
  cursor (`current_round`, `total_rounds`, `season_status`) lives on the `leagues`
  row.
- **Pick clock authority** = the `auto-pick` Edge Function (`supabase/functions/`).
  Clients invoke it when the clock expires; it re-checks the deadline under a row
  lock, so redundant calls are safe. There's a client RPC fallback so the draft
  always advances in local dev without the function served.
- **Real-data seeding** (admin only): catalog tables (`competitions`, `clubs`,
  `players`, `events`, `player_match_stats`, `sports`) are writable only by admins
  (`is_admin()` RLS). A **provider adapter** (`src/lib/providers/`) normalizes a
  data source; the seeder (`src/lib/seed.ts`, driven by `POST /api/admin/seed`)
  runs **per-team chunked, resumable, idempotent upserts** keyed on
  `(competition_id, provider, external_ref)`, tracking `seed_status`/`seed_progress`
  on the competition. A final **`matchstats` phase** pulls per-player fixture stats
  (`getFixturePlayerStats`) for **finished fixtures only** into `player_match_stats`
  (keyed on `(competition_id, event_id, player_id)`) — re-seeding is how newly-played
  matchdays get ingested.
  `rating` is the **adapter's** derived scalar (football: composite,
  position-aware, recency-weighted, small samples shrunk toward the mean); the
  draft engine only reads the scalar. Add a sport = a `sports` row + an adapter,
  no draft changes. The api-football key + service-role key are **server-only**
  env (the seeder uses `src/lib/supabase/admin.ts`; never import it client-side).
- **Cold-start (upcoming/ongoing tournaments)**: when a competition's own season
  has no aggregated player stats yet (e.g. a World Cup mid-event), the
  api-football adapter falls back from `/players` to `/players/squads` (the real
  squad) and rates each player from their recent **club** form. This is many
  calls, so the HTTP layer retries on 429 with backoff. Seed once, then snapshot
  to `seed.sql` so it never re-hits the API.
- **Realtime**: clients subscribe to `postgres_changes` on `leagues`, `teams`,
  `draft_picks`, `competitions` (draft) and `team_rounds`, `team_players`,
  `transfers`, `match_results`, `player_match_stats` (season). RLS allows
  authenticated reads; draft/season writes are RPC-only, catalog writes admin-only.
- Draft cursor (`current_pick_number`, `pick_deadline`) lives **on the `leagues`
  row**, not a separate table.

### Data model
`profiles` (`is_admin`) · `sports` (slug, provider, default_roster_template,
provider_config) · `competitions` (slug, theme, playable, **sport_slug,
provider, external_ref, season, roster_template, seed_status/seed_progress**) ·
`leagues` (status lobby/drafting/complete, join_code, clock_seconds, draft cursor,
**season cursor: current_round/total_rounds/season_status, sim_fallback,
scoring_version, free_transfers_per_round, transfer_fee**) · `teams` (manager
squad, one per user per league, draft_position, **budget** = transfer coins) ·
`clubs` (real-world teams/nations, provider+external_ref, **strength**) · `players`
(**position text, nullable**, club text + `club_id` fk, rating, **value**,
provider+external_ref, raw `stats`) · `events` (generic match/fixture: label,
starts_at, status, `result` JSONB; `event_rounds` view derives the round) ·
`draft_picks` (round, pick_number, auto_picked).
**Season tables**: `team_players` (live squad after transfers) · `team_rounds`
(per-round lineup + points + locked) · `player_scores` (per league/round: points +
raw `stats`) · `player_match_stats` (catalog: real per-fixture raw stats — the
scoring seam) · `match_results` (per-round scorelines) · `transfers` (free-agent log).

### Key files
```
src/lib/draft.ts            roster template engine + snake math (MIRRORED in SQL — keep in sync)
src/lib/season.ts           season lineup/standings/timeline math (MIRRORED in SQL — keep in sync)
src/lib/scoring.ts          event-driven scoring weights + scorePlayerMatch (MIRRORED in SQL); rules-page data
src/lib/providers/          provider abstraction (types.ts) + api-football.ts adapter + registry
src/lib/seed.ts             resumable/idempotent seeding pipeline (advanceSeed; incl. matchstats phase)
scripts/seed-competition.ts CLI: seed a competition from its provider (npx tsx … <slug> --publish)
scripts/dump-seed.sh        snapshot seeded data → seed.sql (npm run db:dump)
src/lib/admin-auth.ts       isCurrentUserAdmin() gate
src/lib/supabase/           browser / server / proxy clients + admin.ts (service-role, server-only)
src/lib/competitions.ts     slug → theme/label FALLBACK metadata (DB competitions row is source of truth)
src/lib/avatar.ts           procedural avatar spec + national kit colours
src/components/draft-room.tsx     the hero: scoreboard, players, pitch, feed
src/components/season-room.tsx    season hub: overview/XI/transfers/table/fixtures/stats/scoring tabs
src/components/season-pitch.tsx   season lineup editor (tap-to-sub) + per-player scores
src/components/season-stats.tsx   per-round progression + squad-strength charts
src/components/scoring-rules.tsx  <ScoringRules> — points table rendered from scoring.ts (rules surface)
src/components/admin-client.tsx   admin: search/create competition + seed/publish controls
src/components/fixtures-list.tsx  thin schedule view off the events table
src/components/player-avatar.tsx  deterministic SVG player faces
src/app/admin/             admin page + server actions (create/publish/delete competition)
src/app/api/admin/         leagues (provider search) + seed (one resumable step per POST)
src/app/                    landing, login, auth/confirm, dashboard, competition/[slug], league/[id]/draft, league/[id]/season
supabase/migrations/        schema, draft + season RPCs, template helpers, scoring fn, RLS (incl. admin), realtime
supabase/seed.sql           GENERATED (npm run db:dump): offline snapshot of seeded competitions
supabase/functions/auto-pick/     pick-clock Edge Function
SCORING.md                  the points model + scoring architecture (canonical reference)
scripts/shots.mjs           Playwright visual-QA screenshots (dev utility)
```

## Design system — "Broadcast Tactical"

Dark sports-broadcast aesthetic (Champions League graphics × Football Manager).
Defined entirely in `src/app/globals.css`.

- **Fonts**: `--font-display` = **Anton** (condensed jersey/scoreboard headings),
  `--font-sans` = **Saira** (UI + tabular stats). Loaded in `layout.tsx`.
- **Dark base shell is constant across all leagues.** Per-league branding only
  swaps accent tokens via `[data-theme="..."]` (`--brand`, `--brand-2`,
  `--primary`, `--ring`). Competitions are created at **`/admin`** (which picks a
  curated theme key); a brand-new *look* still needs a `data-theme` CSS block (+
  optional `COMPETITIONS` fallback entry). Don't reskin backgrounds.
- **Tokens**: `--brand`, `--brand-2`, `--brand-foreground`, `--brand-gradient`,
  `--brand-glow`. Utilities: `bg-brand`, `text-brand`, `bg-brand-2`. Sharp radii.
- **Motifs**: `.clip-broadcast` (cut corner), `.accent-bar` (left brand bar),
  `.kicker` (uppercase tracked label), `.sheen` (hover sweep), `.bg-pitch` /
  `.bg-grain` / `.bg-vignette` atmosphere (mounted once in `layout.tsx`).
  Animations: `animate-rise` (staggered load via inline `animationDelay`),
  `pulse-danger`, `slam-in`.
- Mobile-first; the draft room is the primary screen. The draft "Squad" tab
  renders the squad as per-position quota slots (GK 2 · DEF 5 · MID 6 · FWD 3);
  the season pitch renders the chosen formation with player avatars + chips.

## Dev workflow

```bash
supabase start && npm run db:reset && npm run dev   # Mailpit for magic links: 127.0.0.1:54324
```
- After schema changes: `npm run db:reset` then `npm run db:types` (regenerates
  `src/lib/database.types.ts`).
- **Seeding env** (server-only, `.env.local`): `SUPABASE_SERVICE_ROLE_KEY`,
  `API_FOOTBALL_KEY`, `API_FOOTBALL_HOST` (`v3.football.api-sports.io`). Admin is
  bootstrapped by email in `handle_new_user()` (first login grants `is_admin`);
  use `/admin` to add + seed real competitions. The rating window
  (`ratingSeasons`) lives on `sports.provider_config`.
- **Refresh the shipped pool from the API** (only when you want new data):
  `npx tsx scripts/seed-competition.ts <slug> --publish` then `npm run db:dump`
  to re-snapshot `seed.sql`. `db:reset` alone stays fully offline.
- Auth is tuned for local dev (`site_url=localhost:3000`, custom magic-link
  template in `supabase/config.toml` using the server-side `token_hash` flow).
  Update site_url / redirect URLs / SMTP for production.
- Verify before claiming done: `npx tsc --noEmit`, `npm run lint`, `npm run build`.
  For visual changes, screenshot via `node scripts/shots.mjs <lobbyId> <liveId>`.
