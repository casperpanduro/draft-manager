-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  Season Mode — RPCs + simulation engine                                ║
-- ║                                                                        ║
-- ║  All season mutations are SECURITY DEFINER (atomic, race-free), like   ║
-- ║  the draft. The match/scoring SIMULATION lives here in plpgsql so it    ║
-- ║  stays server-authoritative; it is MIRRORED in src/lib/scoring.ts for   ║
-- ║  typing/preview (keep in sync, same as draft.ts ↔ SQL). Going live =    ║
-- ║  fill match_results / player_scores from a real feed instead of         ║
-- ║  simulating; nothing else changes.                                      ║
-- ╚══════════════════════════════════════════════════════════════════════╝

-- ── Deterministic [0,1) from a seed string (md5 → 32-bit fraction) ───────
-- Gives reproducible "randomness" without setseed(), so a round always
-- simulates identically for a given league. Mirror: detRand in scoring.ts.
create or replace function det_rand(p_seed text) returns numeric
  language sql immutable as $$
    select (('x' || substr(md5(p_seed), 1, 8))::bit(32)::bigint)::numeric / 4294967296.0;
$$;

-- ── Best valid XI for a team's current squad (mirror: defaultLineup in TS) ─
-- Fills each template slot with the top-rated players of that position; the
-- rest go to the bench (rating-ordered). Used as the round default and as the
-- always-valid fallback after transfers.
create or replace function default_lineup(p_league_id uuid, p_team_id uuid)
  returns jsonb language plpgsql stable set search_path = public as $$
declare
  v_template jsonb;
  v_xi uuid[] := '{}';
  v_bench uuid[];
  s record;
begin
  select c.roster_template into v_template
  from leagues l join competitions c on c.id = l.competition_id
  where l.id = p_league_id;

  for s in
    select (slot->>'code') as code, (slot->>'count')::int as cnt
    from jsonb_array_elements(coalesce(v_template->'slots', '[]'::jsonb)) slot
  loop
    v_xi := v_xi || array(
      select tp.player_id
      from team_players tp
      join players p on p.id = tp.player_id
      where tp.league_id = p_league_id and tp.team_id = p_team_id and p.position = s.code
      order by p.rating desc, p.id
      limit s.cnt
    );
  end loop;

  v_bench := array(
    select tp.player_id
    from team_players tp
    join players p on p.id = tp.player_id
    where tp.league_id = p_league_id and tp.team_id = p_team_id
      and tp.player_id <> all(v_xi)
    order by p.rating desc, p.id
  );

  return jsonb_build_object('xi', to_jsonb(v_xi), 'bench', to_jsonb(coalesce(v_bench, '{}')));
end;
$$;

