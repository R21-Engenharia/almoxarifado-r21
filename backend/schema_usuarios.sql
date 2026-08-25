-- BOX21 · Módulo Usuários (perfil + permissões)
-- Estende authorized_emails (o "porteiro" do RLS) com dados de perfil e permissões.
-- A GESTÃO de usuários é feita pelo backend (service_role); o RLS continua
-- deixando cada usuário ler só a PRÓPRIA linha (para o app saber suas permissões).
--
-- Rodar no SQL Editor do Supabase (depois do schema_seguranca.sql).

alter table public.authorized_emails
  add column if not exists nome                text,
  add column if not exists cargo               text,
  add column if not exists tipo                text    default 'Geral',
  add column if not exists ativo               boolean default true,
  add column if not exists modulos             jsonb   default '[]'::jsonb,   -- ids de módulo; [] = todos
  add column if not exists obras               jsonb   default '[]'::jsonb,   -- prevision_ids; [] = todas
  add column if not exists gerenciar_usuarios  boolean default false,
  add column if not exists operar              boolean default false,        -- baixa/entrada no Sienge
  add column if not exists gerar_plano         boolean default false,
  add column if not exists criado_em           timestamptz default now();

-- role já existe (admin | engenheiro | planejamento | user) e alimenta a dupla aprovação.
-- garante que quem já é admin possa gerenciar usuários:
update public.authorized_emails set gerenciar_usuarios = true
  where lower(coalesce(role,'')) = 'admin' and gerenciar_usuarios is distinct from true;

-- (RLS de leitura da própria linha já foi criado em schema_seguranca.sql:
--  policy authemails_own_read. A gestão passa pelo backend com service_role.)
