-- Datáfono Cashless — esquema de base de datos
-- Ejecutar completo en el SQL Editor de Supabase (es idempotente).

create extension if not exists pgcrypto;

-- Configuración del negocio (una sola fila, id = 1)
create table if not exists public.df_settings (
  id int primary key default 1 check (id = 1),
  business_name text not null default 'Mi Negocio',
  business_nit text default '',
  business_email text default '',
  currency text not null default 'COP',
  enable_tap boolean not null default true,
  enable_qr boolean not null default true,
  receipt_footer text default 'Gracias por su compra',
  updated_at timestamptz not null default now()
);
insert into public.df_settings (id) values (1) on conflict (id) do nothing;

-- Administradores (usuarios de Supabase Auth autorizados para el panel oculto)
create table if not exists public.df_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Transacciones
create table if not exists public.df_transactions (
  id uuid primary key default gen_random_uuid(),
  amount numeric(14, 2) not null check (amount > 0),
  description text not null default 'Venta',
  customer_email text,
  method text not null check (method in ('tap', 'qr')),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'cancelled', 'in_process', 'refunded')),
  mp_payment_id text,
  mp_preference_id text,
  mp_status_detail text,
  card_type text,
  installments int,
  email_sent boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists df_transactions_created_idx on public.df_transactions (created_at desc);
create index if not exists df_transactions_mp_payment_idx on public.df_transactions (mp_payment_id);

create or replace function public.df_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.df_admins where user_id = auth.uid());
$$;

-- Emails autorizados a ser administradores del datáfono.
-- Este proyecto comparte usuarios de Auth con otra app, por eso no basta con "estar logueado".
create table if not exists public.df_admin_emails (
  email text primary key
);
insert into public.df_admin_emails (email) values ('eduth4846@gmail.com') on conflict do nothing;

-- Si el email (ya confirmado) del usuario está autorizado, lo registra como admin
create or replace function public.df_claim_admin() returns boolean
language plpgsql security definer set search_path = public as $$
declare
  u auth.users%rowtype;
begin
  select * into u from auth.users where id = auth.uid();
  if not found or u.email_confirmed_at is null then return false; end if;
  if exists (select 1 from public.df_admin_emails where email = lower(u.email)) then
    insert into public.df_admins (user_id) values (u.id) on conflict do nothing;
  end if;
  return public.df_is_admin();
end;
$$;

alter table public.df_settings enable row level security;
alter table public.df_admins enable row level security;
alter table public.df_transactions enable row level security;
alter table public.df_admin_emails enable row level security; -- sin políticas: nadie la lee desde el cliente

-- settings: lectura pública (nombre del negocio en la terminal), escritura solo admin
drop policy if exists df_settings_read on public.df_settings;
create policy df_settings_read on public.df_settings for select using (true);
drop policy if exists df_settings_admin_write on public.df_settings;
create policy df_settings_admin_write on public.df_settings for update using (public.df_is_admin()) with check (public.df_is_admin());

-- admins: cada admin se ve a sí mismo
drop policy if exists df_admins_self on public.df_admins;
create policy df_admins_self on public.df_admins for select using (user_id = auth.uid());

-- transactions: solo admin lee. Las creaciones y cambios de estado pasan por la Edge Function (service role).
drop policy if exists df_tx_admin_read on public.df_transactions;
create policy df_tx_admin_read on public.df_transactions for select using (public.df_is_admin());

grant execute on function public.df_is_admin() to anon, authenticated;
grant execute on function public.df_claim_admin() to authenticated;
