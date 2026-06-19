-- Dev seed: a ready-to-play league of test managers with preselected squads.
-- gaffer@demo.dev is the commissioner; every '%@demo.dev' user joins; the draft
-- is auto-completed so each team has a full squad; optionally pre-play N rounds
-- (psql var `rounds`, default 0 = season open at round 1).
--
-- Driven by scripts/seed-dev-league.sh (which creates the auth users first).
\set ON_ERROR_STOP on
\if :{?rounds} \else \set rounds 0 \endif

create or replace function _as(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, false);
$$;

select id as gaffer from auth.users where email = 'gaffer@demo.dev' \gset

-- Fresh each run.
delete from leagues where name = 'Demo Season';

select _as(:'gaffer');
select create_league('world-cup', 'Demo Season', 'The Gaffers') as league_id \gset
select set_config('demo.league', :'league_id', false);
select set_config('demo.rounds', :'rounds', false);

-- Every other demo manager joins.
do $$
declare r record; code text; lg uuid := current_setting('demo.league')::uuid;
begin
  select join_code into code from leagues where id = lg;
  for r in
    select id, email from auth.users
    where email like '%@demo.dev' and email <> 'gaffer@demo.dev'
    order by email
  loop
    perform _as(r.id);
    perform join_league(code, initcap(split_part(r.email, '@', 1)) || ' FC');
  end loop;
end $$;

-- Commissioner starts; auto-pick fills every squad (the "preselected team").
select _as(:'gaffer');
select start_draft(:'league_id');
do $$
declare st league_status; lg uuid := current_setting('demo.league')::uuid;
begin
  loop
    select status into st from leagues where id = lg;
    exit when st = 'complete';
    update leagues set pick_deadline = now() - interval '1 second' where id = lg;
    perform auto_pick(lg);
  end loop;
end $$;

-- Optionally pre-play some rounds so there's history to look at.
select _as(:'gaffer');
do $$
declare lg uuid := current_setting('demo.league')::uuid;
        n int := current_setting('demo.rounds')::int; i int;
begin
  for i in 1..n loop
    exit when (select season_status from leagues where id = lg) <> 'in_season';
    perform play_round(lg);
  end loop;
end $$;

drop function _as(uuid);

\echo '=== Demo league ready ==='
select name, join_code, season_status,
       current_round || '/' || total_rounds as round
from leagues where name = 'Demo Season';
