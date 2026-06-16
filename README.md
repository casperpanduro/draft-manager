# Draft Manager

A mobile-first, multiplayer **drafting game**. Create a league for a real
competition, invite friends with a code, and draft a squad live via a snake
draft with a pick clock. See [`SPEC.md`](./SPEC.md) for the full design.

Prototype scope: lobby → invite → live snake draft → final rosters. Scoring,
standings and real player data come later.

## Stack

- Next.js 16 (App Router) · React 19 · TypeScript
- Tailwind v4 + shadcn/ui (Base UI), per-league theming via CSS variables
- Supabase: Postgres, Auth (magic link), Realtime, Edge Functions
- Draft mutations run through `SECURITY DEFINER` RPCs (atomic, race-free);
  the pick clock is enforced by the `auto-pick` Edge Function (with a client
  fallback so the draft always advances in dev).

## Prerequisites

- Node 20+
- Docker (for the local Supabase stack)
- Supabase CLI

## Run it locally

```bash
# 1. Start the local Supabase stack (Postgres, Auth, Realtime, Studio…)
supabase start

# 2. Apply schema + seed (4 competitions + 512 World Cup players)
npm run db:reset

# 3. Start Next.js
npm run dev
```

`.env.local` is preconfigured for the default local Supabase ports. If
`supabase start` prints a different publishable key, update
`NEXT_PUBLIC_SUPABASE_ANON_KEY`.

Open http://localhost:3000.

### Signing in (local)

Auth uses magic links. Locally, emails are captured by **Mailpit** at
http://127.0.0.1:54324 — sign in, open the link there to complete login. Open a
second browser/incognito window to play as a second manager.

### The pick clock

When the clock expires, the on-the-clock client calls the `auto-pick` Edge
Function (best-available player that fits an open slot). The DB re-checks the
deadline under a row lock, so redundant calls are safe.

To run the Edge Function locally (optional — there's a client RPC fallback):

```bash
npm run functions:serve
```

In production, also invoke `auto-pick` on a schedule (e.g. Supabase scheduled
trigger / pg_cron) so drafts advance even when no client is connected.

## Project layout

```
src/app/                  routes (landing, login, dashboard, league lobby, draft)
src/components/           draft-room, lobby-client, dashboard-actions, brand-header
src/lib/draft.ts          roster rules + snake-draft math (mirrored in SQL)
src/lib/competitions.ts   competition → theme metadata
src/lib/supabase/         browser/server/proxy clients
supabase/migrations/      schema, RPCs, RLS, realtime publication
supabase/seed.sql         competitions + World Cup player pool
supabase/functions/       auto-pick Edge Function
```

## Adding a competition later

1. Add a `[data-theme="…"]` block in `src/app/globals.css`.
2. Add an entry to `COMPETITIONS` in `src/lib/competitions.ts`.
3. Insert a row in `competitions` (set `playable = true`) and seed its players.

No engine changes needed — the draft is competition-agnostic.
