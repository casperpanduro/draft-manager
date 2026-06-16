import { createClient } from "@/lib/supabase/server";

// True when the current session belongs to an admin (profiles.is_admin).
// Used to gate the /admin UI and the seeding/discovery API routes.
export async function isCurrentUserAdmin(): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();
  return Boolean(data?.is_admin);
}
