-- Rodar no SQL Editor do Supabase. Adiciona os campos da requisição/retirada
-- (quem retirou) na auditoria de movimentações.
alter table public.estoque_movimentos
  add column if not exists terceiro text,
  add column if not exists solicitante text;
