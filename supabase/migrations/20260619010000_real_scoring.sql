-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  Real scoring — event-driven points from real per-fixture player data  ║
-- ║                                                                        ║
-- ║  Replaces the simulated-points model with an event-driven one fed by    ║
-- ║  REAL api-football per-fixture player stats (catalog table              ║
-- ║  player_match_stats, admin-seeded + snapshotted to seed.sql). play_round║
-- ║  scores from that catalog; when a round has no real data yet it falls   ║
-- ║  back to a deterministic SIMULATION (only if leagues.sim_fallback is on  ║
-- ║  — the offline/demo default). Both paths run the SAME scoring formula    ║
-- ║  (score_player_match), which is MIRRORED in src/lib/scoring.ts.          ║
-- ║  See SCORING.md.                                                         ║
-- ╚══════════════════════════════════════════════════════════════════════╝

-- ── Catalog: real per-player, per-fixture raw stats ──────────────────────
-- The scoring seam. Admin-seeded from api-football (fixtures/players) for
-- finished fixtures, idempotent on (competition_id, event_id, player_id), and
-- snapshotted into seed.sql so db:reset reproduces it offline. A live feed
-- writes the same rows later — nothing downstream changes.
create table player_match_stats (
  id             uuid primary key default gen_random_uuid(),
  competition_id uuid not null references competitions (id) on delete cascade,
  event_id       uuid not null references events (id) on delete cascade,
  player_id      uuid not null references players (id) on delete cascade,
  minutes        int  not null default 0,
  goals          int  not null default 0,
  assists        int  not null default 0,
  shots_on       int  not null default 0,   -- INCLUDES goals (provider shots.on)
  red            int  not null default 0,
  yellow         int  not null default 0,
  penalty_saved  int  not null default 0,
  created_at     timestamptz not null default now(),
  unique (competition_id, event_id, player_id)
);
create index player_match_stats_comp_event_idx
  on player_match_stats (competition_id, event_id);

alter table player_match_stats enable row level security;
-- Same model as the rest of the catalog: authenticated reads, admin-only writes.
create policy "player_match_stats readable" on player_match_stats
  for select to authenticated using (true);
create policy "admin writes player_match_stats" on player_match_stats
  for all to authenticated using (is_admin()) with check (is_admin());
-- In the realtime publication so future LIVE ingestion streams to clients.
alter publication supabase_realtime add table player_match_stats;

-- ── League scoring controls ──────────────────────────────────────────────
-- sim_fallback: when a round has no real data, simulate it (offline/demo) vs.
--   refuse to play it (real game — wait for the real matchday + a re-seed).
-- scoring_version: stamps which weights a league plays under (future-proofs
--   recomputing old rounds with the weights that were live then).
alter table leagues
  add column sim_fallback   boolean not null default true,
  add column scoring_version int    not null default 1;

-- ── score_player_match: the ONE scoring formula ──────────────────────────
-- MIRROR of scorePlayerMatch() in src/lib/scoring.ts — keep in sync.
-- raw = {minutes, goals, assists, shots_on, red, pen_saved}; p_pos = position;
-- p_ga = the player's TEAM goals-against for the fixture (clean sheet / conceded).
create or replace function score_player_match(raw jsonb, p_pos text, p_ga int)
  returns int language sql immutable as $$
  with v as (
    select
      coalesce((raw->>'minutes')::int, 0)   as mn,
      coalesce((raw->>'goals')::int, 0)      as g,
      coalesce((raw->>'assists')::int, 0)    as a,
      coalesce((raw->>'shots_on')::int, 0)   as so,
      coalesce((raw->>'red')::int, 0)        as r,
      coalesce((raw->>'pen_saved')::int, 0)  as ps
  )
  select case when v.mn <= 0 then 0 else (
      -- appearance
      (case when v.mn >= 60 then 2 else 1 end)
      -- goals (by position)
    + v.g * (case p_pos when 'GK' then 6 when 'DEF' then 6 when 'MID' then 5 when 'FWD' then 4 else 0 end)
      -- assists
    + v.a * 3
      -- shots on target (non-scoring only)
    + greatest(0, v.so - v.g) * 1
      -- clean sheet (team conceded 0, 60+ min)
    + (case when v.mn >= 60 and p_ga = 0
            then (case p_pos when 'GK' then 4 when 'DEF' then 4 when 'MID' then 1 else 0 end)
            else 0 end)
      -- goals conceded (GK/DEF, 60+ min)
    + (case when v.mn >= 60 and p_pos in ('GK','DEF') and p_ga > 0
            then -floor(p_ga / 2.0)::int else 0 end)
      -- penalty save (GK)
    + (case when p_pos = 'GK' then v.ps * 5 else 0 end)
      -- red card (capped at one)
    + (case when v.r > 0 then -3 else 0 end)
  ) end::int
  from v;
