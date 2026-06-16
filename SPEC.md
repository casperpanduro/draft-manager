# Draft Manager — Prototype Spec

A mobile-first, multiplayer **drafting game**. Create a league for a real competition,
invite friends with a code, and when the commissioner starts it, everyone drafts a squad
live via a **snake draft**. The prototype ends at final rosters — scoring/standings come
later with real data.

## Stack

- **Next.js (App Router)** + **Supabase** (Postgres, Auth, **Realtime**)
- **Tailwind v4 + shadcn/ui**, theming via CSS variables / `data-theme`
- Pick-clock authority via a **Supabase Edge Function**
- **Mobile-first**, responsive up to desktop

## Identity & leagues

- Supabase **magic-link auth** (Google OAuth a later add).
- One user → **many leagues**, **one team per league**; a dashboard lists all of them.
- Create league → pick a **competition** from a themed preset list (World Cup, Premier
  League, Serie A, Super League…). All shown in their real colors; **only World Cup is
  playable** now, the rest are "Coming soon" tiles.
- **Commissioner** (creator) owns the invite code, can kick a member pre-draft, and presses
  **Start Draft**. 2–20 human teams. Start whenever ready.

## The draft

- **Snake draft**, round-1 order **randomized** at start over exactly who's present.
- League **locks** on start (no new joiners).
- **Roster = 16:** starting XI in **1-4-4-2** (1 GK, 4 DEF, 4 MID, 2 FWD) **+ 5 flexible
  subs** → **16 rounds**.
- **Auto-slotting:** a pick fills an open XI slot for its position; if that position's XI
  slots are full, it goes to the bench; a position is only blocked when both its XI slots
  *and* the bench are full.
- **Pick clock** (default 60s) stored as `pick_deadline` in the DB; on timeout an Edge
  Function **auto-drafts the best available** fitting player and advances.
- **Disconnect/AFK:** auto-pick covers absent drafters; **rejoin rebuilds live state from
  the DB**; refresh-safe.
- Player pool: **seeded fake World Cup footballers** with positions (≥320 to cover 20×16),
  swappable for real data later.
- After the last pick → **final rosters** screen.

## Data model (sketch)

- `profiles` — user (id → auth.users, display_name)
- `competitions` — slug, name, theme tokens (colors/logo), `playable` flag
- `leagues` — competition_id, commissioner_id, join_code, status
  (`lobby` / `drafting` / `complete`), clock_seconds
- `teams` — user_id, league_id, name, draft_position (one row per member per league)
- `players` — competition_id, name, position (GK/DEF/MID/FWD), club, rating
- `draft_picks` — league_id, team_id, player_id, round, pick_number, auto_picked
- `draft_state` — league_id, current_pick_number, current_team_id, pick_deadline

## Roster rules

```
XI (1-4-4-2):  GK x1, DEF x4, MID x4, FWD x2   = 11
Bench:         any position                    =  5
Total / rounds:                                  16
```

A player of position P can be drafted while: (open XI slot for P) OR (bench has room).
Blocked only when P's XI slots are full AND bench is full.

## Build order

1. Auth + dashboard + create/join league (code) + lobby with live presence.
2. Seed World Cup player pool + competitions/themes.
3. Draft engine: snake order, turn state, pick mutation + auto-slot rules.
4. Realtime sync (broadcast picks + presence) + reconnect-from-DB.
5. Pick clock + Edge Function auto-pick.
6. Final rosters screen.
7. Theming polish across competitions.

## Out of scope (later)

- Scoring, standings, the post-draft season loop.
- Real player data feeds per competition.
- Auction drafts, configurable rosters, co-managers, pause/undo, spectators.
