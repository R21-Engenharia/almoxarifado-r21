// Camada de dupla aprovação do BOX21 SOBRE as solicitações reais do Sienge.
// A solicitação em si vem do Sienge (api.pendentesSolic). Aqui guardamos só o
// estado da aprovação (Engenheiro -> Planejamento -> autoriza no Sienge),
// numa tabela overlay chaveada pelo purchase_request_id.
import { supabase } from './supabase'
import { api } from './api'

export type SolicStatus =
  | 'aguardando_engenharia' | 'aguardando_planejamento' | 'em_compras' | 'reprovada' | 'devolvida'

export interface AprovOverlay {
  purchase_request_id: number
  obra: string
  status: SolicStatus
  eng_por: string | null; eng_em: string | null; eng_obs: string | null
  plan_por: string | null; plan_em: string | null; plan_obs: string | null
  autorizado_sienge: boolean
  criado_em: string
}

export interface AprovEvento {
  id: number; purchase_request_id: number; quando: string
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

export async function meuPapel(): Promise<string> {
  if (!supabase) return 'admin'
  const { data: u } = await supabase.auth.getUser()
  const email = u.user?.email
  if (!email) return ''
  const { data } = await supabase.from('authorized_emails').select('role').eq('email', email).maybeSingle()
  return ((data?.role as string) || '').toLowerCase()
}

// Estado overlay (todas as PRs de uma obra), como mapa por purchase_request_id.
export async function overlays(obra: string): Promise<Record<number, AprovOverlay>> {
  if (!supabase) return {}
  const { data, error } = await supabase.from('aprov_sienge').select('*').eq('obra', obra)
  if (error) throw new Error(error.message)
  const m: Record<number, AprovOverlay> = {}
  for (const o of (data || []) as AprovOverlay[]) m[o.purchase_request_id] = o
  return m
}

async function garantir(pr: number, obra: string): Promise<AprovOverlay> {
  if (!supabase) throw new Error('Supabase indisponível')
  const { data } = await supabase.from('aprov_sienge').select('*').eq('purchase_request_id', pr).maybeSingle()
  if (data) return data as AprovOverlay
  const { data: novo, error } = await supabase.from('aprov_sienge')
    .insert({ purchase_request_id: pr, obra, status: 'aguardando_engenharia' }).select().single()
  if (error) throw new Error(error.message)
  return novo as AprovOverlay
}

async function evento(pr: number, etapa: string, acao: string, observacao?: string) {
  if (!supabase) return
  const usuario = await usuarioAtual()
  await supabase.from('aprov_sienge_eventos')
    .insert({ purchase_request_id: pr, etapa, acao, usuario, observacao: observacao || null })
}

export async function eventos(pr: number): Promise<AprovEvento[]> {
  if (!supabase) return []
  const { data } = await supabase.from('aprov_sienge_eventos').select('*')
    .eq('purchase_request_id', pr).order('quando')
  return (data || []) as AprovEvento[]
}

// Engenheiro aprova -> aguardando_planejamento.
// Planejamento aprova -> autoriza no Sienge -> em_compras.
export async function aprovar(pr: number, obra: string, etapa: 'engenharia' | 'planejamento', obs?: string): Promise<void> {
  if (!supabase) throw new Error('Supabase indisponível')
  await garantir(pr, obra)
  const usuario = await usuarioAtual()
  const agora = new Date().toISOString()
  if (etapa === 'engenharia') {
    const { error } = await supabase.from('aprov_sienge')
      .update({ eng_por: usuario, eng_em: agora, eng_obs: obs || null, status: 'aguardando_planejamento' })
      .eq('purchase_request_id', pr)
    if (error) throw new Error(error.message)
    await evento(pr, 'engenharia', 'aprovada', obs)
    return
  }
  // Planejamento: só aqui escreve de volta no Sienge (autoriza -> vai p/ Compras).
  await api.siengeAutorizar(pr)
  const { error } = await supabase.from('aprov_sienge')
    .update({ plan_por: usuario, plan_em: agora, plan_obs: obs || null, status: 'em_compras', autorizado_sienge: true })
    .eq('purchase_request_id', pr)
  if (error) throw new Error(error.message)
  await evento(pr, 'planejamento', 'aprovada', obs)
  await evento(pr, 'compras', 'autorizada_sienge', 'Autorizada no Sienge — enviada para Compras')
}

// Reprovar em qualquer etapa: grava disapproval no Sienge (terminal).
export async function reprovar(pr: number, obra: string, etapa: 'engenharia' | 'planejamento', motivo: string): Promise<void> {
  if (!supabase) throw new Error('Supabase indisponível')
  await garantir(pr, obra)
  await api.siengeReprovar(pr, motivo)
  const usuario = await usuarioAtual()
  const agora = new Date().toISOString()
  const patch = etapa === 'engenharia'
    ? { eng_por: usuario, eng_em: agora, eng_obs: motivo, status: 'reprovada' as SolicStatus }
    : { plan_por: usuario, plan_em: agora, plan_obs: motivo, status: 'reprovada' as SolicStatus }
  const { error } = await supabase.from('aprov_sienge').update(patch).eq('purchase_request_id', pr)
  if (error) throw new Error(error.message)
  await evento(pr, etapa, 'reprovada', motivo)
}

// Devolver p/ ajuste: estado só do BOX21 (não escreve no Sienge; a PR segue lá
// pendente para o solicitante corrigir).
export async function devolver(pr: number, obra: string, etapa: 'engenharia' | 'planejamento', obs: string): Promise<void> {
  if (!supabase) throw new Error('Supabase indisponível')
  await garantir(pr, obra)
  const { error } = await supabase.from('aprov_sienge').update({ status: 'devolvida' }).eq('purchase_request_id', pr)
  if (error) throw new Error(error.message)
  await evento(pr, etapa, 'devolvida', obs)
}
