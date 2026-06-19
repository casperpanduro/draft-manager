// Seed a provider-backed competition from the CLI (drives the same advanceSeed
// pipeline the admin UI uses). Handy for re-seeding after `npm run db:reset`,
// since real data can't live in seed.sql.
//
//   npx tsx scripts/seed-competition.ts <slug|id> [--publish]
//
// Reads server env from .env.local (SUPABASE_SERVICE_ROLE_KEY, API_FOOTBALL_*).
import { readFileSync } from "node:fs";
import { createAdminClient } from "@/lib/supabase/admin";
import { advanceSeed } from "@/lib/seed";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  if (!line || line.startsWith("#")) continue;
  const i = line.indexOf("=");
  if (i > 0) process.env[line.slice(0, i)] = line.slice(i + 1);
}

const arg = process.argv[2];
const publish = process.argv.includes("--publish");
if (!arg) throw new Error("usage: seed-competition.ts <slug|id> [--publish]");

async function main() {
  const admin = createAdminClient();
  const isUuid = /^[0-9a-f-]{36}$/i.test(arg);
  const { data: comp } = await admin
    .from("competitions")
    .select("id, name")
    .eq(isUuid ? "id" : "slug", arg)
    .single();
  if (!comp) throw new Error(`competition not found: ${arg}`);

  console.log(`Seeding ${comp.name}…`);
  let steps = 0;
  for (;;) {
    const { progress } = await advanceSeed(admin, comp.id);
    steps++;
    process.stdout.write(
      `\r  ${progress.phase} · ${progress.teamsDone}/${progress.teamsTotal} teams · ${progress.players} players · ${progress.fixtures} fixtures   `,
    );
    if (progress.phase === "done") break;
    if (steps > 5000) throw new Error("too many steps — aborting");
  }
  console.log("\n✓ seeded");

  if (publish) {
    await admin.from("competitions").update({ playable: true }).eq("id", comp.id);
    console.log("✓ published (playable)");
  }
}

main().catch((e) => {
  console.error("\n", e);
  process.exit(1);
});
