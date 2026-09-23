-- ============================================================================
-- BOX21 · Migração B (set/2026) — rodar DEPOIS que o deploy dos passos 01–03
-- estiver no ar (Vercel e Render)
-- ----------------------------------------------------------------------------
-- Fecha a escrita direta nas tabelas da dupla aprovação. A partir daqui só o
-- backend (service_role) muda o estado de uma aprovação — e ele confere papel,
-- etapa e se a solicitação ainda está pendente no Sienge. O front só LÊ.
--
-- Se rodar ANTES do deploy, o front antigo (que gravava direto) para de conseguir
-- aprovar. Por isso a ordem.
-- ============================================================================

do $$
declare t text; p record;
begin
  foreach t in array array['aprov_sienge','aprov_sienge_eventos'] loop
    if to_regclass('public.'||t) is null then continue; end if;
    execute format('alter table public.%I enable row level security', t);
    for p in select policyname from pg_policies where schemaname='public' and tablename=t loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
    execute format('create policy %I on public.%I for select to authenticated using (public.email_autorizado())',
                   t||'_leitura', t);
  end loop;
end $$;
