"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { error?: string };

export async function createLeagueAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const competition = String(formData.get("competition") ?? "");
  const leagueName = String(formData.get("leagueName") ?? "");
  const teamName = String(formData.get("teamName") ?? "");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_league", {
    p_competition_slug: competition,
    p_league_name: leagueName,
    p_team_name: teamName,
  });

  if (error) return { error: error.message };
  redirect(`/league/${data}`);
}

export async function joinLeagueAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const code = String(formData.get("code") ?? "");
  const teamName = String(formData.get("teamName") ?? "");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("join_league", {
    p_code: code,
    p_team_name: teamName,
  });

  if (error) return { error: error.message };
  redirect(`/league/${data}`);
}

export async function startDraftAction(leagueId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("start_draft", { p_league_id: leagueId });
  if (error) return { error: error.message };
  revalidatePath(`/league/${leagueId}`);
  redirect(`/league/${leagueId}/draft`);
}

export async function kickTeamAction(
  leagueId: string,
  teamId: string,
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("teams").delete().eq("id", teamId);
  if (error) return { error: error.message };
  revalidatePath(`/league/${leagueId}`);
  return {};
}
