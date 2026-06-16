"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  updateBrandingAction,
  uploadImageAction,
  type ActionResult,
} from "@/app/admin/actions";
import type { Database } from "@/lib/database.types";
import type { Accent } from "@/lib/competition-branding";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

type Competition = Database["public"]["Tables"]["competitions"]["Row"];
type Theme = { key: string; label: string };

const fieldCls =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function BrandingForm({ comp, themes }: { comp: Competition; themes: Theme[] }) {
  const accent = (comp.accent ?? {}) as Accent;
  const [colors, setColors] = useState({
    brand: accent.brand ?? "",
    brand2: accent.brand2 ?? "",
    brandForeground: accent.brandForeground ?? "",
  });

  const [state, formAction] = useActionState<ActionResult, FormData>(updateBrandingAction, {});
  useEffect(() => {
    if (state.error) toast.error(state.error);
    if (state.ok) toast.success("Branding saved");
  }, [state]);

  return (
    <div className="grid max-w-3xl gap-6 lg:grid-cols-2">
      {/* fields */}
      <form action={formAction} className="space-y-3">
        <input type="hidden" name="id" value={comp.id} />

        <label className="block">
          <span className="kicker mb-1 block">Short name (max 5)</span>
          <Input name="short" defaultValue={comp.short ?? ""} maxLength={5} />
        </label>

        <label className="block">
          <span className="kicker mb-1 block">Tagline</span>
          <Input name="tagline" defaultValue={comp.tagline ?? ""} />
        </label>

        <label className="block">
          <span className="kicker mb-1 block">Theme</span>
          <select name="theme" defaultValue={comp.theme} className={fieldCls}>
            {themes.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
        </label>

        <div className="space-y-2">
          <span className="kicker block">Accent overrides (hex or CSS colour — blank = theme default)</span>
          {(
            [
              ["brand", "Brand"],
              ["brand2", "Brand 2"],
              ["brandForeground", "On-brand text"],
            ] as const
          ).map(([key, label]) => (
            <div key={key} className="flex items-center gap-2">
              <span
                className="size-7 shrink-0 rounded-md ring-1 ring-border"
                style={{ background: colors[key] || "transparent" }}
              />
              <Input
                name={key}
                value={colors[key]}
                onChange={(e) => setColors((c) => ({ ...c, [key]: e.target.value }))}
                placeholder={label}
              />
            </div>
          ))}
        </div>

        <SaveButton>Save branding</SaveButton>
      </form>

      {/* image upload */}
      <div className="space-y-3">
        <span className="kicker block">Background art</span>
        <div className="clip-broadcast relative aspect-video overflow-hidden bg-card ring-1 ring-border">
          {comp.bg_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={comp.bg_url} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="grid h-full place-items-center text-xs text-muted-foreground">
              No image
            </div>
          )}
        </div>
        <ImageUploadForm competitionId={comp.id} />
      </div>
    </div>
  );
}

function ImageUploadForm({ competitionId }: { competitionId: string }) {
  const [state, formAction] = useActionState<ActionResult, FormData>(uploadImageAction, {});
  useEffect(() => {
    if (state.error) toast.error(state.error);
    if (state.ok) toast.success("Image uploaded");
  }, [state]);

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="id" value={competitionId} />
      <input
        type="file"
        name="file"
        accept="image/*"
        required
        className="text-xs file:mr-2 file:rounded-md file:border-0 file:bg-secondary file:px-2 file:py-1 file:text-secondary-foreground"
      />
      <SaveButton>Upload</SaveButton>
    </form>
  );
}

function SaveButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Saving…" : children}
    </Button>
  );
}
