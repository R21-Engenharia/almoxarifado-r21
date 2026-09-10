-- ============================================================================
-- BOX21 · Embalagens por insumo (Rolo=100m, Caixa=50un, ...)
-- Convenção de baixa/entrada por embalagem — o BOX21 converte p/ a unidade-base
-- que o Sienge exige. Idempotente. Rode no Supabase SQL Editor.
-- ============================================================================
create table if not exists public.embalagens (
  id           uuid primary key default gen_random_uuid(),
  resource_id  text not null,            -- id do insumo no Sienge
  nome         text not null,            -- "Rolo", "Caixa", "Fardo"
  fator        numeric not null,         -- unidades-base por embalagem (padrão editável)
  unidade      text,                     -- unidade-base do insumo (m, un, kg)
  criado_por   text,
  criado_em    timestamptz not null default now()
);
create index if not exists idx_embalagens_resource on public.embalagens(resource_id);

alter table public.embalagens enable row level security;
drop policy if exists embalagens_rw on public.embalagens;
create policy embalagens_rw on public.embalagens for all to authenticated
  using (public.email_autorizado()) with check (public.email_autorizado());
