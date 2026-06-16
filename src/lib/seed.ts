// ── Seeding pipeline ─────────────────────────────────────────────────────
// Pulls a competition's clubs / players / fixtures from its provider and
// upserts them. Designed to be RESUMABLE and IDEMPOTENT:
//  - one bounded unit of work per advanceSeed() call (init+clubs, then one team
//    at a time, then fixtures) so no single request outruns a serverless timeout
//  - every write is an upsert keyed on (competition_id, provider, external_ref),
//    so re-running a step — or the whole seed — never duplicates
//  - progress is persisted on competitions.seed_progress; the admin UI polls
//    advanceSeed() until phase === 'done' (seed_status 'ready').

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { getProvider, type ProviderConfig } from "@/lib/providers";
import { playerValue, teamStrength } from "@/lib/draft";

type Admin = SupabaseClient<Database>;

export type SeedTeam = { ref: string; name: string; done: boolean };
export type SeedProgress = {
  phase: "clubs" | "players" | "fixtures" | "done";
  season: number;
  teams: SeedTeam[];
  teamsTotal: number;
  teamsDone: number;
  players: number;
  fixtures: number;
  message?: string;
};

export type SeedResult = {
  status: Database["public"]["Tables"]["competitions"]["Row"]["seed_status"];
  progress: SeedProgress;
};

const freshProgress = (season: number): SeedProgress => ({
  phase: "clubs",
  season,
  teams: [],
  teamsTotal: 0,
  teamsDone: 0,
  players: 0,
  fixtures: 0,
});

/** Advance a competition's seed by one bounded step. Idempotent + resumable. */
export async function advanceSeed(
  admin: Admin,
  competitionId: string,
  opts: { restart?: boolean } = {},
): Promise<SeedResult> {
  const { data: comp, error } = await admin
    .from("competitions")
    .select("id, provider, external_ref, season, sport_slug, seed_status, seed_progress")
    .eq("id", competitionId)
    .single();
  if (error || !comp) throw new Error(error?.message ?? "competition not found");

  if (!comp.provider || comp.provider === "manual" || !comp.external_ref || comp.season == null) {
    throw new Error("competition is not configured for provider seeding");
  }

  // Provider config lives on the sport row.
  let config: ProviderConfig = {};
  if (comp.sport_slug) {
    const { data: sport } = await admin
      .from("sports")
      .select("provider_config")
      .eq("slug", comp.sport_slug)
      .single();
    config = (sport?.provider_config as ProviderConfig) ?? {};
  }
  const adapter = getProvider(comp.provider, config);
  const leagueRef = comp.external_ref;
  const season = comp.season;

  const progress: SeedProgress =
    opts.restart || comp.seed_status !== "seeding" || !comp.seed_progress
      ? freshProgress(season)
      : (comp.seed_progress as unknown as SeedProgress);

  try {
    switch (progress.phase) {
      case "clubs": {
        const clubs = await adapter.getClubs(leagueRef, season);
        if (clubs.length) {
          await admin.from("clubs").upsert(
            clubs.map((c) => ({
              competition_id: competitionId,
              provider: comp.provider!,
              external_ref: c.externalRef,
              name: c.name,
              logo_url: c.logo ?? null,
            })),
            { onConflict: "competition_id,provider,external_ref" },
          );
        }
        progress.teams = clubs.map((c) => ({ ref: c.externalRef, name: c.name, done: false }));
        progress.teamsTotal = clubs.length;
        progress.teamsDone = 0;
        progress.phase = clubs.length ? "players" : "fixtures";
        break;
      }

      case "players": {
        const team = progress.teams.find((t) => !t.done);
        if (!team) {
          progress.phase = "fixtures";
          break;
        }
        const players = await adapter.getPlayers(leagueRef, season, {
          externalRef: team.ref,
          name: team.name,
        });

        // Resolve the club FK (clubs were upserted in the 'clubs' phase).
        const { data: clubRow } = await admin
          .from("clubs")
          .select("id")
          .eq("competition_id", competitionId)
          .eq("provider", comp.provider)
          .eq("external_ref", team.ref)
          .maybeSingle();

        if (players.length) {
          // Club strength + each player's coin value from the blend. Mirrored
          // offline by recompute_competition_values() in SQL.
          const strength = teamStrength(players.map((p) => p.rating));
          await admin.from("players").upsert(
            players.map((p) => ({
              competition_id: competitionId,
              club_id: clubRow?.id ?? null,
              provider: comp.provider!,
              external_ref: p.externalRef,
              name: p.name,
              position: p.position,
              club: p.clubName ?? "",
              rating: p.rating,
              base_value: playerValue(p.rating, strength),
              value: playerValue(p.rating, strength),
              stats: (p.stats ?? null) as Json,
            })),
            { onConflict: "competition_id,provider,external_ref" },
          );
          if (clubRow?.id) {
            await admin.from("clubs").update({ strength }).eq("id", clubRow.id);
          }
        }

        team.done = true;
        progress.teamsDone += 1;
        progress.players += players.length;
        if (progress.teams.every((t) => t.done)) progress.phase = "fixtures";
        break;
      }

      case "fixtures": {
        const events = await adapter.getFixtures(leagueRef, season);
        if (events.length) {
          await admin.from("events").upsert(
            events.map((e) => ({
              competition_id: competitionId,
              provider: comp.provider!,
              external_ref: e.externalRef,
              label: e.label,
              starts_at: e.startsAt,
              status: e.status,
              result: (e.result ?? null) as Json,
            })),
            { onConflict: "competition_id,provider,external_ref" },
          );
        }
        progress.fixtures = events.length;
        progress.phase = "done";
        break;
      }

      case "done":
        break;
    }
  } catch (e) {
    progress.message = e instanceof Error ? e.message : String(e);
    await persist(admin, competitionId, "error", progress);
    throw e;
  }

  const status = progress.phase === "done" ? "ready" : "seeding";
  await persist(admin, competitionId, status, progress);
  return { status, progress };
}

async function persist(
  admin: Admin,
  competitionId: string,
  status: string,
  progress: SeedProgress,
) {
  await admin
    .from("competitions")
    .update({ seed_status: status, seed_progress: progress as unknown as Json })
    .eq("id", competitionId);
}
