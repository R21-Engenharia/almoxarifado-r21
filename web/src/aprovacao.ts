import { supabase } from './supabase'

export type SolicStatus =
  | 'aguardando_engenharia' | 'aguardando_planejamento' | 'em_compras' | 'reprovada' | 'devolvida'

export interface Solicitacao {
  id: string
  criado_em: string
  criado_por: string | null
  obra: string
  obra_nome: string | null
  resource_id: string
  insumo_desc: string | null
  unidade: string | null
  quantidade: number
  sheet_item_id: number | null
  wbs_code: string | null
  subetapa_desc: string | null
  qtd_orcada: number | null
  divergencia: boolean
  justificativa: string | null
  status: SolicStatus
  eng_por: string | null; eng_em: string | null; eng_obs: string | null
  plan_por: string | null; plan_em: string | null; plan_obs: string | null
}

export interface SolicEvento {
  id: number; solicitacao_id: string; quando: string
  etapa: string | null; acao: string | null; usuario: string | null; observacao: string | null
}

export const STATUS_SOLIC: Record<SolicStatus, string> = {
  aguardando_engenharia: 'Aguardando Engenharia',
  aguardando_planejamento: 'Aguardando Planejamento',
  em_compras: 'Enviada p/ Compras',
  reprovada: 'Reprovada',
  devolvida: 'Devolvida p/ ajuste',
}
export const STATUS_TONE: Record<SolicStatus, string> = {
  aguardando_engenharia: 'baixo', aguardando_planejamento: 'critico',
  em_compras: 'ok', reprovada: 'ruptura', devolvida: 'parado',
}

async function usuarioAtual(): Promise<string> {
  if (!supabase) return 'dev'
  const { data } = await supabase.auth.getUser()
  return data.user?.email || 'app'
}

export async function listar(obra: string): Promise<Solicitacao[]> {
  if (!supabase) return []
  const { data, error } = await supabase.from('solicitacoes').select('*')
    .eq('obra', obra).order('criado_em', { ascending: false })
  if (error) throw new Error(error.message)
  return (data || []) as Solicitacao[]
}

export async function criar(s: Partial<Solicitacao> & { obra: string; resource_id: string; quantidade: number }): Promise<Solicitacao> {
  if (!supabase) throw new Error('Supabase indisponível')
  const criado_por = await usuarioAtual()
  const { data, error } = await supabase.from('solicitacoes')
    .insert({ ...s, criado_por, status: 'aguardando_engenharia' }).select().single()
  if (error) throw new Error(error.message)
  await evento(data.id, 'criacao', 'criada', 'Solicitação criada')
  return data as Solicitacao
}

async function evento(solicitacao_id: string, etapa: string, acao: string, observacao?: string) {
  if (!supabase) return
  const usuario = await usuarioAtual()
  await supabase.from('solicitacao_eventos').insert({ solicitacao_id, etapa, acao, usuario, observacao: observacao || null })
}

export async function decidir(s: Solicitacao, etapa: 'engenharia' | 'planejamento',
  acao: 'aprovada' | 'reprovada' | 'devolvida', obs?: string): Promise<void> {
  if (!supabase) throw new Error('Supabase indisponível')
  const usuario = await usuarioAtual()
  const agora = new Date().toISOString()
  const patch: Partial<Solicitacao> = {}
  if (etapa === 'engenharia') {
    patch.eng_por = usuario; patch.eng_em = agora; patch.eng_obs = obs || null
    patch.status = acao === 'aprovada' ? 'aguardando_planejamento' : acao === 'devolvida' ? 'devolvida' : 'reprovada'
  } else {
    patch.plan_por = usuario; patch.plan_em = agora; patch.plan_obs = obs || null
    patch.status = acao === 'aprovada' ? 'em_compras' : acao === 'devolvida' ? 'devolvida' : 'reprovada'
  }
  const { error } = await supabase.from('solicitacoes').update(patch).eq('id', s.id)
  if (error) throw new Error(error.message)
  await evento(s.id, etapa, acao, obs)
}

export async function reenviar(s: Solicitacao, obs?: string): Promise<void> {
  if (!supabase) throw new Error('Supabase indisponível')
  const { error } = await supabase.from('solicitacoes').update({ status: 'aguardando_engenharia' }).eq('id', s.id)
  if (error) throw new Error(error.message)
  await evento(s.id, 'criacao', 'reenviada', obs)
}

export async function meuPapel(): Promise<string> {
  if (!supabase) return 'admin'
  const { data: u } = await supabase.auth.getUser()
  const email = u.user?.email
  if (!email) return ''
  const { data } = await supabase.from('authorized_emails').select('role').eq('email', email).maybeSingle()
  return ((data?.role as string) || '').toLowerCase()
}

export async function eventos(id: string): Promise<SolicEvento[]> {
  if (!supabase) return []
  const { data } = await supabase.from('solicitacao_eventos').select('*')
    .eq('solicitacao_id', id).order('quando')
  return (data || []) as SolicEvento[]
}
