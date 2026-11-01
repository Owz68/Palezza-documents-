// Annule (ou réactive) le renouvellement. L'abonnement reste actif jusqu'à la date de fin payée ; aucun remboursement.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: u } = await admin.auth.getUser((req.headers.get("Authorization") ?? "").replace("Bearer ", ""));
  if (!u?.user) return json({ error: "Non connecté" }, 401);
  const { cancel } = await req.json().catch(() => ({ cancel: true }));
  const { data, error } = await admin.from("subscriptions").update({ renewal_cancelled: cancel !== false }).eq("user_id", u.user.id).eq("status", "active").select();
  if (error || !data?.length) return json({ error: "Aucun abonnement actif" }, 400);
  return json({ ok: true, renewal_cancelled: cancel !== false });
});
