-- Palezza Documents : phase 1 (comptes, essai de 7 jours, documents). À exécuter dans Supabase > SQL Editor.
create table if not exists public.subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'trial',
  status text not null default 'trialing',
  trial_ends_at timestamptz not null default (now() + interval '7 days'),
  current_period_end timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.documents (
  id uuid primary key,
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null default '',
  kind text not null default 'cv',
  content text not null default '',
  updated_at timestamptz not null default now()
);
alter table public.subscriptions enable row level security;
alter table public.documents enable row level security;

create or replace function public.can_edit() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.subscriptions s where s.user_id = auth.uid()
    and ((s.status = 'trialing' and s.trial_ends_at > now())
      or (s.status = 'active' and s.current_period_end > now())));
$$;

create or replace function public.new_user_subscription() returns trigger
language plpgsql security definer set search_path = public as $$
begin insert into public.subscriptions (user_id) values (new.id) on conflict do nothing; return new; end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.new_user_subscription();

drop policy if exists "sub lecture" on public.subscriptions;
create policy "sub lecture" on public.subscriptions for select to authenticated using (user_id = auth.uid());
-- Aucune écriture client sur subscriptions : les changements d'abonnement passeront par le serveur.

drop policy if exists "doc lecture" on public.documents;
drop policy if exists "doc creation" on public.documents;
drop policy if exists "doc modification" on public.documents;
drop policy if exists "doc suppression" on public.documents;
create policy "doc lecture" on public.documents for select to authenticated using (owner = auth.uid());
create policy "doc creation" on public.documents for insert to authenticated with check (owner = auth.uid() and public.can_edit());
create policy "doc modification" on public.documents for update to authenticated using (owner = auth.uid() and public.can_edit()) with check (owner = auth.uid() and public.can_edit());
create policy "doc suppression" on public.documents for delete to authenticated using (owner = auth.uid());

-- Paiements (phase 2) : écrits uniquement par les fonctions serveur (clé service), jamais par l'application.
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider_id text unique,
  plan text not null,
  period text not null,
  amount integer not null,
  currency text not null default 'XAF',
  status text not null default 'pending',
  created_at timestamptz not null default now()
);
alter table public.payments enable row level security;
drop policy if exists "paiements lecture" on public.payments;
create policy "paiements lecture" on public.payments for select to authenticated using (user_id = auth.uid());

-- Renouvellement / annulation (phase 2b). L'accès reste actif jusqu'à la fin de la période payée.
alter table public.subscriptions add column if not exists renewal_cancelled boolean not null default false;

-- Rappels par e-mail (phase 2c). Journal pour ne jamais envoyer deux fois le même rappel.
create table if not exists public.reminder_log (
  user_id uuid not null references auth.users(id) on delete cascade,
  period_end timestamptz not null,
  stage text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, period_end, stage)
);
alter table public.reminder_log enable row level security; -- aucune politique : accessible seulement par les fonctions serveur

-- Signatures synchronisées (phase 4) : strictement privées, jamais publiques.
create table if not exists public.signatures (
  id uuid primary key,
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  data text not null check (length(data) < 200000),
  created_at timestamptz not null default now()
);
alter table public.signatures enable row level security;
drop policy if exists "sig lecture" on public.signatures;
drop policy if exists "sig creation" on public.signatures;
drop policy if exists "sig suppression" on public.signatures;
create policy "sig lecture" on public.signatures for select to authenticated using (owner = auth.uid());
create policy "sig creation" on public.signatures for insert to authenticated with check (owner = auth.uid() and public.can_edit());
create policy "sig suppression" on public.signatures for delete to authenticated using (owner = auth.uid());

-- Rappels WhatsApp : numéro et consentement de l'utilisateur.
create table if not exists public.profiles (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  whatsapp text check (whatsapp ~ '^[0-9]{8,15}$'),
  whatsapp_optin boolean not null default false,
  optin_at timestamptz
);
alter table public.profiles enable row level security;
drop policy if exists "profil lecture" on public.profiles;
drop policy if exists "profil creation" on public.profiles;
drop policy if exists "profil modification" on public.profiles;
create policy "profil lecture" on public.profiles for select to authenticated using (user_id = auth.uid());
create policy "profil creation" on public.profiles for insert to authenticated with check (user_id = auth.uid());
create policy "profil modification" on public.profiles for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Restriction des fonctions (appliqué sur le projet).
revoke execute on function public.new_user_subscription() from public, anon, authenticated;
revoke execute on function public.can_edit() from public, anon;
grant execute on function public.can_edit() to authenticated;
