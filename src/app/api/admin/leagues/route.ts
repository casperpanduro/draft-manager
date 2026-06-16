import { type NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isCurrentUserAdmin } from "@/lib/admin-auth";
import { getProvider, type ProviderConfig } from "@/lib/providers";

// Admin league discovery: search a sport's provider catalog. Each result
// carries its available seasons, so the UI can populate the season dropdown
// without a second call.
export async function GET(request: NextRequest) {
  if (!(await isCurrentUserAdmin())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim();
  const sportSlug = searchParams.get("sport") ?? "football";
  if (!q || q.length < 3) {
    return NextResponse.json({ error: "query too short" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: sport } = await admin
    .from("sports")
    .select("provider, provider_config")
    .eq("slug", sportSlug)
    .single();
  if (!sport?.provider) {
    return NextResponse.json({ error: "sport has no provider" }, { status: 400 });
  }

  try {
    const adapter = getProvider(sport.provider, (sport.provider_config as ProviderConfig) ?? {});
    const leagues = await adapter.searchLeagues(q);
    return NextResponse.json({ leagues });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
