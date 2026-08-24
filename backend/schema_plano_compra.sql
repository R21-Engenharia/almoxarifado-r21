-- BOX21 · Plano de Compra gerado pelo MRP (Suprimentos)
-- A cesta do MRP é consolidada por fornecedor e vira um "plano de compra" por
-- fornecedor: a decisão que o comprador executa. Chave: resource_id marcado
-- como "no plano" some da urgência do MRP até o plano ser resolvido.
--
-- Rodar no SQL Editor do Supabase.

create table if not exists public.plano_compra (
  id            uuid primary key default gen_random_uuid(),
  obra          text not null,
  criado_em     timestamptz not null default now(),
  criado_por    text,
  fornecedor    text,
  status        text not null default 'aberto',   -- aberto | pedido | cancelado
  n_itens       int not null default 0,
  valor_total   numeric not null default 0
);
create index if not exists idx_plano_obra on public.plano_compra(obra, criado_em desc);

create table if not exists public.plano_compra_itens (
  id           bigint generated always as identity primary key,
  plano_id     uuid references public.plano_compra(id) on delete cascade,
  resource_id  text not null,
  descricao    text,
  unidade      text,
  quantidade   numeric not null,
  custo_unit   numeric,
  valor        numeric
);
create index if not exists idx_plano_itens on public.plano_compra_itens(plano_id);

alter table public.plano_compra enable row level security;
drop policy if exists "plano_all" on public.plano_compra;
create policy "plano_all" on public.plano_compra for all using (true) with check (true);
alter table public.plano_compra_itens enable row level security;
drop policy if exists "plano_itens_all" on public.plano_compra_itens;
create policy "plano_itens_all" on public.plano_compra_itens for all using (true) with check (true);
