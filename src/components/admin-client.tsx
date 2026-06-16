"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import {
  createCompetitionAction,
  setPlayableAction,
  deleteCompetitionAction,
  type ActionResult,
} from "@/app/admin/actions";
import type { Database } from "@/lib/database.types";
import type { ProviderLeague } from "@/lib/providers";
import type { SeedProgress } from "@/lib/seed";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type Competition = Database["public"]["Tables"]["competitions"]["Row"];
type Sport = { slug: string; name: string; provider: string | null };
type Theme = { key: string; label: string };

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-");

const fieldCls =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function AdminClient({
  competitions,
  sports,
  themes,
}: {
  competitions: Competition[];
  sports: Sport[];
  themes: Theme[];
}) {
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <AddCompetition sports={sports} themes={themes} />
      <CompetitionList competitions={competitions} />
    </div>
  );
}

// ── Add competition: search → pick league → season + branding → create ──────
function AddCompetition({ sports, themes }: { sports: Sport[]; themes: Theme[] }) {
  const [sport, setSport] = useState(sports[0]?.slug ?? "football");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<ProviderLeague[]>([]);
  const [picked, setPicked] = useState<ProviderLeague | null>(null);

  const [state, formAction] = useActionState<ActionResult, FormData>(
    createCompetitionAction,
    {},
  );

  useEffect(() => {
    if (state.error) toast.error(state.error);
    if (state.ok) toast.success("Competition created — seed it below.");
  }, [state]);

  async function search() {
    if (query.trim().length < 3) {
      toast.error("Type at least 3 characters");
      return;
    }
    setSearching(true);
    try {
      const res = await fetch(
        `/api/admin/leagues?sport=${encodeURIComponent(sport)}&q=${encodeURIComponent(query.trim())}`,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "search failed");
      setResults(data.leagues ?? []);
      if (!data.leagues?.length) toast.message("No leagues found");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "search failed");
    } finally {
      setSearching(false);
    }
  }

  const latestSeason = picked?.seasons.at(-1);
  const defaultName = picked && latestSeason ? `${picked.name} ${latestSeason}` : "";

  return (
    <section className="clip-broadcast accent-bar bg-card p-5 ring-1 ring-border">
      <h2 className="kicker mb-4 text-foreground">Add competition</h2>

      {/* sport + search */}
      <div className="mb-3 flex gap-2">
        <select
          value={sport}
          onChange={(e) => setSport(e.target.value)}
          className={cn(fieldCls, "w-32 shrink-0")}
        >
          {sports.map((s) => (
            <option key={s.slug} value={s.slug}>
              {s.name}
            </option>
          ))}
        </select>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), search())}
          placeholder="Search leagues (e.g. Premier League)"
        />
        <Button type="button" size="sm" onClick={search} disabled={searching}>
          {searching ? "…" : "Search"}
        </Button>
      </div>

      {/* results */}
      {results.length > 0 && !picked && (
        <ul className="mb-4 max-h-64 space-y-1 overflow-auto">
          {results.map((l) => (
            <li key={l.externalRef}>
              <button
                type="button"
                onClick={() => setPicked(l)}
                className="flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left ring-1 ring-border transition-colors hover:bg-accent"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{l.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {l.country ?? "—"} · {l.type ?? "League"} · #{l.externalRef}
                  </span>
                </span>
                <span className="kicker shrink-0 text-muted-foreground">
                  {l.seasons.length} seasons
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* create form */}
      {picked && (
        <form action={formAction} className="space-y-3">
          <div className="flex items-center justify-between rounded-md bg-accent/50 px-3 py-2 ring-1 ring-border">
            <span className="text-sm font-medium">{picked.name}</span>
            <button
              type="button"
              onClick={() => setPicked(null)}
              className="kicker text-muted-foreground hover:text-foreground"
            >
              change
            </button>
          </div>

          <input type="hidden" name="sport" value={sport} />
          <input type="hidden" name="externalRef" value={picked.externalRef} />

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="kicker mb-1 block">Season</span>
              <select name="season" defaultValue={latestSeason} className={fieldCls}>
                {[...picked.seasons].reverse().map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="kicker mb-1 block">Theme</span>
              <select name="theme" defaultValue={themes[0]?.key} className={fieldCls}>
                {themes.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {/* key → remount (reset) when the picked league/season changes */}
          <NameSlugFields
            key={`${picked.externalRef}-${latestSeason}`}
            defaultName={defaultName}
          />

          <CreateButton />
        </form>
      )}
    </section>
  );
}

function NameSlugFields({ defaultName }: { defaultName: string }) {
  const [name, setName] = useState(defaultName);
  const [slug, setSlug] = useState(slugify(defaultName));
  const [slugEdited, setSlugEdited] = useState(false);

  return (
    <>
      <label className="block">
        <span className="kicker mb-1 block">Display name</span>
        <Input
          name="name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (!slugEdited) setSlug(slugify(e.target.value));
          }}
        />
      </label>
      <label className="block">
        <span className="kicker mb-1 block">Slug</span>
        <Input
          name="slug"
          value={slug}
          onChange={(e) => {
            setSlugEdited(true);
            setSlug(e.target.value);
          }}
        />
      </label>
    </>
  );
}

function CreateButton() {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      disabled={pending}
      className="sheen w-full font-display uppercase tracking-wider"
    >
      {pending ? "Creating…" : "Create competition"}
    </Button>
  );
}

// ── Competition list: seed / publish / delete ───────────────────────────────
function CompetitionList({ competitions }: { competitions: Competition[] }) {
  return (
    <section>
      <h2 className="kicker mb-4 text-foreground">Competitions</h2>
      <div className="space-y-2.5">
        {competitions.map((c) => (
          <CompetitionRow key={c.id} comp={c} />
        ))}
      </div>
    </section>
  );
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  ready: "default",
  seeding: "secondary",
  empty: "outline",
  error: "destructive",
};

function CompetitionRow({ comp }: { comp: Competition }) {
  const router = useRouter();
  const [progress, setProgress] = useState<SeedProgress | null>(null);
  const [busy, setBusy] = useState(false);

  const seedable = Boolean(comp.provider && comp.provider !== "manual" && comp.external_ref);

  async function runSeed(restart = false) {
    setBusy(true);
    setProgress(null);
    let body: { competitionId: string; restart?: boolean } = {
      competitionId: comp.id,
      restart,
    };
    try {
      for (;;) {
        const res = await fetch("/api/admin/seed", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "seed failed");
        setProgress(data.progress as SeedProgress);
        body = { competitionId: comp.id };
        if (data.progress.phase === "done") break;
      }
      toast.success(`${comp.name} seeded`);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "seed failed");
    } finally {
      setBusy(false);
    }
  }

  async function togglePublish() {
    setBusy(true);
    const r = await setPlayableAction(comp.id, !comp.playable);
    setBusy(false);
    if (r.error) toast.error(r.error);
    else router.refresh();
  }

  async function remove() {
    if (!confirm(`Delete "${comp.name}" and all its seeded data?`)) return;
    setBusy(true);
    const r = await deleteCompetitionAction(comp.id);
    setBusy(false);
    if (r.error) toast.error(r.error);
    else router.refresh();
  }

  const pct =
    progress && progress.teamsTotal
      ? Math.round((progress.teamsDone / progress.teamsTotal) * 100)
      : 0;

  return (
    <div className="clip-broadcast bg-card p-4 ring-1 ring-border">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-display text-lg uppercase leading-tight">
            {comp.name}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge variant={STATUS_VARIANT[comp.seed_status] ?? "outline"}>
              {comp.seed_status}
            </Badge>
            {comp.playable && <Badge variant="secondary">live</Badge>}
            <span className="kicker text-muted-foreground">
              {comp.provider ?? "no provider"}
              {comp.season ? ` · ${comp.season}` : ""}
            </span>
          </div>
        </div>
      </div>

      {/* seed progress */}
      {busy && progress && (
        <div className="mt-3">
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-brand transition-all"
              style={{ width: `${progress.phase === "done" ? 100 : pct}%` }}
            />
          </div>
          <div className="kicker mt-1 text-muted-foreground">
            {progress.phase} · {progress.teamsDone}/{progress.teamsTotal} teams ·{" "}
            {progress.players} players · {progress.fixtures} fixtures
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          render={<Link href={`/admin/${comp.id}`} />}
          size="sm"
          variant="outline"
        >
          Manage
        </Button>
        {seedable && (
          <Button size="sm" onClick={() => runSeed(false)} disabled={busy}>
            {busy ? "Seeding…" : comp.seed_status === "ready" ? "Re-seed" : "Seed"}
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={togglePublish}
          disabled={busy || (comp.seed_status !== "ready" && !comp.playable)}
        >
          {comp.playable ? "Unpublish" : "Publish"}
        </Button>
        <Button size="sm" variant="ghost" onClick={remove} disabled={busy}>
          Delete
        </Button>
      </div>
    </div>
  );
}
