-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  Draft Manager — initial schema                                        ║
-- ║  Draft mutations go through SECURITY DEFINER RPCs so turn logic is      ║
-- ║  atomic and race-free; clients only read tables directly (+ realtime).  ║
-- ║                                                                        ║
-- ║  Multi-sport ready: the roster SHAPE is data (a JSONB roster_template   ║
-- ║  per competition), not a hardcoded enum. Football's 1-4-4-2+5 is just   ║
-- ║  one template. Positions are free text scoped to a sport; positionless  ║
-- ║  sports (golf/motorsport) carry an empty template + an explicit size.   ║
-- ╚══════════════════════════════════════════════════════════════════════╝

-- ── Enums ───────────────────────────────────────────────────────────────
create type league_status as enum ('lobby', 'drafting', 'complete');

-- ── Roster-template helpers (read the per-competition JSONB shape) ────────
-- Template shape:
--   { "slots": [ {"code":"GK","label":"Goalkeeper","count":1}, ... ],
--     "bench": 5 }
-- Positionless sports: { "slots": [], "rosterSize": 8 }.
create or replace function template_roster_size(t jsonb) returns int
  language sql immutable as $$
    select coalesce(
      (t->>'rosterSize')::int,
      (select coalesce(sum((s->>'count')::int), 0)
         from jsonb_array_elements(coalesce(t->'slots', '[]'::jsonb)) s)
        + coalesce((t->>'bench')::int, 0)
    );
$$;

create or replace function template_bench(t jsonb) returns int
  language sql immutable as $$ select coalesce((t->>'bench')::int, 0); $$;

create or replace function template_slot_count(t jsonb, p_code text) returns int
  language sql immutable as $$
    select coalesce((
      select (s->>'count')::int
        from jsonb_array_elements(coalesce(t->'slots', '[]'::jsonb)) s
       where s->>'code' = p_code
       limit 1
    ), 0);
$$;

-- Canonical football template (1-4-4-2 XI + 5 flexible subs = 16).
create or replace function football_template() returns jsonb
  language sql immutable as $$
    select '{"slots":[{"code":"GK","label":"Goalkeeper","count":1},{"code":"DEF","label":"Defender","count":4},{"code":"MID","label":"Midfielder","count":4},{"code":"FWD","label":"Forward","count":2}],"bench":5}'::jsonb;
$$;

-- ── Tables ────────────────────────────────────────────────────────────────
create table profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default 'Manager',
  is_admin     boolean not null default false,
  created_at   timestamptz not null default now()
);

-- Reference/config: a sport bundles its provider + default roster template.
-- Adding a sport later = one row + a provider adapter.
create table sports (
  slug                    text primary key,
  name                    text not null,
  provider                text,
  default_roster_template jsonb not null default '{}'::jsonb,
  provider_config         jsonb not null default '{}'::jsonb,
  sort                    int not null default 0
);

-- A competition is a season snapshot: (provider, sport, league, season).
-- The player pool is frozen at seed time, so each draft stays reproducible.
create table competitions (
  id              uuid primary key default gen_random_uuid(),
  slug            text unique not null,
  name            text not null,
  short           text,
  tagline         text,
  theme           text not null,
  sport_slug      text references sports (slug),
  provider        text,                                   -- e.g. 'api-football', or 'manual'
  external_ref    text,                                   -- provider league id
  season          int,
  roster_template jsonb not null default '{}'::jsonb,
  accent          jsonb,                                  -- optional brand overrides {brand,brand2,brandForeground}
  bg_url          text,                                   -- uploaded background art (storage public URL)
  playable        boolean not null default false,
  seed_status     text not null default 'empty',          -- empty | seeding | ready | error
  seed_progress   jsonb,                                  -- {teams_done, teams_total, ...}
  sort            int not null default 0
);

create table leagues (
  id                  uuid primary key default gen_random_uuid(),
  competition_id      uuid not null references competitions (id),
  commissioner_id     uuid not null references profiles (id),
  name                text not null,
  join_code           text unique not null,
  status              league_status not null default 'lobby',
  clock_seconds       int not null default 60,
  current_pick_number int not null default 0,   -- 0 = not started
  pick_deadline       timestamptz,
  created_at          timestamptz not null default now()
);

