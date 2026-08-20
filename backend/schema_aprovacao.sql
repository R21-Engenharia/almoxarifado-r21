-- BOX21 · Solicitações com dupla aprovação (Engenheiro -> Planejamento -> Compras).
-- Rodar no SQL Editor do Supabase.
--
-- Papéis: em authorized_emails, use role = 'engenheiro' ou 'planejamento'
-- (além de 'admin'/'viewer' que já existem). Não precisa alterar a tabela.

create table if not exists public.solicitacoes (
  id            uuid primary key default gen_random_uuid(),
  criado_em     timestamptz not null default now(),
  criado_por    text,
  obra          text not null,
  obra_nome     text,
  resource_id   text not null,
  insumo_desc   text,
  unidade       text,
  quantidade    numeric not null,
  sheet_item_id int,
  wbs_code      text,
  subetapa_desc text,
  qtd_orcada    numeric,            -- orçado do insumo NESTA subetapa (snapshot na criação)
  divergencia   boolean not null default false,  -- insumo não orçado nesta subetapa
  justificativa text,
  status        text not null default 'aguardando_engenharia',
  -- aguardando_engenharia | aguardando_planejamento | em_compras | reprovada | devolvida
  eng_por text, eng_em timestamptz, eng_obs text,
  plan_por text, plan_em timestamptz, plan_obs text
);
create index if not exists idx_solic_obra on public.solicitacoes(obra, criado_em desc);
create index if not exists idx_solic_status on public.solicitacoes(status);

create table if not exists public.solicitacao_eventos (
  id             bigint generated always as identity primary key,
  solicitacao_id uuid references public.solicitacoes(id) on delete cascade,
  quando         timestamptz not null default now(),
  etapa          text,  -- criacao | engenharia | planejamento | compras
  acao           text,  -- criada | aprovada | reprovada | devolvida | reenviada
  usuario        text,
  observacao     text
);
create index if not exists idx_solic_ev on public.solicitacao_eventos(solicitacao_id, quando);

alter table public.solicitacoes enable row level security;
drop policy if exists "solic_all" on public.solicitacoes;
create policy "solic_all" on public.solicitacoes for all using (true) with check (true);
alter table public.solicitacao_eventos enable row level security;
drop policy if exists "solic_ev_all" on public.solicitacao_eventos;
create policy "solic_ev_all" on public.solicitacao_eventos for all using (true) with check (true);
