-- Datáfono Cashless — esquema de base de datos
-- Ejecutar completo en el SQL Editor de Supabase (es idempotente).

create extension if not exists pgcrypto;

-- Configuración del negocio (una sola fila, id = 1)
create table if not exists public.settings (
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
insert into public.settings (id) values (1) on conflict (id) do nothing;

-- Administradores (usuarios de Supabase Auth autorizados para el panel oculto)
create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Transacciones
create table if not exists public.transactions (
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
create index if not exists transactions_created_idx on public.transactions (created_at desc);
create index if not exists transactions_mp_payment_idx on public.transactions (mp_payment_id);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- El primer usuario autenticado que lo llame queda como administrador (solo si aún no hay ninguno)
create or replace function public.claim_admin() returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return false; end if;
  if exists (select 1 from public.admins) then
    return public.is_admin();
  end if;
  insert into public.admins (user_id) values (auth.uid());
  return true;
end;
$$;

alter table public.settings enable row level security;
alter table public.admins enable row level security;
alter table public.transactions enable row level security;

-- settings: lectura pública (nombre del negocio en la terminal), escritura solo admin
drop policy if exists settings_read on public.settings;
create policy settings_read on public.settings for select using (true);
drop policy if exists settings_admin_write on public.settings;
create policy settings_admin_write on public.settings for update using (public.is_admin()) with check (public.is_admin());

-- admins: cada admin se ve a sí mismo
drop policy if exists admins_self on public.admins;
create policy admins_self on public.admins for select using (user_id = auth.uid());

-- transactions: solo admin lee. Las creaciones y cambios de estado pasan por la Edge Function (service role).
drop policy if exists tx_admin_read on public.transactions;
create policy tx_admin_read on public.transactions for select using (public.is_admin());

grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.claim_admin() to authenticated;
