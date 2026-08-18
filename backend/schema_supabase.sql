-- Rodar no SQL Editor do Supabase (projeto reutilizado do app de validação).
-- Cria a tabela de auditoria do estoque. A tabela authorized_emails já existe
-- (é reusada para autenticação/roles).

create table if not exists public.estoque_movimentos (
  id                 bigint generated always as identity primary key,
  criado_em          timestamptz not null default now(),
  usuario            text not null,
  obra               text not null,
  resource_id        text not null,
  descricao          text,
  operacao           text not null,            -- baixa | entrada | estorno
  movement_type_id   int  not null,
  quantidade         numeric not null,
  unidade            text,
  document_id        text,
  movement_date      date,
  sienge_status      int,
  sienge_movement_id text,
  sienge_resposta    jsonb,
  estorno_de         bigint references public.estoque_movimentos(id),
  estornado          boolean not null default false,
  removido_no_sienge boolean not null default false
);

create index if not exists idx_estoque_mov_obra
  on public.estoque_movimentos(obra, criado_em desc);

-- RLS: acesso controlado pela API (que usa a chave anon). Política aberta como no
-- app de validação; o gate real é a verificação de token + authorized_emails no backend.
alter table public.estoque_movimentos enable row level security;
drop policy if exists "app_all" on public.estoque_movimentos;
create policy "app_all" on public.estoque_movimentos
  for all using (true) with check (true);
