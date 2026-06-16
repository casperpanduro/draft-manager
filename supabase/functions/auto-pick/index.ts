// Auto-pick Edge Function — the server-side authority for the pick clock.
// Invoked by clients when the clock expires (and/or by a schedule). The DB
// function `auto_pick` re-checks the deadline under a row lock, so this is
// safe to call redundantly: only the first caller past the deadline acts.
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  try {
    const { leagueId } = await req.json();
    if (!leagueId) {
      return json({ error: "leagueId required" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data, error } = await supabase.rpc("auto_pick", {
      p_league_id: leagueId,
    });

    if (error) return json({ error: error.message }, 400);
    return json({ picked: data });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }

  function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", ...cors },
    });
  }
});
