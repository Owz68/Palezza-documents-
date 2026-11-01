// Envoie les rappels d'abonnement : WhatsApp (avec accord) puis e-mail en secours. À appeler une fois par jour (voir README).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
const DAY = 864e5;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const TXT: Record<string, [string, string]> = {
  trial2: ["Ton essai gratuit se termine bientôt", "Ton essai gratuit de Palezza Documents se termine dans moins de 2 jours. Choisis une formule pour continuer à créer et modifier tes documents."],
  j5: ["Ton abonnement se termine dans 5 jours", "Ton abonnement Palezza Documents se termine dans environ 5 jours. Renouvelle-le pour garder la création et la modification."],
  j1: ["Dernier jour avant la fin de ton abonnement", "Ton abonnement Palezza Documents se termine demain. Renouvelle-le pour ne pas perdre la création et la modification."],
  expired: ["Ton abonnement est terminé", "Ton abonnement est terminé. Tes documents restent consultables et téléchargeables ; renouvelle pour les modifier à nouveau."],
};
Deno.serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) return new Response("Interdit", { status: 403 });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const now = Date.now(), site = Deno.env.get("SITE_URL")!, from = Deno.env.get("REMINDER_FROM") ?? "";
  const { data: subs } = await admin.from("subscriptions").select("*");
  let sent = 0;
  for (const s of subs ?? []) {
    let stage = "", end = "";
    if (s.status === "trialing") { const t = new Date(s.trial_ends_at).getTime(); if (t > now && t - now <= 2 * DAY) { stage = "trial2"; end = s.trial_ends_at; } }
    else if (s.status === "active" && !s.renewal_cancelled && s.current_period_end) {
      const t = new Date(s.current_period_end).getTime(), d = t - now;
      if (d > 0 && d <= DAY) stage = "j1"; else if (d > DAY && d <= 5 * DAY) stage = "j5"; else if (d <= 0 && d > -3 * DAY) stage = "expired";
      end = s.current_period_end;
    }
    if (!stage) continue;
    // On réserve le rappel avant l'envoi : s'il existe déjà, on n'envoie rien.
    const { data: ins } = await admin.from("reminder_log").insert({ user_id: s.user_id, period_end: end, stage }).select();
    if (!ins?.length) continue;
    const [subject, body] = TXT[stage], link = `${site}/#/account`;
    const { data: pr } = await admin.from("profiles").select("whatsapp,whatsapp_optin").eq("user_id", s.user_id).maybeSingle();
    let ok = false;
    // 1) WhatsApp, seulement si l'utilisateur a donné son accord.
    if (pr?.whatsapp_optin && pr.whatsapp) {
      const w = await fetch(`https://graph.facebook.com/${Deno.env.get("WA_API_VERSION") ?? "v21.0"}/${Deno.env.get("WA_PHONE_NUMBER_ID")}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${Deno.env.get("WA_ACCESS_TOKEN")}`, "Content-Type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", to: pr.whatsapp, type: "template", template: { name: Deno.env.get("WA_TEMPLATE_NAME") ?? "rappel_abonnement", language: { code: "fr" }, components: [{ type: "body", parameters: [{ type: "text", text: body }, { type: "text", text: link }] }] } }),
      });
      ok = w.ok;
    }
    // 2) Sinon (ou en cas d'échec), e-mail.
    if (!ok && Deno.env.get("RESEND_API_KEY")) {
      const { data: u } = await admin.auth.admin.getUserById(s.user_id);
      const to = u?.user?.email;
      if (to) {
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from, to: [to], subject, html: `<p>${esc(body)}</p><p><a href="${esc(link)}">Ouvrir mon compte</a></p><p style="color:#5B6B82;font-size:13px">Palezza Documents · Développé par Palezza Network</p>` }),
        });
        ok = r.ok;
      }
    }
    if (ok) sent++; else await admin.from("reminder_log").delete().eq("user_id", s.user_id).eq("period_end", end).eq("stage", stage); // réessai demain
  }
  return new Response(JSON.stringify({ sent }), { headers: { "Content-Type": "application/json" } });
});
