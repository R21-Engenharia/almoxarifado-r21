-- ============================================================================
-- BOX21 · SETUP COMPLETO DO SUPABASE  (rode este arquivo UMA VEZ, inteiro)
-- ----------------------------------------------------------------------------
-- Idempotente: pode rodar de novo sem quebrar nada.
-- Ordem: (1) tabelas do app  (2) colunas de usuário  (3) segurança/RLS por último.
--
-- ⚠️ PRÉ-REQUISITO (só p/ a parte de segurança): a env SUPABASE_SERVICE_KEY já
--    deve estar no Render e o backend redeployado. Se ainda não estiver, faça
--    isso ANTES de rodar (senão o login cai). Já foi feito nesta conta.
-- ============================================================================


-- ======================= 1) APROVAÇÕES (dupla aprovação) ====================
create table if not exists public.aprov_sienge (
  purchase_request_id  bigint primary key,
  obra                 text not null,
  status               text not null default 'aguardando_engenharia',
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
  etapa                text, acao text, usuario text, observacao text
);
create index if not exists idx_aprov_sienge_ev on public.aprov_sienge_eventos(purchase_request_id, quando);


-- ======================= 2) PLANO DE COMPRA (MRP) ===========================
create table if not exists public.plano_compra (
  id            uuid primary key default gen_random_uuid(),
  obra          text not null,
  criado_em     timestamptz not null default now(),
  criado_por    text,
  fornecedor    text,
  status        text not null default 'aberto',
  n_itens       int not null default 0,
  valor_total   numeric not null default 0
);
create index if not exists idx_plano_obra on public.plano_compra(obra, criado_em desc);

create table if not exists public.plano_compra_itens (
  id           bigint generated always as identity primary key,
  plano_id     uuid references public.plano_compra(id) on delete cascade,
  resource_id  text not null,
  descricao    text, unidade text,
  quantidade   numeric not null,
  custo_unit   numeric, valor numeric
);
create index if not exists idx_plano_itens on public.plano_compra_itens(plano_id);


-- ======================= 3) USUÁRIOS (perfil + permissões) ==================
alter table public.authorized_emails
  add column if not exists nome                text,
  add column if not exists cargo               text,
  add column if not exists tipo                text    default 'Geral',
  add column if not exists ativo               boolean default true,
  add column if not exists modulos             jsonb   default '[]'::jsonb,
  add column if not exists obras               jsonb   default '[]'::jsonb,
  add column if not exists gerenciar_usuarios  boolean default false,
  add column if not exists operar              boolean default false,
  add column if not exists gerar_plano         boolean default false,
  add column if not exists criado_em           timestamptz default now();

-- quem já é admin vira gestor de usuários automaticamente
update public.authorized_emails set gerenciar_usuarios = true
  where lower(coalesce(role,'')) = 'admin' and gerenciar_usuarios is distinct from true;


-- ======================= 4) SEGURANÇA / RLS (por último) ====================
-- porteiro: o e-mail do token está em authorized_emails? (SECURITY DEFINER)
create or replace function public.email_autorizado()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.authorized_emails ae
                 where lower(ae.email) = lower(auth.jwt() ->> 'email'));
$$;
revoke all on function public.email_autorizado() from public;
grant execute on function public.email_autorizado() to authenticated;

-- operacional: só usuário autorizado (derruba qualquer policy antiga using(true))
do $$
declare t text; p record;
  operacionais text[] := array['aprov_sienge','aprov_sienge_eventos',
    'plano_compra','plano_compra_itens','equipamentos','equip_movimentacoes'];
begin
  foreach t in array operacionais loop
    if to_regclass('public.'||t) is null then continue; end if;
    execute format('alter table public.%I enable row level security', t);
    for p in select policyname from pg_policies where schemaname='public' and tablename=t loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
    execute format('create policy %I on public.%I for all to authenticated using (public.email_autorizado()) with check (public.email_autorizado())', t||'_autorizados', t);
  end loop;
end $$;

-- perfis: cada um só o próprio
do $$
declare p record;
begin
  if to_regclass('public.perfis') is not null then
    alter table public.perfis enable row level security;
    for p in select policyname from pg_policies where schemaname='public' and tablename='perfis' loop
      execute format('drop policy %I on public.perfis', p.policyname);
    end loop;
    create policy perfis_own on public.perfis for all to authenticated
      using (id = auth.uid()) with check (id = auth.uid());
  end if;
end $$;

-- authorized_emails: leitura só da própria linha; sem escrita (gestão via backend/service_role)
do $$
declare p record;
begin
  alter table public.authorized_emails enable row level security;
  for p in select policyname from pg_policies where schemaname='public' and tablename='authorized_emails' loop
    execute format('drop policy %I on public.authorized_emails', p.policyname);
  end loop;
  create policy authemails_own_read on public.authorized_emails for select to authenticated
    using (lower(email) = lower(auth.jwt() ->> 'email'));
end $$;

-- auditoria: só o backend (service_role). RLS on, sem policy permissiva.
do $$
declare p record;
begin
  if to_regclass('public.estoque_movimentos') is not null then
    alter table public.estoque_movimentos enable row level security;
    for p in select policyname from pg_policies where schemaname='public' and tablename='estoque_movimentos' loop
      execute format('drop policy %I on public.estoque_movimentos', p.policyname);
    end loop;
  end if;
end $$;

-- storage avatars: leitura pública (foto de perfil); upload só autenticado autorizado
do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname='storage' and tablename='objects'
           and policyname = 'avatars_insert_auth' loop
    execute format('drop policy %I on storage.objects', p.policyname);
  end loop;
  create policy avatars_insert_auth on storage.objects for insert to authenticated
    with check (bucket_id = 'avatars' and public.email_autorizado());
end $$;

-- ============================================================================
-- FIM. Depois de rodar: no app, entre em Usuários → cada pessoa → Permissões,
-- e ligue "Operar" pros almoxarifes (aí eles conseguem baixa/entrada).
-- ============================================================================