-- A manager's drafted squad (one per user per league). NOT a real-world club.
create table teams (
  id             uuid primary key default gen_random_uuid(),
  league_id      uuid not null references leagues (id) on delete cascade,
  user_id        uuid not null references profiles (id),
  name           text not null,
  draft_position int,                            -- 1-based seat, set at start
  budget         int not null default 250,       -- transfer-market coins (see draft.ts DEFAULT_TEAM_BUDGET)
  draft_queue    jsonb not null default '[]'::jsonb, -- ordered player ids: pre-draft priorities (drives auto-pick)
  created_at     timestamptz not null default now(),
  unique (league_id, user_id)
);

-- Real-world clubs / national sides the players belong to (seeded from a feed).
create table clubs (
  id             uuid primary key default gen_random_uuid(),
  competition_id uuid not null references competitions (id) on delete cascade,
  provider       text not null default 'manual',
  external_ref   text,
  name           text not null,
  logo_url       text,
  strength       numeric(6,2)                     -- mean rating of best XI (set post-seed)
);
-- Non-partial so it can arbiter upserts (ON CONFLICT). NULL external_ref
-- (manual seed) stays unconstrained: Postgres treats NULLs as distinct.
create unique index clubs_provider_ref_idx
  on clubs (competition_id, provider, external_ref);

create table players (
  id             uuid primary key default gen_random_uuid(),
  competition_id uuid not null references competitions (id) on delete cascade,
  club_id        uuid references clubs (id) on delete set null,
  name           text not null,
  position       text,                            -- sport-scoped code; null = positionless
  club           text not null default '',        -- denormalized name (keeps draft UI simple)
  rating         int not null default 70,         -- provider-derived scalar
  base_value     int not null default 0,          -- immutable seed-time coin value (anchor)
  value          int not null default 0,          -- current coin value (drifts over season)
  provider       text not null default 'manual',
  external_ref   text,
  stats          jsonb                            -- raw provider payload, for recompute
);
create index players_competition_idx on players (competition_id, rating desc);
create index players_value_idx on players (competition_id, value desc);
create unique index players_provider_ref_idx
  on players (competition_id, provider, external_ref);

-- Generic match/event table. Football fixtures (home/away in `result`), but a
-- motorsport GP or golf round (a field + finishing order) fits the same shape.
create table events (
  id             uuid primary key default gen_random_uuid(),
  competition_id uuid not null references competitions (id) on delete cascade,
  provider       text not null default 'manual',
  external_ref   text,
  label          text not null,
  starts_at      timestamptz,
  status         text,
  result         jsonb
);
create index events_competition_idx on events (competition_id, starts_at);
create unique index events_provider_ref_idx
  on events (competition_id, provider, external_ref);

create table draft_picks (
  id          uuid primary key default gen_random_uuid(),
  league_id   uuid not null references leagues (id) on delete cascade,
  team_id     uuid not null references teams (id) on delete cascade,
  player_id   uuid not null references players (id),
  round       int not null,
  pick_number int not null,
  auto_picked boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (league_id, pick_number),
  unique (league_id, player_id)
);
create index draft_picks_team_idx on draft_picks (team_id);

-- ── New auth user → profile ────────────────────────────────────────────
-- Bootstrap admin: emails listed here get is_admin on first login. Adjust for
-- your deployment (or grant later with `update profiles set is_admin=true`).
create or replace function handle_new_user() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  admin_emails text[] := array['cp@codebypanduro.dk'];
begin
  insert into public.profiles (id, display_name, is_admin)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)),
    new.email = any(admin_emails)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ── Admin check (used by RLS write policies) ─────────────────────────────
create or replace function is_admin() returns boolean
  language sql stable security definer set search_path = public as $$
    select coalesce((select is_admin from profiles where id = auth.uid()), false);
$$;

