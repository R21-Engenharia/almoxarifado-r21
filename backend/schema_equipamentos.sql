-- BOX21 · Controle de Equipamentos (dados próprios, não do Sienge).
-- Rodar no SQL Editor do Supabase.

create table if not exists public.equipamentos (
  id            uuid primary key default gen_random_uuid(),
  codigo        text not null,
  nome          text not null,
  tipo          text,
  marca_modelo  text,
  foto_url      text,
  obra          text,
  status        text not null default 'almoxarifado',  -- almoxarifado|campo|manutencao|emprestado|inativo
  conservacao   text default 'bom',                    -- bom|regular|ruim
  localizacao   text,
  responsavel   text,
  prox_manutencao date,
  criado_em     timestamptz not null default now(),
  criado_por    text
);
create index if not exists idx_equip_obra on public.equipamentos(obra, criado_em desc);

create table if not exists public.equip_movimentacoes (
  id             bigint generated always as identity primary key,
  equipamento_id uuid references public.equipamentos(id) on delete cascade,
  quando         timestamptz not null default now(),
  tipo           text not null,   -- cadastro|saida|retorno|transferencia|manutencao|conservacao
  status         text,
  conservacao    text,
  localizacao    text,
  responsavel    text,
  usuario        text,
  obs            text
);
create index if not exists idx_equipmov on public.equip_movimentacoes(equipamento_id, quando desc);

-- RLS: acesso controlado pela app (login Supabase + authorized_emails)
alter table public.equipamentos enable row level security;
drop policy if exists "equip_all" on public.equipamentos;
create policy "equip_all" on public.equipamentos for all using (true) with check (true);
alter table public.equip_movimentacoes enable row level security;
drop policy if exists "equipmov_all" on public.equip_movimentacoes;
create policy "equipmov_all" on public.equip_movimentacoes for all using (true) with check (true);

-- Bucket público para fotos dos equipamentos
insert into storage.buckets (id, name, public) values ('equipamentos','equipamentos', true)
  on conflict (id) do nothing;
drop policy if exists "equip_foto_read" on storage.objects;
create policy "equip_foto_read" on storage.objects for select to public using (bucket_id = 'equipamentos');
drop policy if exists "equip_foto_write" on storage.objects;
create policy "equip_foto_write" on storage.objects for insert to authenticated with check (bucket_id = 'equipamentos');
drop policy if exists "equip_foto_update" on storage.objects;
create policy "equip_foto_update" on storage.objects for update to authenticated using (bucket_id = 'equipamentos');
