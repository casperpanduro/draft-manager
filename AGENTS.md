<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Draft Manager

A mobile-first, multiplayer **football drafting game**. Create a league for a real
competition, invite friends with a code, and when the commissioner starts it,
everyone drafts a squad live via a **snake draft** with a pick clock. See
`SPEC.md` for the full design rationale and `README.md` for run instructions.

## Scope (current)

Prototype loop only: **lobby → invite → live snake draft → final rosters.**
Deliberately **out of scope** (later): scoring/standings (the `events` table +
admin seeding exist as the seam, but no per-athlete match scoring yet), the
post-draft season loop, auction drafts, co-managers, pause/undo, spectators.

Rules that are settled (don't relitigate without reason):
- **Snake draft**, round-1 order randomised at start over exactly who's present.
- League **locks** on start; absent managers are covered by auto-pick; rejoin
  rebuilds live state from the DB.
- **Roster shape is DATA, not code** — a per-competition JSONB `roster_template`
  (`{slots:[{code,label,count}], bench}`), mirrored by `src/lib/draft.ts` +
  `template_*` SQL helpers. Football's **1-4-4-2 XI + 5 flexible subs = 16** is
  just one template (`football_template()`). A position is draftable while a
  template slot for it is open OR the bench has room; over-stacking blocked,
  under-filling allowed. Positionless sports (golf/motorsport) use empty `slots`
  + an explicit `rosterSize` → draft any N athletes. **Football is the only sport
  wired today; the model is multi-sport-ready (see Real-data seeding).**
- **2–20 managers.** Pick clock default 60s.
- One user → many leagues, **one team per league**.
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
- **Pick clock authority** = the `auto-pick` Edge Function (`supabase/functions/`).
  Clients invoke it when the clock expires; it re-checks the deadline under a row
  lock, so redundant calls are safe. There's a client RPC fallback so the draft
  always advances in local dev without the function served.
- **Real-data seeding** (admin only): catalog tables (`competitions`, `clubs`,
  `players`, `events`, `sports`) are writable only by admins (`is_admin()` RLS).
  A **provider adapter** (`src/lib/providers/`) normalizes a data source; the
  seeder (`src/lib/seed.ts`, driven by `POST /api/admin/seed`) runs **per-team
  chunked, resumable, idempotent upserts** keyed on `(competition_id, provider,
  external_ref)`, tracking `seed_status`/`seed_progress` on the competition.
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
  `draft_picks`, `competitions` (publication set in the migration). RLS allows
  authenticated reads; draft writes are RPC-only, catalog writes are admin-only.
- Draft cursor (`current_pick_number`, `pick_deadline`) lives **on the `leagues`
  row**, not a separate table.

### Data model
`profiles` (`is_admin`) · `sports` (slug, provider, default_roster_template,
provider_config) · `competitions` (slug, theme, playable, **sport_slug,
provider, external_ref, season, roster_template, seed_status/seed_progress**) ·
`leagues` (status lobby/drafting/complete, join_code, clock_seconds, cursor) ·
`teams` (manager squad, one per user per league, draft_position) · `clubs`
(real-world teams/nations, provider+external_ref) · `players` (**position text,
nullable**, club text + `club_id` fk, rating, provider+external_ref, raw
`stats`) · `events` (generic match/fixture: label, starts_at, status, `result`
JSONB) · `draft_picks` (round, pick_number, auto_picked).

### Key files
```
src/lib/draft.ts            roster template engine + snake math (MIRRORED in SQL — keep in sync)
src/lib/providers/          provider abstraction (types.ts) + api-football.ts adapter + registry
src/lib/seed.ts             resumable/idempotent seeding pipeline (advanceSeed)
scripts/seed-competition.ts CLI: seed a competition from its provider (npx tsx … <slug> --publish)
scripts/dump-seed.sh        snapshot seeded data → seed.sql (npm run db:dump)
src/lib/admin-auth.ts       isCurrentUserAdmin() gate
src/lib/supabase/           browser / server / proxy clients + admin.ts (service-role, server-only)
src/lib/competitions.ts     slug → theme/label FALLBACK metadata (DB competitions row is source of truth)
src/lib/avatar.ts           procedural avatar spec + national kit colours
src/components/draft-room.tsx     the hero: scoreboard, players, pitch, feed
src/components/admin-client.tsx   admin: search/create competition + seed/publish controls
src/components/fixtures-list.tsx  thin schedule view off the events table
src/components/player-avatar.tsx  deterministic SVG player faces
src/app/admin/             admin page + server actions (create/publish/delete competition)
src/app/api/admin/         leagues (provider search) + seed (one resumable step per POST)
src/app/                    landing, login, auth/confirm, dashboard, competition/[slug], league/[id]/draft
supabase/migrations/        schema, RPCs, template helpers, RLS (incl. admin), realtime
supabase/seed.sql           GENERATED (npm run db:dump): offline snapshot of seeded competitions
supabase/functions/auto-pick/     pick-clock Edge Function
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
- Mobile-first; the draft room is the primary screen. My XI renders as a
  tactical 1-4-4-2 pitch with player avatars + rating chips.

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
