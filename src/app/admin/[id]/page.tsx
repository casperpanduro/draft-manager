import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/database.types";
import { isCurrentUserAdmin } from "@/lib/admin-auth";
import { COMPETITIONS } from "@/lib/competitions";
import { Container } from "@/components/container";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BrandingForm } from "@/components/admin-branding-form";
import { PlayersEditor } from "@/components/admin-players-editor";
import { FixturesList } from "@/components/fixtures-list";

const PAGE_SIZE = 50;
const TABS = ["branding", "players", "fixtures"] as const;
type Tab = (typeof TABS)[number];

function slotCodes(template: unknown): string[] {
  const slots = (template as { slots?: { code: string }[] })?.slots ?? [];
  return slots.map((s) => s.code);
}

export default async function AdminCompetitionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; q?: string; page?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const tab: Tab = TABS.includes(sp.tab as Tab) ? (sp.tab as Tab) : "branding";
  const q = (sp.q ?? "").trim();
  const page = Math.max(1, Number(sp.page) || 1);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await isCurrentUserAdmin())) redirect("/dashboard");

  const { data: comp } = await supabase
    .from("competitions")
    .select("*")
    .eq("id", id)
    .single();
  if (!comp) notFound();

  const [{ count: playerCount }, { count: eventCount }] = await Promise.all([
    supabase.from("players").select("*", { count: "exact", head: true }).eq("competition_id", id),
    supabase.from("events").select("*", { count: "exact", head: true }).eq("competition_id", id),
  ]);

  const themes = Object.values(COMPETITIONS).map((c) => ({ key: c.theme, label: c.name }));

  // Tab data (only fetch what the active tab needs).
  let players: { id: string; name: string; club: string; position: string | null; rating: number }[] = [];
  let totalPlayers = 0;
  let events: { id: string; label: string; starts_at: string | null; status: string | null; result: Json }[] = [];

  if (tab === "players") {
    let query = supabase
      .from("players")
      .select("id, name, club, position, rating", { count: "exact" })
      .eq("competition_id", id);
    if (q) query = query.ilike("name", `%${q}%`);
    const { data, count } = await query
      .order("rating", { ascending: false })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
    players = data ?? [];
    totalPlayers = count ?? 0;
  } else if (tab === "fixtures") {
    const { data } = await supabase
      .from("events")
      .select("id, label, starts_at, status, result")
      .eq("competition_id", id)
      .order("starts_at")
      .limit(100);
    events = data ?? [];
  }

  const tabHref = (t: Tab) => `/admin/${id}?tab=${t}`;
  const totalPages = Math.max(1, Math.ceil(totalPlayers / PAGE_SIZE));

  return (
    <Container as="main" size="wide" className="flex-1 px-5 pb-16">
      <header className="flex items-center justify-between py-5">
        <Button
          render={<Link href="/admin" />}
          variant="ghost"
          size="sm"
          className="kicker"
        >
          ← Admin
        </Button>
      </header>

      <div className="animate-rise mb-6">
        <div className="kicker">
          {comp.provider ?? "manual"}
          {comp.season ? ` · ${comp.season}` : ""} · {comp.seed_status}
        </div>
        <h1 className="font-display text-4xl uppercase leading-none">{comp.name}</h1>
      </div>

      {/* tabs */}
      <div className="mb-6 flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <Link
            key={t}
            href={tabHref(t)}
            className={cn(
              "kicker -mb-px border-b-2 px-3 py-2 capitalize transition-colors",
              t === tab
                ? "border-brand text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t}
            {t === "players" ? ` · ${playerCount ?? 0}` : ""}
            {t === "fixtures" ? ` · ${eventCount ?? 0}` : ""}
          </Link>
        ))}
      </div>

      {tab === "branding" && (
        <BrandingForm comp={comp} themes={themes} />
      )}

      {tab === "players" && (
        <div>
          <form className="mb-4 flex gap-2" action={`/admin/${id}`}>
            <input type="hidden" name="tab" value="players" />
            <input
              name="q"
              defaultValue={q}
              placeholder="Search players by name"
              className="h-8 w-full max-w-xs rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
            <Button type="submit" size="sm">Search</Button>
          </form>

          <PlayersEditor players={players} positionOptions={slotCodes(comp.roster_template)} />

          {totalPlayers > PAGE_SIZE && (
            <div className="mt-4 flex items-center justify-between text-sm">
              <span className="kicker text-muted-foreground">
                Page {page} / {totalPages} · {totalPlayers} players
              </span>
              <div className="flex gap-2">
                {page > 1 && (
                  <Button
                    render={<Link href={`/admin/${id}?tab=players&q=${encodeURIComponent(q)}&page=${page - 1}`} />}
                    variant="outline"
                    size="sm"
                  >
                    ← Prev
                  </Button>
                )}
                {page < totalPages && (
                  <Button
                    render={<Link href={`/admin/${id}?tab=players&q=${encodeURIComponent(q)}&page=${page + 1}`} />}
                    variant="outline"
                    size="sm"
                  >
                    Next →
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "fixtures" && (
        <div className="max-w-2xl">
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">No fixtures seeded.</p>
          ) : (
            <FixturesList events={events} />
          )}
        </div>
      )}
    </Container>
  );
}
