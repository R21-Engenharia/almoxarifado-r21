-- BOX21 · Dupla aprovação sobre as Solicitações de Compra REAIS do Sienge.
--
-- As solicitações NÃO são criadas no BOX21: elas vêm do Sienge
-- (/purchase-requests, aguardando autorização). O BOX21 só guarda a camada de
-- aprovação que o Sienge não tem: Engenheiro -> Planejamento -> autoriza no Sienge.
-- A chave é o purchase_request_id do Sienge.
--
-- Papéis: em authorized_emails, use role = 'engenheiro' ou 'planejamento'
-- (além de 'admin'/'viewer' que já existem). Não precisa alterar aquela tabela.
--
-- Rodar no SQL Editor do Supabase.

create table if not exists public.aprov_sienge (
  purchase_request_id  bigint primary key,
  obra                 text not null,
  status               text not null default 'aguardando_engenharia',
  -- aguardando_engenharia | aguardando_planejamento | em_compras | reprovada | devolvida
  eng_por text, eng_em timestamptz, eng_obs text,
  plan_por text, plan_em timestamptz, plan_obs text,
  autorizado_sienge boolean not null default false,
  criado_em timestamptz not null default now()
);
create index if not exists idx_aprov_sienge_obra on public.aprov_sienge(obra);

create table if not exists public.aprov_sienge_eventos (
  id                   bigint generated always as identity primary key,
  purchase_request_id  bigint not null,
  quando               timestamptz not null default now(),
  etapa                text,  -- engenharia | planejamento | compras
  acao                 text,  -- aprovada | reprovada | devolvida | reenviada | autorizada_sienge
  usuario              text,
  observacao           text
);
create index if not exists idx_aprov_sienge_ev on public.aprov_sienge_eventos(purchase_request_id, quando);

alter table public.aprov_sienge enable row level security;
drop policy if exists "aprov_sienge_all" on public.aprov_sienge;
create policy "aprov_sienge_all" on public.aprov_sienge for all using (true) with check (true);
alter table public.aprov_sienge_eventos enable row level security;
drop policy if exists "aprov_sienge_ev_all" on public.aprov_sienge_eventos;
create policy "aprov_sienge_ev_all" on public.aprov_sienge_eventos for all using (true) with check (true);
