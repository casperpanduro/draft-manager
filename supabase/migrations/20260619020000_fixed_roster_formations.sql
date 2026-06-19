-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  Fixed per-position squad quota + selectable XI formations             ║
-- ║                                                                        ║
-- ║  The football roster shape changes from "1-4-4-2 XI + 5 flexible subs" ║
-- ║  to a FIXED squad quota (GK 2 · DEF 5 · MID 6 · FWD 3 = 16, no flexible ║
-- ║  bench). With bench 0, position_draftable already caps drafting at each ║
-- ║  position's quota. The season XI is now any one of six formations; the  ║
-- ║  remaining 5 players are the bench. Mirrors src/lib/draft.ts +          ║
-- ║  src/lib/season.ts.                                                     ║
-- ╚══════════════════════════════════════════════════════════════════════╝

-- ── Canonical football template (fixed quota + formations) ───────────────
create or replace function football_template() returns jsonb
  language sql immutable as $$
    select '{
      "slots": [
        {"code":"GK","label":"Goalkeeper","count":2},
        {"code":"DEF","label":"Defender","count":5},
        {"code":"MID","label":"Midfielder","count":6},
        {"code":"FWD","label":"Forward","count":3}
      ],
      "bench": 0,
      "formations": [
        {"name":"4-4-2","slots":{"GK":1,"DEF":4,"MID":4,"FWD":2}},
        {"name":"4-3-3","slots":{"GK":1,"DEF":4,"MID":3,"FWD":3}},
        {"name":"3-5-2","slots":{"GK":1,"DEF":3,"MID":5,"FWD":2}},
        {"name":"3-4-3","slots":{"GK":1,"DEF":3,"MID":4,"FWD":3}},
        {"name":"5-3-2","slots":{"GK":1,"DEF":5,"MID":3,"FWD":2}},
        {"name":"5-4-1","slots":{"GK":1,"DEF":5,"MID":4,"FWD":1}}
      ]
    }'::jsonb;
$$;

-- Repoint every football competition + the sport default at the new shape.
update sports set default_roster_template = football_template() where provider = 'api-football';
update competitions set roster_template = football_template() where sport_slug = 'football';

-- ── Formation helpers ────────────────────────────────────────────────────
-- The default (first-listed) formation name, or null when the template has none.
create or replace function template_default_formation(t jsonb) returns text
  language sql immutable as $$
    select f->>'name'
    from jsonb_array_elements(coalesce(t->'formations', '[]'::jsonb)) f
    limit 1;
$$;

-- The {code: count} XI shape for a formation. Falls back to the first formation,
-- then (positionless/legacy templates) to the squad slots themselves.
create or replace function template_formation_slots(t jsonb, p_name text) returns jsonb
  language sql immutable as $$
    select coalesce(
      (select f->'slots'
         from jsonb_array_elements(coalesce(t->'formations', '[]'::jsonb)) f
        where f->>'name' = p_name limit 1),
      (select f->'slots'
         from jsonb_array_elements(coalesce(t->'formations', '[]'::jsonb)) f
        limit 1),
      (select jsonb_object_agg(s->>'code', (s->>'count')::int)
         from jsonb_array_elements(coalesce(t->'slots', '[]'::jsonb)) s)
    );
$$;

-- ── default_lineup: best valid XI for the default formation ───────────────
-- Mirror of defaultLineup in src/lib/season.ts. Fills each formation slot with
-- the top-rated players of that position; the rest go to the bench.
create or replace function default_lineup(p_league_id uuid, p_team_id uuid)
  returns jsonb language plpgsql stable set search_path = public as $$
declare
  v_template jsonb;
  v_formation text;
  v_slots jsonb;
  v_xi uuid[] := '{}';
  v_bench uuid[];
  s record;
begin
  select c.roster_template into v_template
  from leagues l join competitions c on c.id = l.competition_id
  where l.id = p_league_id;

  v_formation := template_default_formation(v_template);
  v_slots := template_formation_slots(v_template, v_formation);

  for s in
    select key as code, value::int as cnt from jsonb_each_text(coalesce(v_slots, '{}'::jsonb))
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

  return jsonb_build_object(
    'xi', to_jsonb(v_xi),
    'bench', to_jsonb(coalesce(v_bench, '{}')),
    'formation', coalesce(v_formation, '')
  );
end;
$$;

-- ── set_lineup: now takes the chosen formation ───────────────────────────
-- xi+bench must be an exact partition of the squad, and the XI must satisfy the
-- chosen formation exactly (which must be one the template allows).
drop function if exists set_lineup(uuid, uuid[], uuid[]);
create or replace function set_lineup(
  p_league_id uuid, p_xi uuid[], p_bench uuid[], p_formation text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_league leagues%rowtype;
  v_team teams%rowtype;
  v_template jsonb;
  v_squad uuid[];
  v_locked boolean;
  v_formation text;
  v_slots jsonb;
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

  -- resolve + validate the formation
  v_formation := coalesce(p_formation, template_default_formation(v_template));
  if jsonb_array_length(coalesce(v_template->'formations', '[]'::jsonb)) > 0
     and not exists (
       select 1 from jsonb_array_elements(v_template->'formations') f
       where f->>'name' = v_formation
     ) then
    raise exception 'invalid formation: %', v_formation;
  end if;
  v_slots := template_formation_slots(v_template, v_formation);

  -- XI must match the formation exactly
  for s in
    select key as code, value::int as cnt from jsonb_each_text(coalesce(v_slots, '{}'::jsonb))
  loop
    select count(*) into v_cnt from players p where p.id = any(p_xi) and p.position = s.code;
    if v_cnt <> s.cnt then
      raise exception 'invalid formation: need % %, got %', s.cnt, s.code, v_cnt;
    end if;
  end loop;

  insert into team_rounds (league_id, team_id, round, lineup, locked)
  values (p_league_id, v_team.id, v_league.current_round,
          jsonb_build_object('xi', to_jsonb(p_xi), 'bench', to_jsonb(p_bench),
                             'formation', coalesce(v_formation, '')), false)
  on conflict (league_id, team_id, round) do update
    set lineup = excluded.lineup
    where team_rounds.locked = false;
end;
$$;

-- ── Backfill: stamp existing lineups with a formation ─────────────────────
-- Pre-existing rows were stored as a 1-4-4-2 XI (== the 4-4-2 formation), so
-- they remain valid; just tag them so the editor/validator can read it.
update team_rounds
set lineup = lineup || jsonb_build_object('formation', '4-4-2')
where lineup ? 'xi' and not (lineup ? 'formation');
