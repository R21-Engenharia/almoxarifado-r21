import { createClient } from '@supabase/supabase-js'

// Link de acesso (convite ou "defina sua senha"): o Supabase devolve o tipo e os erros
// no fragmento da URL. Lido ANTES de criar o cliente, que limpa o fragmento ao entrar.
const frag = new URLSearchParams(window.location.hash.replace(/^#/, ''))
export const linkAcesso: { tipo: string | null; erro: string | null } = {
  tipo: frag.get('type'),
  erro: frag.get('error_description'),
}
if (linkAcesso.erro) window.history.replaceState(null, '', window.location.pathname)

// Env da Vercel (mesmo projeto Supabase do app de validação).
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

// auth desligada no dev local se as envs não estiverem presentes
export const authAtiva = Boolean(url && anon)

export const supabase = authAtiva
  ? createClient(url!, anon!)
  : null
