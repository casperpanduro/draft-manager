import Link from "next/link";
import { competitionMeta } from "@/lib/competitions";
import { Container } from "@/components/container";

export function BrandHeader({
  competitionSlug,
  title,
  subtitle,
  right,
}: {
  competitionSlug: string;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  const meta = competitionMeta(competitionSlug);
  return (
    <header className="relative overflow-hidden">
      <div
        className="absolute inset-0 opacity-90"
        style={{ background: "var(--brand-gradient)" }}
      />
      <div className="absolute inset-0 bg-grain opacity-[0.12] mix-blend-overlay" />
      <Container className="relative flex items-center gap-3 px-5 py-4 text-brand-foreground">
        <Link
          href="/dashboard"
          className="grid size-11 shrink-0 place-items-center rounded-sm bg-black/15 font-display text-sm backdrop-blur-sm transition-transform hover:-translate-x-0.5"
        >
          {meta.short}
        </Link>
        <div className="min-w-0 flex-1">
          <div className="kicker text-brand-foreground/70">
            {subtitle ?? meta.name}
          </div>
          <div className="truncate font-display text-xl uppercase leading-none">
            {title}
          </div>
        </div>
        {right}
      </Container>
    </header>
  );
}
