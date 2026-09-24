-- ============================================================================
-- BOX21 · Migração D (set/2026) — gestão de usuários v2. Rodar ANTES do deploy.
-- Só ACRESCENTA: compatível com o código no ar; pode rodar quantas vezes quiser.
--
--  - authorized_emails: perfil de acesso de origem + quem/quando alterou por último
--  - usuarios_eventos: histórico de alterações de permissão (só o backend lê/grava)
-- ============================================================================

alter table public.authorized_emails
  add column if not exists perfil         text,
  add column if not exists atualizado_em  timestamptz,
  add column if not exists atualizado_por text;

create table if not exists public.usuarios_eventos (
  id      bigint generated always as identity primary key,
  quando  timestamptz not null default now(),
  por     text not null,
  email   text not null,
  acao    text not null,
  antes   jsonb,
  depois  jsonb
);
create index if not exists idx_usuarios_eventos on public.usuarios_eventos(email, quando desc);

alter table public.usuarios_eventos enable row level security;

notify pgrst, 'reload schema';
