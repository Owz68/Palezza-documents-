// Crée un paiement Moneroo (Mobile Money MTN/Airtel et carte) et renvoie le lien de paiement.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
const PRICES: Record<string, Record<string, number>> = {
  essentielle: { mensuel: 1000, annuel: 10000 },
  professionnelle: { mensuel: 2500, annuel: 25000 },
};
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = Deno.env.get("SUPABASE_URL")!, svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const auth = req.headers.get("Authorization") ?? "";
  const admin = createClient(url, svc);
  const { data: u } = await admin.auth.getUser(auth.replace("Bearer ", ""));
  if (!u?.user) return json({ error: "Non connecté" }, 401);
  const { plan, period } = await req.json().catch(() => ({}));
  const amount = PRICES[plan]?.[period];
  if (!amount) return json({ error: "Formule invalide" }, 400); // le prix vient toujours du serveur
  const email = u.user.email ?? "";
  const r = await fetch("https://api.moneroo.io/v1/payments/initialize", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${Deno.env.get("MONEROO_SECRET_KEY")}` },
    body: JSON.stringify({
      amount, currency: "XAF",
      description: `Palezza Documents — ${plan} (${period})`,
      customer: { email, first_name: email.split("@")[0] || "Client", last_name: "Palezza" },
      return_url: `${Deno.env.get("SITE_URL")}/#/account`,
      metadata: { user_id: u.user.id, plan, period },
    }),
  });
  const out = await r.json().catch(() => ({}));
  const id = out?.data?.id, checkout = out?.data?.checkout_url;
  if (!id || !checkout) return json({ error: "Paiement indisponible" }, 502);
  await admin.from("payments").insert({ user_id: u.user.id, provider_id: id, plan, period, amount, currency: "XAF" });
  return json({ checkout_url: checkout });
});