-- ── Snake-draft seat math (mirror of seatForPick in TS) ──────────────────
create or replace function seat_for_pick(p_pick int, p_teams int) returns int
  language sql immutable as $$
    select case
      when (((p_pick - 1) / p_teams) % 2) = 0
        then ((p_pick - 1) % p_teams) + 1
        else p_teams - ((p_pick - 1) % p_teams)
    end;
$$;

-- ── Can a team still draft a given position? (reads the roster template) ──
-- A position is draftable while a template slot for it is open OR the bench has
-- room. Positionless sports: any athlete fits until the roster is full.
create or replace function position_draftable(p_team_id uuid, p_pos text)
  returns boolean language plpgsql stable as $$
declare
  v_template jsonb;
  v_total int;
  v_rsize int;
  v_xi_used int;
  v_bench_open int;
  v_pos_slots int;
  v_pos_count int;
begin
  select c.roster_template into v_template
  from teams tm
  join leagues l     on l.id = tm.league_id
  join competitions c on c.id = l.competition_id
  where tm.id = p_team_id;

  v_rsize := template_roster_size(v_template);

  select count(*) into v_total from draft_picks dp where dp.team_id = p_team_id;
  if v_total >= v_rsize then return false; end if;

  -- Positionless: any athlete fits until the roster is full.
  if coalesce(jsonb_array_length(v_template -> 'slots'), 0) = 0 then
    return true;
  end if;

  -- XI slots consumed = sum over positions of min(count, slot count).
  select coalesce(sum(least(c.cnt, template_slot_count(v_template, c.position))), 0)
    into v_xi_used
  from (
    select pl.position, count(*) cnt
    from draft_picks dp
    join players pl on pl.id = dp.player_id
    where dp.team_id = p_team_id and pl.position is not null
    group by pl.position
  ) c;

  v_bench_open := template_bench(v_template) - (v_total - v_xi_used);

  v_pos_slots := template_slot_count(v_template, p_pos);
  select count(*) into v_pos_count
  from draft_picks dp
  join players pl on pl.id = dp.player_id
  where dp.team_id = p_team_id and pl.position = p_pos;

  return (v_pos_slots - v_pos_count > 0) or (v_bench_open > 0);
end;
$$;

-- ── Player market value (mirror of playerValue in src/lib/draft.ts) ──────
-- Blend the player's own rating with their club strength (mean rating of the
-- club's best XI), then map through a convex curve onto a coin value.
-- Keep the constants in sync with draft.ts (VALUE_* / *_WEIGHT_*).
create or replace function compute_player_value(p_rating numeric, p_strength numeric)
  returns int language sql immutable as $$
    select greatest(
      8,                                                    -- VALUE_FLOOR
      round(
        200 *                                               -- VALUE_MAX
        power(
          least(1, greatest(0,
            (0.7 * p_rating + 0.3 * coalesce(p_strength, p_rating) - 40)  -- blend − FLOOR
            / 55                                            -- VALUE_SCORE_SPAN
          )),
          2.2                                               -- VALUE_CURVE_EXP
        )
      )
    )::int;
$$;

-- Recompute club strength + every player's value for a competition, offline,
-- from ratings already in the table (no provider calls). Used to backfill the
-- snapshot in seed.sql and to recompute after a re-rate. base_value is the
-- anchor; this resets both base_value and current value to the seed blend.
create or replace function recompute_competition_values(p_competition_id uuid)
  returns void language plpgsql set search_path = public as $$
begin
  -- Club strength = mean rating of each club's best 11 players (TEAM_STRENGTH_TOP_N).
  update clubs c set strength = s.avg_top
  from (
    select club_id, avg(rating)::numeric(6,2) as avg_top
    from (
      select club_id, rating,
             row_number() over (partition by club_id order by rating desc) as rn
      from players
      where competition_id = p_competition_id and club_id is not null
    ) ranked
    where rn <= 11
    group by club_id
  ) s
  where c.id = s.club_id and c.competition_id = p_competition_id;

  -- Player value from the blend; players with no club fall back to own rating.
  update players p
  set base_value = compute_player_value(p.rating, c.strength),
      value      = compute_player_value(p.rating, c.strength)
  from clubs c
  where p.club_id = c.id and p.competition_id = p_competition_id;

  update players p
  set base_value = compute_player_value(p.rating, null),
      value      = compute_player_value(p.rating, null)
  where p.competition_id = p_competition_id and p.club_id is null;
