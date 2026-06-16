import type { Database } from "@/lib/database.types";

type EventRow = Pick<
  Database["public"]["Tables"]["events"]["Row"],
  "id" | "label" | "starts_at" | "status" | "result"
>;

// Football fixture payload (events.result). Other sports use a different shape;
// we render the score only when this one is present, else fall back to label.
type FixtureResult = {
  home?: { name?: string | null; goals?: number | null };
  away?: { name?: string | null; goals?: number | null };
};

const FINISHED = new Set(["FT", "AET", "PEN"]);

function fmtDate(iso: string | null): string {
  if (!iso) return "TBD";
  return new Date(iso).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
  });
}

/** Thin schedule view off the generic `events` table. */
export function FixturesList({ events }: { events: EventRow[] }) {
  if (events.length === 0) return null;

  return (
    <>
      <h2 className="kicker mb-3 mt-8 text-foreground">
        Fixtures · {events.length}
      </h2>
      <div className="clip-broadcast divide-y divide-border bg-background/40 ring-1 ring-border">
        {events.map((e) => {
          const r = (e.result ?? {}) as FixtureResult;
          const hasScore =
            r.home?.goals != null && r.away?.goals != null && FINISHED.has(e.status ?? "");
          return (
            <div
              key={e.id}
              className="grid grid-cols-[3.5rem_1fr_auto] items-center gap-2 px-3 py-2 text-sm"
            >
              <span className="kicker text-muted-foreground">{fmtDate(e.starts_at)}</span>
              {r.home?.name && r.away?.name ? (
                <span className="flex items-center gap-2 truncate">
                  <span className="min-w-0 flex-1 truncate text-right">{r.home.name}</span>
                  <span
                    className={
                      hasScore
                        ? "rounded bg-card px-1.5 font-display tabular-nums ring-1 ring-border"
                        : "text-xs text-muted-foreground"
                    }
                  >
                    {hasScore ? `${r.home.goals}–${r.away.goals}` : "v"}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{r.away.name}</span>
                </span>
              ) : (
                <span className="truncate">{e.label}</span>
              )}
              <span className="kicker text-right text-muted-foreground">
                {e.status ?? ""}
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}
