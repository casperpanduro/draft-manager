-- End-to-end season engine test: 2-manager draft → 3 simulated rounds.
-- Run: docker exec -i supabase_db_draft-manager psql -U postgres -d postgres < scripts/test-season.sql
\set ON_ERROR_STOP on

-- Two fake auth users (trigger creates profiles).
insert into auth.users (id, email, instance_id, aud, role)
values ('11111111-1111-1111-1111-111111111111', 'a@test.dev', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
       ('22222222-2222-2222-2222-222222222222', 'b@test.dev', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')
on conflict (id) do nothing;

-- Helper to impersonate a user for auth.uid().
create or replace function _as(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p, 'role','authenticated')::text, false);
$$;

-- A creates a league, B joins.
select _as('11111111-1111-1111-1111-111111111111');
select create_league('world-cup', 'Test League', 'Team A') as league_id \gset
select set_config('test.league', :'league_id', false);
select _as('22222222-2222-2222-2222-222222222222');
select join_league((select join_code from leagues where id = :'league_id'), 'Team B');

-- A starts the draft.
select _as('11111111-1111-1111-1111-111111111111');
select start_draft(:'league_id');

-- Auto-pick the whole draft (force the clock each time).
do $$
declare n int; st league_status; lg uuid := current_setting('test.league')::uuid;
begin
  for n in 1..1000 loop
    select status into st from leagues where id = lg;
    exit when st = 'complete';
    update leagues set pick_deadline = now() - interval '1 second' where id = lg;
    perform auto_pick(lg);
  end loop;
end $$;

\echo '=== after draft: season state ==='
select season_status, current_round, total_rounds from leagues where id = :'league_id';
select t.name, count(tp.*) squad, t.budget
from teams t left join team_players tp on tp.team_id = t.id
where t.league_id = :'league_id' group by t.name, t.budget order by t.name;

\echo '=== round-1 default lineup (Team A) sizes ==='
select t.name,
       jsonb_array_length(tr.lineup->'xi') xi, jsonb_array_length(tr.lineup->'bench') bench
from team_rounds tr join teams t on t.id = tr.team_id
where tr.league_id = :'league_id' and tr.round = 1 order by t.name;

-- Commissioner plays all rounds.
select _as('11111111-1111-1111-1111-111111111111');
do $$
declare ss text; lg uuid := current_setting('test.league')::uuid;
begin
  loop
    select season_status into ss from leagues where id = lg;
    exit when ss <> 'in_season';
    perform play_round(lg);
  end loop;
end $$;

\echo '=== after season: standings ==='
select t.name, sum(tr.points) total_pts, count(*) rounds_played
from team_rounds tr join teams t on t.id = tr.team_id
where tr.league_id = :'league_id' and tr.points is not null
group by t.name order by total_pts desc;

\echo '=== per-round points ==='
select t.name, tr.round, tr.points
from team_rounds tr join teams t on t.id = tr.team_id
where tr.league_id = :'league_id' and tr.points is not null
order by tr.round, t.name;

\echo '=== match_results sample (round 1) ==='
select home, home_goals, away_goals, away from match_results
where league_id = :'league_id' and round = 1 limit 5;

\echo '=== top scorers round 1 ==='
select p.name, p.position, p.club, ps.points
from player_scores ps join players p on p.id = ps.player_id
where ps.league_id = :'league_id' and ps.round = 1
order by ps.points desc limit 8;

\echo '=== final league state ==='
select season_status, current_round, total_rounds from leagues where id = :'league_id';

-- cleanup
delete from leagues where id = :'league_id';
delete from auth.users where email in ('a@test.dev','b@test.dev');
drop function _as(uuid);
