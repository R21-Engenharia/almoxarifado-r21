-- ============================================================================
-- BOX21 · Migração A (set/2026) — rodar ANTES do deploy dos passos 01–03
-- ----------------------------------------------------------------------------
-- Só ACRESCENTA (colunas, índice, função). É compatível com o código que está
-- no ar hoje: pode rodar a qualquer momento, quantas vezes quiser.
--
-- O que faz:
--  1) estoque_movimentos ganha: variação (detail_id/trademark_id/variante),
--     embalagem, status (pendente/gravado/falhou), erro e a chave de
--     idempotência (única) — base da "escrita segura" no Sienge.
--  2) email_autorizado() passa a respeitar authorized_emails.ativo
--     (usuário desativado perde acesso também às tabelas lidas pelo front).
--
-- Rodar no SQL Editor do Supabase. Depois disso o deploy pode subir.
-- ============================================================================

alter table public.estoque_movimentos
  add column if not exists terceiro           text,
  add column if not exists solicitante        text,
  add column if not exists detail_id          bigint,
  add column if not exists trademark_id       bigint,
  add column if not exists variante           text,
  add column if not exists embalagem          text,
  add column if not exists fator_embalagem    numeric,
  add column if not exists chave_idempotencia text,
  add column if not exists status             text not null default 'gravado',
  add column if not exists erro               text;

-- uma chave por item; nula = sem idempotência (linhas antigas e estornos)
create unique index if not exists ux_estoque_mov_chave
  on public.estoque_movimentos(chave_idempotencia)
  where chave_idempotencia is not null;

-- porteiro do RLS agora exige usuário ATIVO
create or replace function public.email_autorizado()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.authorized_emails ae
                 where lower(ae.email) = lower(auth.jwt() ->> 'email')
                   and coalesce(ae.ativo, true));
$$;
revoke all on function public.email_autorizado() from public;
grant execute on function public.email_autorizado() to authenticated;

-- recarrega o cache de schema da API REST (as colunas novas ficam visíveis na hora)
notify pgrst, 'reload schema';
