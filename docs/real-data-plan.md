# Real-Data + Multi-Sport Seeding — Implementation Plan

Fetch real sports data from api-football (the API-SPORTS family, already used for
tipset.dk) to seed competitions, clubs, players and matches. Add an admin
interface to add a competition and seed it from the API. Keep the architecture
open to other sports (handball, golf, motorsport) without rewrites.

## Design decisions (settled)

- **Football real-data now, multi-sport-ready architecture** — no golf/F1
  adapters yet, but nothing in the core blocks them.
- Roster shape is **data, not code**: per-competition **JSONB roster template**;
  `position` becomes **free text**; the `player_position` enum goes away.
- A **competition = (provider, sport, external league id, season)** — an
  immutable season snapshot. Drafts stay reproducible; player pool is frozen at
  seed time.
- Admin = **`is_admin` flag** on `profiles`; seeding runs in a **Next server
  route/action** holding the api-football key + Supabase service-role key
  (both server-only env). No new Edge Function.
- **Idempotent upserts** keyed by `(provider, external_ref)`; **per-team chunked,
  resumable** seed tracked via `seed_status` / `seed_progress`.
- `rating` is a **provider-derived scalar** (composite, position-aware,
  recency-weighted over the **last ~2 completed seasons** ≈ "last 100 matches",
  assembled from cheap aggregate calls) + raw `stats` JSONB for recompute.
  Rating derivation is the **adapter's** job; the draft engine only reads the
  scalar, so F1 (points) / golf (ranking) can plug in later unchanged.
- Generic **`events`** table seeded with football fixtures now (home/away in
  `result` JSONB); per-athlete match scoring deferred to the scoring phase.
- New **`clubs`** table (real teams), FK from `players` **alongside** the
  denormalized `players.club` text so the draft UI is untouched.
- Procedural World Cup seed **kept** as offline fallback, tagged
  `provider = 'manual'`; `db:reset` still yields a playable WC with no API key.

## Why these (cold-start + data-shape notes)

- api-football has no flat "competition" — it's **league + season**; `/players`
  is season-scoped and paginated. Hence the season-snapshot model.
- WC 2026 is a cold-start (no matches to rate from, squads possibly thin), so
  rating leans on players' **club** seasons, not the tournament itself.
- "Last 100 matches" has no direct endpoint; per-fixture pulls would shred the
  rate limit. We approximate with the **last N (default 2) completed seasons'
  aggregates**, recency-weighted. `N` is a per-sport config knob.
- Other sports are **separate API-SPORTS hosts** (api-handball, api-formula-1)
  and golf isn't in the catalog at all — so `provider` + per-sport base URL/key
  is the seam, wired only for football now.

## Workstreams

### 1. Schema migration (`supabase/migrations/`, new file)

- `sports` table: `slug, name, provider, default_roster_template jsonb,
  provider_config jsonb`. Seed `football`.
- Extend `competitions`: `sport_slug fk`, `provider`, `external_ref`,
  `season int`, `roster_template jsonb`, optional `accent` overrides,
  `seed_status text default 'empty'`, `seed_progress jsonb`. Keep existing
  `slug / theme / tagline / playable`.
- New `clubs`: `id, competition_id, provider, external_ref, name, logo_url`,
  unique `(provider, external_ref, competition_id)`. For WC a "club" = a nation.
- Alter `players`: drop the enum → `position text` (nullable for positionless
  sports), add `club_id fk`, `provider`, `external_ref`, `stats jsonb`; keep
  `club` text + `rating`. Unique `(provider, external_ref)`. Tag existing
  procedural rows `provider = 'manual'`.
- New `events`: `id, competition_id, provider, external_ref, label, starts_at,
  status, result jsonb`.
- **Rewrite draft RPCs** to read the JSONB roster template instead of
  `xi_slots()` / the enum: `position_draftable` (+ positionless branch → "draft
  any athlete until rosterSize"), `auto_pick`, `record_pick`. Drop the three
  hardcoded SQL roster functions (`xi_slots`, `bench_size`, `roster_size`).
- RLS: admin write policies on `competitions / clubs / players / events`; reads
  stay open to authenticated.
- After: `npm run db:reset` then `npm run db:types`.

### 2. Draft-engine TS mirror (`src/lib/draft.ts`)

- Replace hardcoded `XI_SLOTS` / `BENCH_SIZE` with template-driven functions
  taking a `RosterTemplate`; add the positionless path. Keep public signatures
  stable so `src/components/draft-room.tsx` is untouched.

### 3. Provider layer (`src/lib/providers/`)

- `Provider` interface: `searchLeagues`, `getSeasons`, `getTeams`,
  `getPlayers(team, season)`, `getFixtures`, `deriveRating(stats[])`.
- `api-football.ts` adapter: base URL + key from `provider_config`; position
  mapping (`Goalkeeper→GK`, `Defender→DEF`, `Midfielder→MID`, `Attacker→FWD`);
  composite, position-aware, recency-weighted rating normalized to ~40–99 (raw
  payload → `players.stats`).

### 4. Seeding pipeline (Next server route/action)

- Service-role + API key from server-only env. Resumable, per-team chunked:
  upsert clubs → upsert players (per team, with stats + rating) → upsert fixtures
  → flip `seed_status`. Persist `seed_progress`; respect rate limits with batched
  delays between chunks.

### 5. Admin UI (`/admin`, `is_admin`-gated)

- League **search-and-pick** (`/leagues?search=` server-side) → season dropdown
  (from the API's `seasons`) → sport select (prefills roster template, editable)
  → theme pick (+ optional accent) → create → **Seed** button with live progress
  poll → flip `playable` on `seed_status = ready`.

### 6. Config / docs

- `.env`: `API_FOOTBALL_KEY`, `API_FOOTBALL_HOST`, `SUPABASE_SERVICE_ROLE_KEY`.
- Update `AGENTS.md` (data model, provider seam, admin). `src/lib/competitions.ts`
  static `COMPETITIONS` map becomes a **fallback**; DB row is source of truth.

## Sequencing

1. Migration + draft-RPC rewrite + `draft.ts` mirror — verify the existing WC
   draft still works on the `manual` provider **before** any API code exists.
2. Provider interface + api-football adapter (unit-test rating / position map).
3. Seeding route (idempotency + resume).
4. Admin UI.
5. Events/fixtures display (thin); scoring is its own later phase.

## Verify gates

- `npx tsc --noEmit`, `npm run lint`, `npm run build`.
- A real seed of one domestic league (clubs + players + fixtures, re-run = no
  dupes).
- `npm run db:reset` still yields a playable World Cup offline (no API key).

## Risk

Step 1 is riskiest: the draft RPCs are currently enum / `xi_slots`-coupled, and
a regression breaks live drafting. Land + verify the template-driven rewrite
against the existing `manual` WC pool before writing any API code.
