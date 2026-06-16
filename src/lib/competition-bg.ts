// Server-only: resolve a per-competition background image by convention.
// Drop a file at `public/competitions/<slug>/bg.{jpg,png,webp,…}` and it's
// picked up automatically; otherwise callers fall back to the CSS skin.
// (Uses `fs`, so never import this from a client component.)
import { existsSync } from "fs";
import { join } from "path";

const EXTS = ["jpg", "jpeg", "png", "webp", "avif"];

export function competitionBg(slug: string): string | null {
  for (const ext of EXTS) {
    const rel = `competitions/${slug}/bg.${ext}`;
    if (existsSync(join(process.cwd(), "public", rel))) return `/${rel}`;
  }
  return null;
}
