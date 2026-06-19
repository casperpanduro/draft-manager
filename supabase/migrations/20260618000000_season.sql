-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  Season Mode — post-draft manager loop (schema)                        ║
-- ║                                                                        ║
-- ║  Adds the season layer on top of the draft: per-round simulated        ║
-- ║  scoring, lineups + substitutions, free-agent transfers, and team      ║
-- ║  progression. Like the draft, ALL season mutations go through          ║
-- ║  SECURITY DEFINER RPCs (added in the next migration); clients only     ║
-- ║  read these tables + subscribe to realtime. See SEASON.md.             ║
-- ║                                                                        ║
-- ║  Scoring is SIMULATED for now (deterministic per league+round) behind  ║
-- ║  the same seam a live stats feed will later fill: the source of        ║
-- ║  `player_scores` rows. Nothing downstream depends on how they appear.  ║
-- ╚══════════════════════════════════════════════════════════════════════╝

-- ── League: season progression + transfer rules ──────────────────────────
-- `current_round` = the round currently OPEN for lineup/transfer edits and next
-- to be played (set to 1 at draft completion; 0 = season not started yet).
-- `season_status`: draft → in_season → finished.
alter table leagues
  add column current_round           int  not null default 0,
  add column total_rounds            int  not null default 0,
  add column season_status           text not null default 'draft',
  add column free_transfers_per_round int not null default 3,
  add column transfer_fee            int  not null default 25;

-- NOTE: teams.budget already exists (default 250; mirrors DEFAULT_TEAM_BUDGET
-- in src/lib/draft.ts) — reused here as the transfer-market coin balance.

-- ── Fixture rounds (derived) ─────────────────────────────────────────────
-- Rounds are anchored to the real fixture calendar. We DERIVE the round from
-- each fixture's date rather than storing it: migrations run before seed.sql,
-- so a stored backfill would find no rows. Bucketing by ISO week gives a clean
-- "gameweek" per competition (group matchdays + each knockout stage land in
-- their own week, close enough for the prototype). Going live: replace this
-- view with the provider's real round/stage (api-football `league.round`).
create view event_rounds as
  select
    e.id,
    e.competition_id,
    e.label,
    e.starts_at,
    e.status,
    e.result,
    dense_rank() over (
      partition by e.competition_id
      order by date_trunc('week', e.starts_at)
    )::int as round
  from events e
  where e.starts_at is not null;

-- Total rounds for a competition (max derived round). Used to know when a
-- league's season is finished.
create or replace function competition_total_rounds(p_competition_id uuid)
  returns int language sql stable as $$
    select coalesce(max(round), 0) from event_rounds
    where competition_id = p_competition_id;
$$;

-- ── Current squad (live roster after transfers) ──────────────────────────
-- Seeded from draft_picks when the draft completes; draft_picks stays the
-- immutable draft record. A free agent = a competition player with no row here
-- for the league. Transfers DELETE the outgoing row + INSERT the incoming one,
-- so ownership is always exactly the set of rows present.
create table team_players (
  id             uuid primary key default gen_random_uuid(),
  league_id      uuid not null references leagues (id) on delete cascade,
  team_id        uuid not null references teams (id) on delete cascade,
  player_id      uuid not null references players (id),
  acquired_round int  not null default 0,            -- 0 = from the draft
  created_at     timestamptz not null default now(),
  unique (league_id, player_id)                       -- one squad per player per league
);
create index team_players_team_idx on team_players (team_id);

-- ── Per-team, per-round lineup + score ───────────────────────────────────
-- lineup = {"xi":[player_id,...], "bench":[player_id,...]} (the post-auto-sub
-- XI is snapshotted here when the round plays). `points` is null until played;
-- `locked` flips true the moment the commissioner plays the round.
create table team_rounds (
  id         uuid primary key default gen_random_uuid(),
  league_id  uuid not null references leagues (id) on delete cascade,
  team_id    uuid not null references teams (id) on delete cascade,
  round      int  not null,
  lineup     jsonb not null default '{"xi":[],"bench":[]}'::jsonb,
  points     int,
  locked     boolean not null default false,
  created_at timestamptz not null default now(),
  unique (league_id, team_id, round)
);
create index team_rounds_league_round_idx on team_rounds (league_id, round);

-- ── Per-player, per-round performance ────────────────────────────────────
-- The scoring seam. Simulated today (deterministic per league+round+player),
-- a real per-competition stats feed later. stats = {played, goals,
-- clean_sheet, conceded, ...} for the light position-aware model.
create table player_scores (
  id         uuid primary key default gen_random_uuid(),
  league_id  uuid not null references leagues (id) on delete cascade,
  round      int  not null,
  player_id  uuid not null references players (id),
  points     int  not null default 0,
  stats      jsonb,
  unique (league_id, round, player_id)
);
create index player_scores_round_idx on player_scores (league_id, round);

-- ── Per-round match results (per league) ─────────────────────────────────
-- The simulated scoreline for each fixture in a played round. Simulated now
-- (deterministic per league+round+fixture from club strength); a live feed
-- fills the same table later. Drives both player scoring and the Fixtures tab.
create table match_results (
  id         uuid primary key default gen_random_uuid(),
  league_id  uuid not null references leagues (id) on delete cascade,
  round      int  not null,
  event_id   uuid not null references events (id) on delete cascade,
  home       text not null,
  away       text not null,
  home_goals int  not null,
  away_goals int  not null,
  created_at timestamptz not null default now(),
  unique (league_id, event_id)
);
create index match_results_round_idx on match_results (league_id, round);

-- ── Transfer log (free-agent pickups) ────────────────────────────────────
-- One row per completed transfer for the round it applies to. `fee` is what was
-- charged against teams.budget (0 for the round's free transfers, else
-- leagues.transfer_fee). The squad change itself lives in team_players.
create table transfers (
  id            uuid primary key default gen_random_uuid(),
  league_id     uuid not null references leagues (id) on delete cascade,
  team_id       uuid not null references teams (id) on delete cascade,
  round         int  not null,
  out_player_id uuid not null references players (id),
  in_player_id  uuid not null references players (id),
  fee           int  not null default 0,
  created_at    timestamptz not null default now()
);
create index transfers_team_round_idx on transfers (team_id, round);

-- ── Row Level Security ───────────────────────────────────────────────────
-- Same model as the draft: authenticated reads are open; writes happen only
-- through SECURITY DEFINER RPCs (which run as owner and bypass RLS). No write
-- policies → clients cannot mutate season state directly.
alter table team_players  enable row level security;
alter table team_rounds   enable row level security;
alter table player_scores enable row level security;
alter table match_results enable row level security;
alter table transfers     enable row level security;

create policy "team_players readable"  on team_players  for select to authenticated using (true);
create policy "team_rounds readable"   on team_rounds   for select to authenticated using (true);
create policy "player_scores readable" on player_scores for select to authenticated using (true);
create policy "match_results readable" on match_results for select to authenticated using (true);
create policy "transfers readable"     on transfers     for select to authenticated using (true);

-- ── Realtime ─────────────────────────────────────────────────────────────
-- leagues is already in the publication (current_round changes ride along).
alter publication supabase_realtime add table team_players;
alter publication supabase_realtime add table team_rounds;
alter publication supabase_realtime add table player_scores;
alter publication supabase_realtime add table match_results;
alter publication supabase_realtime add table transfers;
