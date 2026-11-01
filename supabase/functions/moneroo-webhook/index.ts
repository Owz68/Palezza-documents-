// Reçoit les notifications Moneroo, vérifie la signature ET le paiement auprès de Moneroo, puis active l'abonnement.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
function same(a: string, b: string) { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }
Deno.serve(async (req) => {
  const raw = await req.text();
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(Deno.env.get("MONEROO_WEBHOOK_SECRET")!), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)));
  if (!same(sig, req.headers.get("x-moneroo-signature") ?? "")) return new Response("Signature invalide", { status: 403 });
  const body = JSON.parse(raw);
  if (body?.event !== "payment.success") return new Response("ignoré", { status: 200 });
  const id = body?.data?.id as string;
  if (!id) return new Response("sans id", { status: 200 });
  // Toujours revérifier auprès de Moneroo avant de créditer.
  const v = await fetch(`https://api.moneroo.io/v1/payments/${id}/verify`, { headers: { Authorization: `Bearer ${Deno.env.get("MONEROO_SECRET_KEY")}`, Accept: "application/json" } });
  const d = (await v.json().catch(() => ({})))?.data;
  if (!v.ok || d?.status !== "success") return new Response("non confirmé", { status: 200 });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: p } = await admin.from("payments").select("*").eq("provider_id", id).maybeSingle();
  if (!p || p.status !== "pending" || Number(d.amount) !== p.amount) return new Response("ok", { status: 200 });
  const { data: done } = await admin.from("payments").update({ status: "success" }).eq("id", p.id).eq("status", "pending").select();
  if (!done?.length) return new Response("déjà traité", { status: 200 });
  const { data: s } = await admin.from("subscriptions").select("current_period_end,status").eq("user_id", p.user_id).maybeSingle();
  const base = s?.status === "active" && s.current_period_end && new Date(s.current_period_end) > new Date() ? new Date(s.current_period_end) : new Date();
  base.setDate(base.getDate() + (p.period === "annuel" ? 365 : 30));
  await admin.from("subscriptions").upsert({ user_id: p.user_id, plan: p.plan, status: "active", current_period_end: base.toISOString(), renewal_cancelled: false });
  return new Response("ok", { status: 200 });
});