end;
$$;

-- ── Generate a unique 6-char join code ───────────────────────────────────
create or replace function gen_join_code() returns text
  language plpgsql as $$
declare
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- no ambiguous chars
  code text;
  i int;
begin
  loop
    code := '';
    for i in 1..6 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from leagues where join_code = code);
  end loop;
  return code;
end;
$$;

-- ── RPC: create a league (caller becomes commissioner + first team) ──────
create or replace function create_league(p_competition_slug text, p_league_name text, p_team_name text)
  returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_comp competitions%rowtype;
  v_league_id uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  select * into v_comp from competitions where slug = p_competition_slug;
  if not found then raise exception 'unknown competition'; end if;
  if not v_comp.playable then raise exception 'competition not yet playable'; end if;

  insert into leagues (competition_id, commissioner_id, name, join_code)
  values (v_comp.id, auth.uid(), coalesce(nullif(trim(p_league_name), ''), v_comp.name || ' League'), gen_join_code())
  returning id into v_league_id;

  insert into teams (league_id, user_id, name)
  values (v_league_id, auth.uid(), coalesce(nullif(trim(p_team_name), ''), 'My Team'));

  return v_league_id;
end;
$$;

-- ── RPC: join a league by code ────────────────────────────────────────────
create or replace function join_league(p_code text, p_team_name text)
  returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_league leagues%rowtype;
  v_count int;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  select * into v_league from leagues where join_code = upper(trim(p_code));
  if not found then raise exception 'no league with that code'; end if;
  if v_league.status <> 'lobby' then raise exception 'draft already started'; end if;

  if exists (select 1 from teams where league_id = v_league.id and user_id = auth.uid()) then
    return v_league.id; -- already in
  end if;

  select count(*) into v_count from teams where league_id = v_league.id;
  if v_count >= 20 then raise exception 'league is full (20 teams)'; end if;

  insert into teams (league_id, user_id, name)
  values (v_league.id, auth.uid(), coalesce(nullif(trim(p_team_name), ''), 'New Team'));

  return v_league.id;
end;
$$;

