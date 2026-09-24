-- ============================================================================
-- BOX21 · Migração C (set/2026) — rodar ANTES do deploy dos passos 08–10
-- ----------------------------------------------------------------------------
-- Só ACRESCENTA (colunas e tabelas). Compatível com o código que está no ar:
-- pode rodar a qualquer momento, quantas vezes quiser.
--
--  08) estoque_movimentos ganha a subetapa (EAP) do consumo
--  09) motivo/condição, vínculo com transferência e a tabela transferencias
--  10) tabelas requisicoes (pedido de material com reserva) e contagens (inventário)
--
-- As tabelas novas ficam com RLS ligado e SEM política: só o backend
-- (service_role) lê e grava. O front passa sempre pela API.
-- ============================================================================

alter table public.estoque_movimentos
  add column if not exists eap_uc_id        bigint,
  add column if not exists eap_codigo       text,
  add column if not exists eap_descricao    text,
  add column if not exists motivo           text,
  add column if not exists condicao         text,
  add column if not exists transferencia_id bigint,
  add column if not exists obra_contraparte text,
  add column if not exists requisicao_id    bigint,
  add column if not exists contagem_id      bigint;

create index if not exists idx_estoque_mov_eap
  on public.estoque_movimentos(obra, eap_codigo) where eap_codigo is not null;
create index if not exists idx_estoque_mov_transf
  on public.estoque_movimentos(transferencia_id) where transferencia_id is not null;

-- 09) transferência entre obras: origem -> em trânsito -> destino
create table if not exists public.transferencias (
  id            bigint generated always as identity primary key,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  criado_por    text not null,
  origem        text not null,
  destino       text not null,
  status        text not null default 'enviando',
  chave         text unique,
  itens         jsonb not null default '[]'::jsonb,
  obs           text,
  recebido_por  text, recebido_em  timestamptz, obs_recebimento text,
  cancelado_por text, cancelado_em timestamptz,
  erro          text
);
create index if not exists idx_transf_origem  on public.transferencias(origem, criado_em desc);
create index if not exists idx_transf_destino on public.transferencias(destino, criado_em desc);

-- 10) requisição de material da obra (reserva saldo até a entrega)
create table if not exists public.requisicoes (
  id               bigint generated always as identity primary key,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now(),
  obra             text not null,
  criado_por       text not null,
  solicitante      text,
  terceiro         text,
  eap_uc_id        bigint, eap_codigo text, eap_descricao text,
  necessario_em    date,
  obs              text,
  status           text not null default 'solicitada',
  itens            jsonb not null default '[]'::jsonb,
  entrega_pendente jsonb,
  n_entregas       int not null default 0,
  aprovado_por     text, aprovado_em timestamptz, aprov_obs text,
  separado_por     text, separado_em timestamptz,
  entregue_por     text, entregue_em timestamptz,
  cancelado_por    text, cancelado_em timestamptz, motivo text,
  erro             text
);
create index if not exists idx_req_obra on public.requisicoes(obra, status, criado_em desc);

-- 10) inventário cíclico: contagem cega + divergência + ajuste
create table if not exists public.contagens (
  id            bigint generated always as identity primary key,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  obra          text not null,
  criado_por    text not null,
  classe        text,
  status        text not null default 'aberta',
  itens         jsonb not null default '[]'::jsonb,
  contado_por   text, contado_em  timestamptz,
  ajustado_por  text, ajustado_em timestamptz, motivo text,
  obs           text,
  erro          text
);
create index if not exists idx_contagem_obra on public.contagens(obra, criado_em desc);

do $$
declare t text; p record;
begin
  foreach t in array array['transferencias','requisicoes','contagens'] loop
    execute format('alter table public.%I enable row level security', t);
    for p in select policyname from pg_policies where schemaname='public' and tablename=t loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
  end loop;
end $$;

notify pgrst, 'reload schema';
