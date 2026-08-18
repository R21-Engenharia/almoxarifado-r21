import { supabase } from './supabase'

export interface Perfil {
  id: string
  email: string | null
  nome: string | null
  funcao: string | null
  foto_url: string | null
}

export interface DadosGoogle { nome: string; foto: string; email: string }

// nome/foto que o Google (ou o cadastro) já forneceu, para pré-preencher o perfil
export async function dadosDaSessao(): Promise<DadosGoogle> {
  if (!supabase) return { nome: '', foto: '', email: '' }
  const { data } = await supabase.auth.getUser()
  const u = data.user
  const m = (u?.user_metadata ?? {}) as Record<string, string>
  return {
    nome: m.full_name || m.name || '',
    foto: m.avatar_url || m.picture || '',
    email: u?.email || '',
  }
}

export async function carregarPerfil(): Promise<Perfil | null> {
  if (!supabase) return null
  const { data: u } = await supabase.auth.getUser()
  const user = u.user
  if (!user) return null
  const { data } = await supabase.from('perfis').select('*').eq('id', user.id).maybeSingle()
  return (data as Perfil | null) ?? null
}

export async function salvarPerfil(p: { nome: string; funcao: string; foto_url?: string | null }) {
  if (!supabase) return
  const { data: u } = await supabase.auth.getUser()
  const user = u.user
  if (!user) return
  const { error } = await supabase.from('perfis').upsert({
    id: user.id, email: user.email, nome: p.nome, funcao: p.funcao,
    foto_url: p.foto_url ?? null, atualizado_em: new Date().toISOString(),
  })
  if (error) throw new Error(error.message)
}

export async function uploadFoto(file: File): Promise<string> {
  if (!supabase) throw new Error('Supabase indisponível')
  const { data: u } = await supabase.auth.getUser()
  const user = u.user
  if (!user) throw new Error('Sem sessão')
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
  const path = `${user.id}/avatar.${ext}`
  const { error } = await supabase.storage.from('avatars').upload(path, file, {
    upsert: true, contentType: file.type,
  })
  if (error) throw new Error(error.message)
  const { data } = supabase.storage.from('avatars').getPublicUrl(path)
  return `${data.publicUrl}?t=${Date.now()}`
}
