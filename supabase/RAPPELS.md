# Rappels par e-mail

1. Compte Resend (resend.com) + domaine vérifié (enregistrements DNS) : sans domaine vérifié, Resend n'envoie qu'à ta propre adresse.
2. Secrets Supabase : RESEND_API_KEY, REMINDER_FROM (ex. "Palezza Documents <rappel@ton-domaine.com>"), SITE_URL, CRON_SECRET (une longue valeur aléatoire).
3. Déploiement : `supabase functions deploy send-reminders --no-verify-jwt`
4. Planification quotidienne : Supabase > Integrations > Cron, ou pg_cron + pg_net, avec une requête POST vers
   https://<ton-projet>.supabase.co/functions/v1/send-reminders et l'en-tête `x-cron-secret: <CRON_SECRET>`.
5. Test : appelle la fonction à la main avec curl et vérifie la réponse {"sent": N}.

Rappels envoyés : fin d'essai (2 jours avant), fin d'abonnement (5 jours puis 1 jour avant), abonnement terminé (une fois). Aucun rappel si le renouvellement a été annulé.

## WhatsApp (canal principal)

Prérequis Meta : compte WhatsApp Business Platform (Cloud API), numéro d'envoi, jeton d'accès permanent (utilisateur système).
1. Crée un modèle de message (catégorie Utilitaire), nom `rappel_abonnement`, langue français, corps :
   `Palezza Documents : {{1}} Ouvre ton compte : {{2}}` (avec un exemple pour chaque variable). Attends l'approbation de Meta.
2. Secrets Supabase : WA_PHONE_NUMBER_ID, WA_ACCESS_TOKEN, WA_TEMPLATE_NAME (si autre nom), WA_API_VERSION (par défaut v21.0 : vérifie la version actuelle chez Meta).
3. L'utilisateur donne son numéro et son accord dans Compte > Rappels WhatsApp. Sans accord, seul l'e-mail est utilisé.
4. Les messages modèles envoyés hors fenêtre de 24 h sont payants (tarifs Meta, à vérifier). La désinscription se fait dans l'appli.