-- ── RPC: start the draft (commissioner only) ──────────────────────────────
create or replace function start_draft(p_league_id uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_league leagues%rowtype;
  v_count int;
  r record;
  seat int := 1;
begin
  select * into v_league from leagues where id = p_league_id for update;
  if not found then raise exception 'league not found'; end if;
  if v_league.commissioner_id <> auth.uid() then raise exception 'only the commissioner can start'; end if;
  if v_league.status <> 'lobby' then raise exception 'draft already started'; end if;

  select count(*) into v_count from teams where league_id = p_league_id;
  if v_count < 2 then raise exception 'need at least 2 teams'; end if;

  -- Randomize the snake order.
  for r in select id from teams where league_id = p_league_id order by random() loop
    update teams set draft_position = seat where id = r.id;
    seat := seat + 1;
  end loop;

  update leagues
    set status = 'drafting',
        current_pick_number = 1,
        pick_deadline = now() + (v_league.clock_seconds || ' seconds')::interval
  where id = p_league_id;
end;
$$;

-- ── Internal: record a pick + advance the clock (shared by human + auto) ──
create or replace function record_pick(p_league_id uuid, p_team_id uuid, p_player_id uuid, p_auto boolean)
  returns void language plpgsql as $$
declare
  v_league leagues%rowtype;
  v_team_count int;
  v_round int;
  v_pos text;
  v_player_comp uuid;
  v_rsize int;
begin
  select * into v_league from leagues where id = p_league_id for update;
  if v_league.status <> 'drafting' then raise exception 'draft not active'; end if;

  select count(*) into v_team_count from teams where league_id = p_league_id;
  v_round := ((v_league.current_pick_number - 1) / v_team_count) + 1;

  -- Validate the player belongs to this league's competition and is free.
  select position, competition_id into v_pos, v_player_comp from players where id = p_player_id;
  if v_player_comp <> v_league.competition_id then raise exception 'player not in this competition'; end if;
  if exists (select 1 from draft_picks where league_id = p_league_id and player_id = p_player_id) then
    raise exception 'player already drafted';
  end if;
  if not position_draftable(p_team_id, v_pos) then raise exception 'no roster slot for that position'; end if;

  insert into draft_picks (league_id, team_id, player_id, round, pick_number, auto_picked)
  values (p_league_id, p_team_id, p_player_id, v_round, v_league.current_pick_number, p_auto);

  select template_roster_size(c.roster_template) into v_rsize
  from competitions c where c.id = v_league.competition_id;

  -- Advance, or complete.
  if v_league.current_pick_number >= v_team_count * v_rsize then
    update leagues set status = 'complete', pick_deadline = null, current_pick_number = current_pick_number + 1
      where id = p_league_id;
  else
    update leagues
      set current_pick_number = current_pick_number + 1,
          pick_deadline = now() + (v_league.clock_seconds || ' seconds')::interval
      where id = p_league_id;
  end if;
end;
$$;

-- ── RPC: human makes a pick ────────────────────────────────────────────────
create or replace function make_pick(p_league_id uuid, p_player_id uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_league leagues%rowtype;
  v_team_count int;
  v_seat int;
  v_team teams%rowtype;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  select * into v_league from leagues where id = p_league_id;
  if v_league.status <> 'drafting' then raise exception 'draft not active'; end if;

  select count(*) into v_team_count from teams where league_id = p_league_id;
  v_seat := seat_for_pick(v_league.current_pick_number, v_team_count);

  select * into v_team from teams where league_id = p_league_id and draft_position = v_seat;
  if v_team.user_id <> auth.uid() then raise exception 'not your pick'; end if;

  perform record_pick(p_league_id, v_team.id, p_player_id, false);
end;
$$;

-- ── RPC: set a manager's pre-draft priority queue (own team only) ──────────
-- Ordered array of player ids; auto-pick consumes it top-down. Stored as jsonb
-- on the caller's team. Cleans the input to players in this competition,
-- preserving order and dropping duplicates.
create or replace function set_draft_queue(p_league_id uuid, p_player_ids uuid[])
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_team_id uuid;
  v_comp uuid;
  v_clean uuid[];
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  select competition_id into v_comp from leagues where id = p_league_id;
  if v_comp is null then raise exception 'league not found'; end if;

  select id into v_team_id from teams
   where league_id = p_league_id and user_id = auth.uid();
  if v_team_id is null then raise exception 'no team in this league'; end if;

  -- Keep only real players in this competition, first occurrence wins, order kept.
  select coalesce(array_agg(pid order by ord), '{}'::uuid[]) into v_clean
  from (
    select pid, min(ord) as ord
    from unnest(p_player_ids) with ordinality as u(pid, ord)
    where exists (
      select 1 from players p where p.id = u.pid and p.competition_id = v_comp
    )
    group by pid
  ) s;

  update teams set draft_queue = to_jsonb(v_clean) where id = v_team_id;
end;
$$;

-- ── RPC: auto-pick for whoever is on the clock (Edge Function calls this) ──
-- Honors the team's draft queue (first available + draftable), else falls back
-- to the highest-rated available player that fits an open slot.
-- Idempotent-ish: only acts if the deadline has actually passed.
create or replace function auto_pick(p_league_id uuid)
  returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_league leagues%rowtype;
  v_team_count int;
  v_seat int;
  v_team teams%rowtype;
  v_player_id uuid;
begin
  select * into v_league from leagues where id = p_league_id for update;
  if v_league.status <> 'drafting' then return false; end if;
  if v_league.pick_deadline is null or v_league.pick_deadline > now() then
    return false; -- clock hasn't expired
  end if;

  select count(*) into v_team_count from teams where league_id = p_league_id;
  v_seat := seat_for_pick(v_league.current_pick_number, v_team_count);
  select * into v_team from teams where league_id = p_league_id and draft_position = v_seat;

  -- 1) The team's queue: first queued player still available + roster-eligible.
  select pq.pid into v_player_id
  from (
    select (elem)::uuid as pid, ord
    from jsonb_array_elements_text(coalesce(v_team.draft_queue, '[]'::jsonb))
      with ordinality as q(elem, ord)
  ) pq
  join players p on p.id = pq.pid and p.competition_id = v_league.competition_id
  where not exists (select 1 from draft_picks dp where dp.league_id = p_league_id and dp.player_id = pq.pid)
    and position_draftable(v_team.id, p.position)
  order by pq.ord
  limit 1;

  -- 2) Fallback: best available player that fits a roster slot for this team.
  if v_player_id is null then
    select p.id into v_player_id
    from players p
    where p.competition_id = v_league.competition_id
      and not exists (select 1 from draft_picks dp where dp.league_id = p_league_id and dp.player_id = p.id)
      and position_draftable(v_team.id, p.position)
    order by p.rating desc, p.id
    limit 1;
  end if;

  if v_player_id is null then raise exception 'no eligible player for auto-pick'; end if;

  perform record_pick(p_league_id, v_team.id, v_player_id, true);
  return true;
