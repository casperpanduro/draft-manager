import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

// Service-role client for privileged server-side work (the admin seeder).
// Bypasses RLS — NEVER import this into client code. The service-role key is
// server-only env (no NEXT_PUBLIC prefix).
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
