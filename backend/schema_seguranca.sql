-- BOX21 · Isolamento & Segurança (RLS)
-- ---------------------------------------------------------------------------
-- PROBLEMA que isto corrige: hoje as tabelas do app têm policy `using(true)`,
-- então QUALQUER pessoa com a anon key (que é pública, vai no bundle do front)
-- lê/grava tudo direto na API REST do Supabase, sem nem logar.
--
-- DEPOIS desta migração: só quem está em `authorized_emails` acessa o operacional;
-- cada um vê só o próprio perfil; a lista de autorizados não é enumerável; e a
-- auditoria fica exclusiva do backend (service_role).
--
-- ⚠️ ORDEM DE APLICAÇÃO (importante, senão derruba o login):
--   1) No Render, defina a env  SUPABASE_SERVICE_KEY  = a chave *service_role*
--      do projeto (Supabase → Settings → API → service_role). NUNCA no front.
--   2) Redeploy do backend (já usa a service_role para checar authorized_emails
--      e auditoria — com fallback pra anon enquanto a env não existir).
--   3) SÓ ENTÃO rode este SQL no SQL Editor do Supabase.
-- ---------------------------------------------------------------------------

-- 1) função-porteiro: o e-mail do token está em authorized_emails?
--    SECURITY DEFINER => lê authorized_emails ignorando o RLS dela.
create or replace function public.email_autorizado()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.authorized_emails ae
    where lower(ae.email) = lower(auth.jwt() ->> 'email')
  );
$$;
revoke all on function public.email_autorizado() from public;
grant execute on function public.email_autorizado() to authenticated;

-- 2) helper: derruba TODAS as policies de uma tabela e cria a policy de
--    acesso "somente usuário autorizado" (evita sobrar um using(true) antigo).
do $$
declare
  t text;
  p record;
  operacionais text[] := array[
    'aprov_sienge','aprov_sienge_eventos','plano_compra','plano_compra_itens',
    'equipamentos','equip_movimentacoes'
  ];
begin
  foreach t in array operacionais loop
    if to_regclass('public.'||t) is null then
      raise notice 'tabela % nao existe, pulando', t; continue;
    end if;
    execute format('alter table public.%I enable row level security', t);
    for p in select policyname from pg_policies where schemaname='public' and tablename=t loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
    execute format($f$
      create policy %I on public.%I for all to authenticated
      using (public.email_autorizado()) with check (public.email_autorizado())
    $f$, t||'_autorizados', t);
  end loop;
end $$;

-- 3) perfis: cada usuário só o PRÓPRIO perfil (id = auth.uid())
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

-- 4) authorized_emails: leitura SÓ da própria linha (para saber o próprio papel);
--    nenhuma policy de escrita => ninguém se auto-adiciona (gestão pelo painel/service_role).
do $$
declare p record;
begin
  if to_regclass('public.authorized_emails') is not null then
    alter table public.authorized_emails enable row level security;
    for p in select policyname from pg_policies where schemaname='public' and tablename='authorized_emails' loop
      execute format('drop policy %I on public.authorized_emails', p.policyname);
    end loop;
    create policy authemails_own_read on public.authorized_emails for select to authenticated
      using (lower(email) = lower(auth.jwt() ->> 'email'));
  end if;
end $$;

-- 5) auditoria (estoque_movimentos): SÓ o backend (service_role). RLS ligado e
--    sem nenhuma policy permissiva => anon/authenticated não acessam.
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

-- 6) Storage 'avatars': leitura pública (foto de perfil) continua; upload só
--    por usuário autenticado autorizado.
do $$
declare p record;
begin
  for p in select policyname from pg_policies
           where schemaname='storage' and tablename='objects'
             and policyname in ('avatars_insert_auth') loop
    execute format('drop policy %I on storage.objects', p.policyname);
  end loop;
  create policy avatars_insert_auth on storage.objects for insert to authenticated
    with check (bucket_id = 'avatars' and public.email_autorizado());
end $$;
