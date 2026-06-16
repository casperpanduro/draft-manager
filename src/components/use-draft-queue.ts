"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";

/**
 * Local draft-queue state (ordered player ids) persisted to the
 * `set_draft_queue` RPC. Shared by the lobby and the live draft room.
 *
 * Add/remove save immediately (discrete, deliberate actions), so a quick
 * edit-then-refresh isn't lost. Drag-reorder is debounced (it fires
 * continuously) and also flushed on unmount and on `pagehide` (hard refresh /
 * tab close). RPC errors surface as a toast instead of failing silently.
 */
export function useDraftQueue(leagueId: string, initial: string[]) {
  const supabase = useMemo(() => createClient(), []);
  const [queue, setQueue] = useState<string[]>(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<string[]>(initial);

  const save = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const { error } = await supabase.rpc("set_draft_queue", {
      p_league_id: leagueId,
      p_player_ids: latest.current,
    });
    if (error) toast.error(`Couldn't save your queue: ${error.message}`);
  }, [supabase, leagueId]);

  const apply = useCallback(
    (ids: string[], immediate: boolean) => {
      latest.current = ids;
      setQueue(ids);
      if (immediate) {
        void save();
      } else {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => void save(), 500);
      }
    },
    [save],
  );

  const reorder = useCallback((ids: string[]) => apply(ids, false), [apply]);

  const toggle = useCallback(
    (id: string) =>
      apply(
        latest.current.includes(id)
          ? latest.current.filter((x) => x !== id)
          : [...latest.current, id],
        true,
      ),
    [apply],
  );

  const remove = useCallback(
    (id: string) => apply(latest.current.filter((x) => x !== id), true),
    [apply],
  );

  // Flush a pending (debounced) reorder when leaving or refreshing the page.
  useEffect(() => {
    const onHide = () => {
      if (timer.current) void save();
    };
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      if (timer.current) void save();
    };
  }, [save]);

  return { queue, reorder, toggle, remove };
}
