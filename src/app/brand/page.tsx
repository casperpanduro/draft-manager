import type { Metadata } from "next";
import { Container } from "@/components/container";

export const metadata: Metadata = {
  title: "Brand · Draft Manager",
};

/* Inline, tintable version of the DM tile. Uses the live --brand / --brand-2
   tokens so it auto-recolours per competition theme. The files in
   /public/brand are the static gradient versions for export. */
function TintableMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 120" className={className} role="img" aria-label="Draft Manager">
      <path d="M4 4 H116 V92 L92 116 H4 Z" fill="var(--brand)" />
      <text
        x="60"
        y="84"
        textAnchor="middle"
        fontFamily="var(--font-display), sans-serif"
        fontSize="70"
        letterSpacing="-1"
        fill="#0E1513"
      >
        DM
      </text>
    </svg>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border pt-7">
      <div className="kicker text-brand">{title}</div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

const CONCEPTS = [
  { file: "/brand/mark.svg", name: "Solid" },
  { file: "/brand/alt-outline.svg", name: "Outline" },
  { file: "/brand/wordmark.svg", name: "Wordmark" },
];

const THEMES = [
  { slug: "default", label: "Base" },
  { slug: "world-cup", label: "World Cup" },
  { slug: "premier-league", label: "Premier" },
  { slug: "serie-a", label: "Serie A" },
  { slug: "super-league", label: "Super" },
];

export default function BrandPage() {
  return (
    <Container as="main" className="relative flex-1 px-5 py-10">
      <div className="kicker text-foreground/60">Brand kit</div>
      <h1 className="mt-2 font-display text-5xl uppercase leading-none">Draft Manager</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        A bold <span className="text-foreground">DM</span> jersey tile with the broadcast
        cut-corner. Source in <code className="text-foreground">public/brand/</code>.
      </p>

      <div className="mt-10 space-y-7">
        {/* Hero lockup */}
        <Section title="Logo">
          <div className="grid place-items-center bg-card p-12">
            <img src="/brand/logo-horizontal.svg" alt="Draft Manager" className="h-20 w-auto" />
          </div>
        </Section>

        {/* Variants */}
        <Section title="Variants">
          <div className="grid grid-cols-3 gap-4">
            {CONCEPTS.map((c) => (
              <figure key={c.file} className="bg-card p-6 text-center">
                <div className="grid h-24 place-items-center">
                  <img src={c.file} alt={c.name} className="max-h-full w-auto" />
                </div>
                <figcaption className="mt-4 font-display text-xs uppercase text-muted-foreground">
                  {c.name}
                </figcaption>
              </figure>
            ))}
          </div>
        </Section>

        {/* Scale */}
        <Section title="Scale">
          <div className="flex flex-wrap items-end gap-8 bg-card p-8">
            {[80, 48, 32, 20, 16].map((s) => (
              <div key={s} className="text-center">
                <img
                  src="/brand/mark.svg"
                  alt={`${s}px`}
                  style={{ height: s, width: "auto" }}
                  className="mx-auto"
                />
                <div className="mt-3 text-xs text-muted-foreground">{s}px</div>
              </div>
            ))}
          </div>
        </Section>

        {/* Backgrounds */}
        <Section title="On backgrounds">
          <div className="grid grid-cols-3 gap-4">
            <div className="grid h-36 place-items-center bg-background">
              <img src="/brand/mark.svg" alt="" className="h-16 w-auto" />
            </div>
            <div className="grid h-36 place-items-center" style={{ background: "var(--brand-gradient)" }}>
              <img src="/brand/alt-outline.svg" alt="" className="h-16 w-auto" />
            </div>
            <div className="grid h-36 place-items-center bg-[#f3f1e8]">
              <img src="/brand/mark.svg" alt="" className="h-16 w-auto" />
            </div>
          </div>
        </Section>

        {/* Per-theme tinting */}
        <Section title="Per-theme">
          <div className="flex flex-wrap gap-4">
            {THEMES.map((t) => (
              <div
                key={t.slug}
                data-theme={t.slug === "default" ? undefined : t.slug}
                className="grid w-24 place-items-center gap-3 bg-card p-5"
              >
                <TintableMark className="h-14 w-auto" />
                <div className="text-center text-xs text-muted-foreground">{t.label}</div>
              </div>
            ))}
          </div>
        </Section>

        {/* In context */}
        <Section title="In context">
          <div className="overflow-hidden border border-border">
            <header
              className="flex items-center gap-3 px-5 py-4 text-brand-foreground"
              style={{ background: "var(--brand-gradient)" }}
            >
              <img src="/brand/mark.svg" alt="" className="h-10 w-auto" />
              <div className="min-w-0 flex-1">
                <div className="kicker text-brand-foreground/70">World Cup</div>
                <div className="font-display text-xl uppercase leading-none">Friday Night League</div>
              </div>
            </header>
            <div className="bg-background px-5 py-6 text-sm text-muted-foreground">Page content…</div>
          </div>
        </Section>
      </div>
    </Container>
  );
}
