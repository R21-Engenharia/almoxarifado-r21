-- Perfis de usuário (nome, foto, função) ligados à conta (Google ou e-mail).
-- Rodar no SQL Editor do Supabase. Cada usuário só enxerga/edita o próprio perfil.

create table if not exists public.perfis (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text,
  nome          text,
  funcao        text,
  foto_url      text,
  atualizado_em timestamptz not null default now()
);

alter table public.perfis enable row level security;

drop policy if exists "perfil_select" on public.perfis;
create policy "perfil_select" on public.perfis
  for select using (auth.uid() = id);

drop policy if exists "perfil_insert" on public.perfis;
create policy "perfil_insert" on public.perfis
  for insert with check (auth.uid() = id);

drop policy if exists "perfil_update" on public.perfis;
create policy "perfil_update" on public.perfis
  for update using (auth.uid() = id);

-- Bucket público para as fotos de avatar.
insert into storage.buckets (id, name, public)
  values ('avatars', 'avatars', true)
  on conflict (id) do nothing;

drop policy if exists "avatars_read" on storage.objects;
create policy "avatars_read" on storage.objects
  for select to public using (bucket_id = 'avatars');

drop policy if exists "avatars_upload" on storage.objects;
create policy "avatars_upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars_update" on storage.objects;
create policy "avatars_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
