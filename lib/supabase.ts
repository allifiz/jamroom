import { createClient, SupabaseClient } from "@supabase/supabase-js";
export const configured =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
let instance: SupabaseClient | null = null;
export function db() {
  if (!configured)
    throw new Error("Connect Supabase first. See the setup guide in README.");
  return (instance ??= createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  ));
}