$$;

-- ── play_round: score the current round (real data, sim fallback) ────────
-- 1) scoreline → match_results (real: from events.result; sim: from strength)
-- 2) per-player raw stats → player_scores via score_player_match
--    (real: from player_match_stats; sim: deterministic raws, same formula)
-- 3) per team: auto-sub unplayed XI, total, lock
-- 4) advance current_round (or finish)
create or replace function play_round(p_league_id uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_league leagues%rowtype;
  v_comp uuid;
  v_round int;
  v_total int;
  v_real boolean;
  v_t record;
  v_lineup jsonb;
  v_xi uuid[];
  v_bench uuid[];
  v_used_bench uuid[];
  v_repl uuid;
  v_points int;
  i int;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  select * into v_league from leagues where id = p_league_id for update;
  if not found then raise exception 'league not found'; end if;
  if v_league.commissioner_id <> auth.uid() then raise exception 'only the commissioner can play the round'; end if;
  if v_league.season_status <> 'in_season' then raise exception 'season is not active'; end if;

  v_comp  := v_league.competition_id;
  v_round := v_league.current_round;
  v_total := v_league.total_rounds;

  -- already played? (idempotency guard)
  if exists (select 1 from match_results where league_id = p_league_id and round = v_round) then
    raise exception 'round % already played', v_round;
  end if;

  -- Real data available for this round's fixtures?
  select exists (
    select 1 from player_match_stats pms
    join event_rounds er on er.id = pms.event_id
    where er.competition_id = v_comp and er.round = v_round
  ) into v_real;

  if not v_real and not coalesce(v_league.sim_fallback, true) then
    raise exception 'round % has no real match data yet — wait for the matchday', v_round;
  end if;

  -- ── 1) scoreline → match_results ──────────────────────────────────────
  if v_real then
    -- Real final scores from the fixture catalog.
    insert into match_results (league_id, round, event_id, home, away, home_goals, away_goals)
    select p_league_id, v_round, er.id,
           er.result->'home'->>'name', er.result->'away'->>'name',
           (er.result->'home'->>'goals')::int, (er.result->'away'->>'goals')::int
    from event_rounds er
    where er.competition_id = v_comp and er.round = v_round
      and er.result->'home'->>'goals' is not null
      and er.result->'away'->>'goals' is not null;
  else
    -- Simulated scoreline from club strength (offline/demo).
    insert into match_results (league_id, round, event_id, home, away, home_goals, away_goals)
    select p_league_id, v_round, g.id, g.h, g.a, g.gh, g.ga
    from (
      select s.id, s.h, s.a,
             greatest(0, round(1.1 + (s.sh - s.sa) / 20.0 + (s.rh * 2 - 1)))::int as gh,
             greatest(0, round(1.1 + (s.sa - s.sh) / 20.0 + (s.ra * 2 - 1)))::int as ga
      from (
        select er.id,
               er.result->'home'->>'name' as h,
               er.result->'away'->>'name' as a,
               coalesce(ch.strength, 70) as sh,
               coalesce(ca.strength, 70) as sa,
               det_rand(p_league_id::text || ':' || v_round || ':' || er.id::text || ':h') as rh,
               det_rand(p_league_id::text || ':' || v_round || ':' || er.id::text || ':a') as ra
        from event_rounds er
        left join clubs ch on ch.competition_id = v_comp and ch.name = er.result->'home'->>'name'
        left join clubs ca on ca.competition_id = v_comp and ca.name = er.result->'away'->>'name'
        where er.competition_id = v_comp and er.round = v_round
          and er.result->'home'->>'name' is not null
          and er.result->'away'->>'name' is not null
      ) s
    ) g;
  end if;

  -- ── 2) per-player raw stats → player_scores ───────────────────────────
  if v_real then
    insert into player_scores (league_id, round, player_id, points, stats)
    select p_league_id, v_round, pms.player_id,
           score_player_match(
             jsonb_build_object('minutes', pms.minutes, 'goals', pms.goals,
               'assists', pms.assists, 'shots_on', pms.shots_on,
               'red', pms.red, 'pen_saved', pms.penalty_saved),
             p.position, mm.ga),
           jsonb_build_object('played', pms.minutes > 0, 'minutes', pms.minutes,
             'goals', pms.goals, 'assists', pms.assists, 'shots_on', pms.shots_on,
             'red', pms.red, 'yellow', pms.yellow, 'pen_saved', pms.penalty_saved,
             'gf', mm.gf, 'ga', mm.ga, 'clean', mm.ga = 0, 'won', mm.gf > mm.ga)
    from player_match_stats pms
    join players p on p.id = pms.player_id and p.competition_id = v_comp
    join event_rounds er on er.id = pms.event_id and er.competition_id = v_comp and er.round = v_round
    join match_results m on m.league_id = p_league_id and m.round = v_round and m.event_id = pms.event_id
    cross join lateral (select
        case when m.home = p.club then m.home_goals else m.away_goals end as gf,
        case when m.home = p.club then m.away_goals else m.home_goals end as ga) mm
    where m.home = p.club or m.away = p.club
    on conflict (league_id, round, player_id) do nothing;
  else
    -- Deterministic simulated raws for every player whose nation played, run
    -- through the SAME scoring formula so the breakdown renders identically.
    insert into player_scores (league_id, round, player_id, points, stats)
    select p_league_id, v_round, p.id,
           score_player_match(raw, p.position, pl.ga),
           jsonb_set(jsonb_set(jsonb_set(raw,
             '{played}', to_jsonb(true)),
             '{gf}', to_jsonb(pl.gf)),
             '{ga}', to_jsonb(pl.ga)) || jsonb_build_object('clean', pl.ga = 0, 'won', pl.gf > pl.ga)
    from players p
    join (
      select home as nation, home_goals as gf, away_goals as ga from match_results
        where league_id = p_league_id and round = v_round
      union all
      select away, away_goals, home_goals from match_results
        where league_id = p_league_id and round = v_round
    ) pl on pl.nation = p.club
    cross join lateral (
      select p_league_id::text || ':' || v_round || ':' || p.id::text || ':' as sd
    ) z
    cross join lateral (
      select case when det_rand(z.sd || 'mn') < 0.08 then 0
                  when det_rand(z.sd || 'mn') < 0.22 then 30 + floor(det_rand(z.sd || 'mn2') * 55)::int
                  else 90 end as mn
    ) l1
    cross join lateral (
      select jsonb_build_object(
        'minutes', l1.mn,
        'goals', (case when l1.mn = 0 then 0
                       when det_rand(z.sd || 'g') < (case p.position when 'FWD' then 0.45 when 'MID' then 0.22 when 'DEF' then 0.08 else 0.0 end) * (p.rating / 80.0) * 0.18 then 2
                       when det_rand(z.sd || 'g') < (case p.position when 'FWD' then 0.45 when 'MID' then 0.22 when 'DEF' then 0.08 else 0.0 end) * (p.rating / 80.0) then 1
                       else 0 end),
        'assists', (case when l1.mn = 0 then 0
                         when det_rand(z.sd || 'a') < (case p.position when 'FWD' then 0.22 when 'MID' then 0.28 when 'DEF' then 0.12 else 0.0 end) * (p.rating / 80.0) then 1
                         else 0 end),
        'red', (case when l1.mn = 0 then 0 when det_rand(z.sd || 'r') < 0.03 then 1 else 0 end),
        'yellow', (case when l1.mn = 0 then 0 when det_rand(z.sd || 'y') < 0.14 then 1 else 0 end),
        'pen_saved', (case when p.position = 'GK' and l1.mn > 0 and det_rand(z.sd || 'ps') < 0.06 then 1 else 0 end)
      ) as base
    ) r2
    cross join lateral (
      -- shots_on must include goals (provider semantics): goals + a
      -- position-scaled count of non-scoring on-target shots.
      select r2.base || jsonb_build_object(
        'shots_on',
        (case when l1.mn = 0 then 0
              else floor(det_rand(z.sd || 'so') * ((case p.position when 'FWD' then 4 when 'MID' then 2 when 'DEF' then 1 else 0 end) + 1))::int
                   + coalesce((r2.base->>'goals')::int, 0)
         end)
      ) as raw
    ) r3
    where p.competition_id = v_comp
    on conflict (league_id, round, player_id) do nothing;
  end if;

  -- ── 3) per team: auto-sub + total + lock ──────────────────────────────
  for v_t in select id from teams where league_id = p_league_id loop
    select lineup into v_lineup from team_rounds
    where league_id = p_league_id and team_id = v_t.id and round = v_round;
    if v_lineup is null then
      v_lineup := default_lineup(p_league_id, v_t.id);
    end if;

    v_xi    := array(select value::uuid from jsonb_array_elements_text(v_lineup->'xi') value);
    v_bench := array(select value::uuid from jsonb_array_elements_text(v_lineup->'bench') value);
    v_used_bench := '{}';

    for i in 1..coalesce(array_length(v_xi, 1), 0) loop
      -- a starter who did not feature this round (no score row, or 0 minutes)
      if not exists (select 1 from player_scores ps
                     where ps.league_id = p_league_id and ps.round = v_round and ps.player_id = v_xi[i]
                       and coalesce((ps.stats->>'minutes')::int, 0) > 0) then
        select b.player_id into v_repl
        from unnest(v_bench) with ordinality as b(player_id, ord)
        join players pb on pb.id = b.player_id
        join players px on px.id = v_xi[i]
        where pb.position = px.position
          and b.player_id <> all(v_used_bench)
          and exists (select 1 from player_scores ps
                      where ps.league_id = p_league_id and ps.round = v_round and ps.player_id = b.player_id
                        and coalesce((ps.stats->>'minutes')::int, 0) > 0)
        order by pb.rating desc, b.ord
        limit 1;

        if v_repl is not null then
          v_used_bench := v_used_bench || v_repl;
          v_bench := array_replace(v_bench, v_repl, v_xi[i]);
          v_xi[i] := v_repl;
        end if;
      end if;
    end loop;

    select coalesce(sum(ps.points), 0) into v_points
    from player_scores ps
    where ps.league_id = p_league_id and ps.round = v_round and ps.player_id = any(v_xi);

    insert into team_rounds (league_id, team_id, round, lineup, points, locked)
    values (p_league_id, v_t.id, v_round,
            jsonb_build_object('xi', to_jsonb(v_xi), 'bench', to_jsonb(v_bench)), v_points, true)
    on conflict (league_id, team_id, round) do update
      set lineup = excluded.lineup, points = excluded.points, locked = true;
  end loop;

  -- ── 4) advance or finish ──────────────────────────────────────────────
  if v_round >= v_total then
    update leagues set season_status = 'finished' where id = p_league_id;
  else
    update leagues set current_round = v_round + 1 where id = p_league_id;
    insert into team_rounds (league_id, team_id, round, lineup)
    select p_league_id, t.id, v_round + 1, default_lineup(p_league_id, t.id)
    from teams t where t.league_id = p_league_id
    on conflict (league_id, team_id, round) do nothing;
  end if;
end;
$$;
