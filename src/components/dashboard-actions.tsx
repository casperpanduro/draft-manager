"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  createLeagueAction,
  joinLeagueAction,
  type ActionResult,
} from "@/app/actions";
import { competitionMeta } from "@/lib/competitions";
import { CompetitionCrest } from "@/components/competition-crest";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type Competition = {
  slug: string;
  name: string;
  theme: string;
  playable: boolean;
};

function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      className="sheen h-12 w-full font-display text-sm uppercase tracking-wider"
      disabled={pending}
    >
      {pending ? "Working…" : children}
    </Button>
  );
}

/**
 * Create a league. When `lockedSlug` is set the competition picker is replaced
 * by a fixed badge (used on /competition/[slug], where the competition is
 * already chosen). Otherwise the full picker grid is shown.
 */
export function CreateLeagueDialog({
  competitions = [],
  lockedSlug,
  trigger,
}: {
  competitions?: Competition[];
  lockedSlug?: string;
  trigger: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const playable = competitions.filter((c) => c.playable);
  const [selected, setSelected] = useState(
    lockedSlug ?? playable[0]?.slug ?? "",
  );
  const [state, formAction] = useActionState<ActionResult, FormData>(
    createLeagueAction,
    {},
  );

  useEffect(() => {
    if (state.error) toast.error(state.error);
  }, [state]);

  const lockedMeta = lockedSlug ? competitionMeta(lockedSlug) : null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="clip-broadcast border-0 bg-card p-0 ring-1 ring-border sm:max-w-md">
        <div className="accent-bar p-6 pl-7">
          <DialogHeader>
            <div className="kicker">Set up a competition</div>
            <DialogTitle className="font-display text-2xl uppercase">
              New league
            </DialogTitle>
          </DialogHeader>
          <form action={formAction} className="mt-5 space-y-5">
            {lockedMeta ? (
              <div
                data-theme={lockedMeta.theme}
                className="flex items-center gap-3 rounded-sm bg-accent p-3 ring-1 ring-brand/50"
              >
                <CompetitionCrest
                  short={lockedMeta.short}
                  className="h-9 w-auto"
                />
                <div>
                  <div className="text-sm font-medium leading-tight">
                    {lockedMeta.name}
                  </div>
                  <div className="kicker text-[0.6rem]">Competition</div>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <span className="kicker block text-foreground/70">
                  Competition
                </span>
                <div className="grid grid-cols-2 gap-2">
                  {competitions.map((c) => {
                    const meta = competitionMeta(c.slug);
                    const active = selected === c.slug;
                    return (
                      <button
                        type="button"
                        key={c.slug}
                        data-theme={meta.theme}
                        disabled={!c.playable}
                        onClick={() => c.playable && setSelected(c.slug)}
                        className={cn(
                          "relative flex flex-col gap-2 overflow-hidden rounded-sm p-3 text-left ring-1 transition",
                          active
                            ? "bg-accent ring-brand"
                            : "ring-border hover:ring-foreground/30",
                          !c.playable && "cursor-not-allowed opacity-50",
                        )}
                      >
                        <span
                          className="grid size-8 place-items-center rounded-sm font-display text-[11px] text-brand-foreground"
                          style={{ background: "var(--brand-gradient)" }}
                        >
                          {meta.short}
                        </span>
                        <span className="text-sm font-medium leading-tight">
                          {c.name}
                        </span>
                        <span className="kicker text-[0.6rem]">
                          {c.playable ? "Ready" : "Coming soon"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            <input type="hidden" name="competition" value={selected} />
            <Field
              name="leagueName"
              label="League name"
              placeholder="The Lads' League"
            />
            <Field name="teamName" label="Your team name" placeholder="My Team" />
            <SubmitButton>Create league</SubmitButton>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function JoinLeagueDialog({ trigger }: { trigger: React.ReactElement }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<ActionResult, FormData>(
    joinLeagueAction,
    {},
  );

  useEffect(() => {
    if (state.error) toast.error(state.error);
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="clip-broadcast border-0 bg-card p-0 ring-1 ring-border sm:max-w-md">
        <div className="accent-bar p-6 pl-7">
          <DialogHeader>
            <div className="kicker">Answer the call-up</div>
            <DialogTitle className="font-display text-2xl uppercase">
              Join league
            </DialogTitle>
          </DialogHeader>
          <form action={formAction} className="mt-5 space-y-5">
            <div className="space-y-1.5">
              <span className="kicker block text-foreground/70">Invite code</span>
              <Input
                name="code"
                placeholder="ABC123"
                autoCapitalize="characters"
                maxLength={6}
                required
                className="h-14 text-center font-display text-2xl uppercase tracking-[0.35em]"
              />
            </div>
            <Field name="teamName" label="Your team name" placeholder="My Team" />
            <SubmitButton>Join league</SubmitButton>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  name,
  label,
  placeholder,
}: {
  name: string;
  label: string;
  placeholder: string;
}) {
  return (
    <div className="space-y-1.5">
      <span className="kicker block text-foreground/70">{label}</span>
      <Input name={name} placeholder={placeholder} className="h-12" />
    </div>
  );
}