-- ── finalize_squad: draft complete → season begins ───────────────────────
-- Seeds team_players from the immutable draft_picks, opens round 1 with a
-- default lineup per team, and flips the league into in_season.
create or replace function finalize_squad(p_league_id uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_comp uuid;
  v_total int;
begin
  select competition_id into v_comp from leagues where id = p_league_id;

  insert into team_players (league_id, team_id, player_id, acquired_round)
  select dp.league_id, dp.team_id, dp.player_id, 0
  from draft_picks dp
  where dp.league_id = p_league_id
  on conflict (league_id, player_id) do nothing;

  v_total := competition_total_rounds(v_comp);

  update leagues
  set season_status = 'in_season', current_round = 1, total_rounds = v_total
  where id = p_league_id;

  insert into team_rounds (league_id, team_id, round, lineup)
  select p_league_id, t.id, 1, default_lineup(p_league_id, t.id)
  from teams t
  where t.league_id = p_league_id
  on conflict (league_id, team_id, round) do nothing;
end;
$$;

-- ── record_pick: re-defined to fire finalize_squad on draft completion ───
-- Identical to the init.sql version except for the perform at completion.
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

  if v_league.current_pick_number >= v_team_count * v_rsize then
    update leagues set status = 'complete', pick_deadline = null, current_pick_number = current_pick_number + 1
      where id = p_league_id;
    perform finalize_squad(p_league_id);   -- ← season kicks off
  else
    update leagues
      set current_pick_number = current_pick_number + 1,
          pick_deadline = now() + (v_league.clock_seconds || ' seconds')::interval
      where id = p_league_id;
  end if;
end;
$$;

-- ── set_lineup: manager edits their XI for the open round ─────────────────
-- xi+bench must be an exact partition of the squad, and the XI must satisfy the
-- template formation exactly. Only allowed while the round is unlocked.
create or replace function set_lineup(p_league_id uuid, p_xi uuid[], p_bench uuid[])
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_league leagues%rowtype;
  v_team teams%rowtype;
  v_template jsonb;
  v_squad uuid[];
  v_locked boolean;
  s record;
  v_cnt int;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  select * into v_league from leagues where id = p_league_id;
  if v_league.season_status <> 'in_season' then raise exception 'season not active'; end if;

  select * into v_team from teams where league_id = p_league_id and user_id = auth.uid();
  if not found then raise exception 'no team in this league'; end if;

  select locked into v_locked from team_rounds
  where league_id = p_league_id and team_id = v_team.id and round = v_league.current_round;
  if coalesce(v_locked, false) then raise exception 'round already locked'; end if;

  select c.roster_template into v_template
  from competitions c where c.id = v_league.competition_id;

  select array_agg(player_id) into v_squad
  from team_players where league_id = p_league_id and team_id = v_team.id;

  -- exact partition of the squad
  if array_length(coalesce(p_xi, '{}'), 1) + array_length(coalesce(p_bench, '{}'), 1)
       is distinct from array_length(v_squad, 1) then
    raise exception 'lineup must use your whole squad exactly once';
  end if;
  if exists (select unnest(p_xi) intersect select unnest(p_bench)) then
    raise exception 'a player cannot be in both the XI and the bench';
  end if;
  if exists (select unnest(p_xi || p_bench) except select unnest(v_squad)) then
    raise exception 'lineup contains a player not in your squad';
  end if;

  -- formation must match the template exactly
  for s in
    select (slot->>'code') as code, (slot->>'count')::int as cnt
    from jsonb_array_elements(coalesce(v_template->'slots', '[]'::jsonb)) slot
  loop
    select count(*) into v_cnt from players p where p.id = any(p_xi) and p.position = s.code;
    if v_cnt <> s.cnt then
      raise exception 'invalid formation: need % %, got %', s.cnt, s.code, v_cnt;
    end if;
  end loop;

  insert into team_rounds (league_id, team_id, round, lineup, locked)
  values (p_league_id, v_team.id, v_league.current_round,
          jsonb_build_object('xi', to_jsonb(p_xi), 'bench', to_jsonb(p_bench)), false)
  on conflict (league_id, team_id, round) do update
    set lineup = excluded.lineup
    where team_rounds.locked = false;
end;
$$;

-- ── make_transfer: drop a squad player, sign a free agent ────────────────
-- Free agent = a competition player owned by no team in the league. First
-- free_transfers_per_round are free; extras cost transfer_fee from teams.budget.
-- After the swap, the squad must still be able to field a valid XI, and the
-- open round's lineup is recomputed to a valid default.
create or replace function make_transfer(p_league_id uuid, p_out uuid, p_in uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_league leagues%rowtype;
  v_team teams%rowtype;
  v_template jsonb;
  v_locked boolean;
  v_in_comp uuid;
  v_used int;
  v_charge int;
  s record;
  v_cnt int;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  select * into v_league from leagues where id = p_league_id for update;
  if v_league.season_status <> 'in_season' then raise exception 'season not active'; end if;

  select * into v_team from teams where league_id = p_league_id and user_id = auth.uid();
  if not found then raise exception 'no team in this league'; end if;

  if p_out = p_in then raise exception 'pick a different player'; end if;

  select locked into v_locked from team_rounds
  where league_id = p_league_id and team_id = v_team.id and round = v_league.current_round;
  if coalesce(v_locked, false) then raise exception 'round locked — transfers are closed'; end if;

  if not exists (select 1 from team_players
                 where league_id = p_league_id and team_id = v_team.id and player_id = p_out) then
    raise exception 'you do not own that player';
  end if;

  select competition_id into v_in_comp from players where id = p_in;
  if v_in_comp is null then raise exception 'unknown player'; end if;
  if v_in_comp <> v_league.competition_id then raise exception 'player not in this competition'; end if;
  if exists (select 1 from team_players where league_id = p_league_id and player_id = p_in) then
    raise exception 'that player is already owned';
  end if;

  -- fee: free up to the per-round quota, then a flat fee
  select count(*) into v_used from transfers
  where league_id = p_league_id and team_id = v_team.id and round = v_league.current_round;
  v_charge := case when v_used >= v_league.free_transfers_per_round then v_league.transfer_fee else 0 end;
  if v_charge > v_team.budget then raise exception 'not enough budget for the transfer fee'; end if;

  -- apply the swap
  delete from team_players where league_id = p_league_id and team_id = v_team.id and player_id = p_out;
  insert into team_players (league_id, team_id, player_id, acquired_round)
  values (p_league_id, v_team.id, p_in, v_league.current_round);

  -- resulting squad must still be able to field the XI
  select c.roster_template into v_template
  from competitions c where c.id = v_league.competition_id;
  for s in
    select (slot->>'code') as code, (slot->>'count')::int as cnt
    from jsonb_array_elements(coalesce(v_template->'slots', '[]'::jsonb)) slot
  loop
    select count(*) into v_cnt
    from team_players tp join players p on p.id = tp.player_id
    where tp.league_id = p_league_id and tp.team_id = v_team.id and p.position = s.code;
    if v_cnt < s.cnt then
      raise exception 'that transfer would leave you short of % (need % for the XI)', s.code, s.cnt;
    end if;
  end loop;

  update teams set budget = budget - v_charge where id = v_team.id;
  insert into transfers (league_id, team_id, round, out_player_id, in_player_id, fee)
  values (p_league_id, v_team.id, v_league.current_round, p_out, p_in, v_charge);

  -- keep the open round's lineup valid (recompute to best XI)
  insert into team_rounds (league_id, team_id, round, lineup)
  values (p_league_id, v_team.id, v_league.current_round, default_lineup(p_league_id, v_team.id))
  on conflict (league_id, team_id, round) do update
    set lineup = excluded.lineup
    where team_rounds.locked = false;
end;
$$;

-- ── play_round: commissioner simulates + locks the current round ─────────
-- 1) simulate every fixture's scoreline (det_rand from club strength)
-- 2) score every player whose nation played (light position-aware model)
-- 3) per team: auto-sub unplayed XI with same-position bench who played,
--    snapshot the final lineup, total the XI points, lock the round
-- 4) advance current_round (or finish the season)
create or replace function play_round(p_league_id uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_league leagues%rowtype;
  v_comp uuid;
  v_round int;
  v_total int;
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

  -- 1) simulate fixtures → match_results
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

  -- 2) score players whose nation played
  insert into player_scores (league_id, round, player_id, points, stats)
  select p_league_id, v_round, p.id,
         greatest(0, round(
           p.rating / 10.0
           + (det_rand(p_league_id::text || ':' || v_round || ':' || p.id::text) * 5 - 2)  -- form swing
           + case p.position
               when 'FWD' then m.gf * 2
               when 'MID' then m.gf * 1
               when 'DEF' then (case when m.ga = 0 then 4 else 0 end)
               when 'GK'  then (case when m.ga = 0 then 5 else 0 end) - floor(m.ga / 2.0)
               else 0
             end
           + case when m.gf > m.ga then 1 else 0 end  -- win bonus
         ))::int,
         jsonb_build_object('played', true, 'gf', m.gf, 'ga', m.ga,
                            'won', m.gf > m.ga, 'clean', m.ga = 0)
  from players p
  join (
    select home as nation, home_goals as gf, away_goals as ga from match_results
      where league_id = p_league_id and round = v_round
    union all
    select away, away_goals, home_goals from match_results
      where league_id = p_league_id and round = v_round
  ) m on m.nation = p.club
  where p.competition_id = v_comp
  on conflict (league_id, round, player_id) do nothing;

  -- 3) per team: auto-sub + total + lock
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
      -- a starter who did not play this round
      if not exists (select 1 from player_scores ps
                     where ps.league_id = p_league_id and ps.round = v_round and ps.player_id = v_xi[i]) then
        select b.player_id into v_repl
        from unnest(v_bench) with ordinality as b(player_id, ord)
        join players pb on pb.id = b.player_id
        join players px on px.id = v_xi[i]
        where pb.position = px.position
          and b.player_id <> all(v_used_bench)
          and exists (select 1 from player_scores ps
                      where ps.league_id = p_league_id and ps.round = v_round and ps.player_id = b.player_id)
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

  -- 4) advance or finish
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
