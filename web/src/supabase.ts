import { createClient } from '@supabase/supabase-js'

// Env da Vercel (mesmo projeto Supabase do app de validação).
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

// auth desligada no dev local se as envs não estiverem presentes
export const authAtiva = Boolean(url && anon)

export const supabase = authAtiva
  ? createClient(url!, anon!)
  : null
