import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isCurrentUserAdmin } from "@/lib/admin-auth";
import { COMPETITIONS } from "@/lib/competitions";
import { Container } from "@/components/container";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { AdminClient } from "@/components/admin-client";

export default async function AdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await isCurrentUserAdmin())) redirect("/dashboard");

  const [{ data: competitions }, { data: sports }] = await Promise.all([
    supabase.from("competitions").select("*").order("sort"),
    supabase.from("sports").select("slug, name, provider").order("sort"),
  ]);

  // Curated theme keys (from the design system) the admin can brand with.
  const themes = Object.values(COMPETITIONS).map((c) => ({
    key: c.theme,
    label: c.name,
  }));

  return (
    <Container as="main" size="wide" className="flex-1 px-5 pb-16">
      <header className="flex items-center justify-between py-5">
        <Link href="/dashboard" className="flex items-center gap-2.5">
          <BrandMark className="size-8" />
          <span className="font-display text-sm uppercase tracking-[0.2em]">
            Draft Manager
          </span>
        </Link>
        <Button
          render={<Link href="/dashboard" />}
          variant="ghost"
          size="sm"
          className="kicker"
        >
          ← Dashboard
        </Button>
      </header>

      <div className="animate-rise mb-7 mt-2">
        <div className="kicker">Admin</div>
        <h1 className="font-display text-5xl uppercase leading-none">
          Competition
          <br />
          <span className="text-muted-foreground">control room</span>
        </h1>
      </div>

      <AdminClient
        competitions={competitions ?? []}
        sports={sports ?? []}
        themes={themes}
      />
    </Container>
  );
}
