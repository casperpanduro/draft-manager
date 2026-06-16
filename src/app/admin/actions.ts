"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isCurrentUserAdmin } from "@/lib/admin-auth";
import type { Json } from "@/lib/database.types";

export type ActionResult = { error?: string; ok?: boolean };

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-");

// Create a provider-backed competition (season snapshot). Roster template +
// provider are inherited from the chosen sport. Seeding happens afterwards.
export async function createCompetitionAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  if (!(await isCurrentUserAdmin())) return { error: "forbidden" };

  const name = String(formData.get("name") ?? "").trim();
  const slug = (slugify(String(formData.get("slug") ?? "")) || slugify(name)).trim();
  const theme = String(formData.get("theme") ?? "world-cup");
  const sportSlug = String(formData.get("sport") ?? "");
  const externalRef = String(formData.get("externalRef") ?? "").trim();
  const season = Number(formData.get("season"));

  if (!name || !slug || !sportSlug || !externalRef || !Number.isFinite(season)) {
    return { error: "name, slug, sport, league and season are required" };
  }

  const supabase = await createClient();
  const { data: sport } = await supabase
    .from("sports")
    .select("provider, default_roster_template")
    .eq("slug", sportSlug)
    .single();
  if (!sport?.provider) return { error: "sport has no provider configured" };

  const { error } = await supabase.from("competitions").insert({
    slug,
    name,
    short: name.slice(0, 4).toUpperCase(),
    theme,
    sport_slug: sportSlug,
    provider: sport.provider,
    external_ref: externalRef,
    season,
    roster_template: sport.default_roster_template as Json,
    playable: false,
    seed_status: "empty",
    sort: 100,
  });
  if (error) return { error: error.message };

  revalidatePath("/admin");
  return { ok: true };
}

// Publish / unpublish (only meaningful once seed_status = 'ready').
export async function setPlayableAction(
  competitionId: string,
  playable: boolean,
): Promise<ActionResult> {
  if (!(await isCurrentUserAdmin())) return { error: "forbidden" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("competitions")
    .update({ playable })
    .eq("id", competitionId);
  if (error) return { error: error.message };
  revalidatePath("/admin");
  return { ok: true };
}

// Delete a competition and its seeded data (clubs/players/events cascade).
export async function deleteCompetitionAction(
  competitionId: string,
): Promise<ActionResult> {
  if (!(await isCurrentUserAdmin())) return { error: "forbidden" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("competitions")
    .delete()
    .eq("id", competitionId);
  if (error) return { error: error.message };
  revalidatePath("/admin");
  return { ok: true };
}

// Update branding: short name, tagline, theme, and accent colour overrides.
export async function updateBrandingAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  if (!(await isCurrentUserAdmin())) return { error: "forbidden" };
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "missing competition" };

  const brand = String(formData.get("brand") ?? "").trim();
  const brand2 = String(formData.get("brand2") ?? "").trim();
  const brandForeground = String(formData.get("brandForeground") ?? "").trim();
  const accent =
    brand || brand2 || brandForeground
      ? { brand, brand2, brandForeground }
      : null;

  const supabase = await createClient();
  const { error } = await supabase
    .from("competitions")
    .update({
      short: String(formData.get("short") ?? "").trim().slice(0, 5) || null,
      tagline: String(formData.get("tagline") ?? "").trim() || null,
      theme: String(formData.get("theme") ?? "world-cup"),
      accent: accent as Json,
    })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath(`/admin/${id}`);
  return { ok: true };
}

// Upload competition background art to Storage and store its public URL.
export async function uploadImageAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  if (!(await isCurrentUserAdmin())) return { error: "forbidden" };
  const id = String(formData.get("id") ?? "");
  const file = formData.get("file");
  if (!id || !(file instanceof File) || file.size === 0) {
    return { error: "no file" };
  }
  if (!file.type.startsWith("image/")) return { error: "not an image" };
  if (file.size > 8 * 1024 * 1024) return { error: "image too large (max 8MB)" };

  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const path = `${id}/bg.${ext}`;
  const admin = createAdminClient();
  const { error: upErr } = await admin.storage
    .from("competition-art")
    .upload(path, file, { upsert: true, contentType: file.type });
  if (upErr) return { error: upErr.message };

  const { data } = admin.storage.from("competition-art").getPublicUrl(path);
  // Cache-bust so the overwritten file refreshes in-browser.
  const url = `${data.publicUrl}?v=${file.size}`;

  const { error } = await admin
    .from("competitions")
    .update({ bg_url: url })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath(`/admin/${id}`);
  return { ok: true };
}

// Inline-edit a player's rating and position.
export async function updatePlayerAction(
  playerId: string,
  rating: number,
  position: string | null,
): Promise<ActionResult> {
  if (!(await isCurrentUserAdmin())) return { error: "forbidden" };
  if (!Number.isFinite(rating) || rating < 1 || rating > 99) {
    return { error: "rating must be 1–99" };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("players")
    .update({ rating: Math.round(rating), position: position || null })
    .eq("id", playerId);
  if (error) return { error: error.message };
  return { ok: true };
}
