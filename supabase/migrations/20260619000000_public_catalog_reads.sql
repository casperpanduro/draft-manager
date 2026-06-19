-- Public catalog reads for the logged-out landing page.
--
-- The marketing landing (/) is anonymous-only (authenticated users are
-- redirected to /dashboard), so its broadcast fixture ticker needs to read the
-- competition + fixture catalog without a session. Both tables hold public
-- sports data (competition names, real match fixtures/scores) — there is
-- nothing user-specific to protect. Writes remain admin-only.
--
-- Scope is deliberately limited to these two tables: leagues, teams, players,
-- and clubs stay authenticated-only.

create policy "competitions readable anon" on competitions for select to anon using (true);
create policy "events readable anon"       on events       for select to anon using (true);