end;
$$;

-- ── Base reference data: the football sport (provider seam) ───────────────
insert into sports (slug, name, provider, default_roster_template, provider_config, sort)
values (
  'football', 'Football', 'api-football',
  football_template(),
  '{"host":"v3.football.api-sports.io","ratingSeasons":2}'::jsonb,
  1
)
on conflict (slug) do nothing;

-- ── Row Level Security ─────────────────────────────────────────────────────
-- Reads are open to authenticated users (prototype). Draft writes happen through
-- the SECURITY DEFINER RPCs above. Catalog tables (competitions/clubs/players/
-- events/sports) are writable only by admins (is_admin()), used by the seeder.
alter table profiles     enable row level security;
alter table sports       enable row level security;
alter table competitions enable row level security;
alter table leagues      enable row level security;
alter table teams        enable row level security;
alter table clubs        enable row level security;
alter table players      enable row level security;
alter table events       enable row level security;
alter table draft_picks  enable row level security;

create policy "profiles readable"      on profiles     for select to authenticated using (true);
create policy "update own profile"     on profiles     for update to authenticated using (id = auth.uid());
create policy "sports readable"        on sports       for select to authenticated using (true);
create policy "competitions readable"  on competitions for select to authenticated using (true);
create policy "leagues readable"       on leagues      for select to authenticated using (true);
create policy "teams readable"         on teams        for select to authenticated using (true);
create policy "clubs readable"         on clubs        for select to authenticated using (true);
create policy "players readable"       on players      for select to authenticated using (true);
create policy "events readable"        on events       for select to authenticated using (true);
create policy "picks readable"         on draft_picks  for select to authenticated using (true);

-- Admin writes (the seeder runs as a service role, which bypasses RLS; these
-- policies cover admin UI calls made with the user's own session).
create policy "admin writes sports"       on sports       for all to authenticated using (is_admin()) with check (is_admin());
create policy "admin writes competitions" on competitions for all to authenticated using (is_admin()) with check (is_admin());
create policy "admin writes clubs"        on clubs        for all to authenticated using (is_admin()) with check (is_admin());
create policy "admin writes players"      on players      for all to authenticated using (is_admin()) with check (is_admin());
create policy "admin writes events"       on events       for all to authenticated using (is_admin()) with check (is_admin());

-- Commissioner may delete a member from the lobby (kick).
create policy "commissioner deletes team" on teams for delete to authenticated
  using (
    exists (
      select 1 from leagues l
      where l.id = teams.league_id
        and l.commissioner_id = auth.uid()
        and l.status = 'lobby'
    )
    and teams.user_id <> auth.uid()
  );

-- ── Storage: competition art (public bucket; admin uploads via service role) ──
insert into storage.buckets (id, name, public)
values ('competition-art', 'competition-art', true)
on conflict (id) do nothing;

-- ── Realtime ───────────────────────────────────────────────────────────────
alter publication supabase_realtime add table leagues;
alter publication supabase_realtime add table teams;
alter publication supabase_realtime add table draft_picks;
alter publication supabase_realtime add table competitions;
