// Camada de dupla aprovação do BOX21 SOBRE as solicitações reais do Sienge.
// A solicitação em si vem do Sienge (api.pendentesSolic). O estado da aprovação
// (Engenheiro -> Planejamento -> autoriza no Sienge) fica numa tabela overlay
// chaveada pelo purchase_request_id — o front só LÊ; quem grava é o backend.
import { supabase } from './supabase'
import { api, type EtapaAprov } from './api'

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

export async function eventos(pr: number): Promise<AprovEvento[]> {
  if (!supabase) return []
  const { data } = await supabase.from('aprov_sienge_eventos').select('*')
    .eq('purchase_request_id', pr).order('quando')
  return (data || []) as AprovEvento[]
}

// Ações da dupla aprovação: quem valida papel, etapa e pendência no Sienge é o
// SERVIDOR (o front só lê o estado). Engenharia aprova -> aguardando_planejamento;
// Planejamento aprova -> autoriza no Sienge -> em_compras. Reprovar grava a
// reprovação no Sienge; devolver fica só no BOX21 (a PR segue pendente lá).
export async function aprovar(pr: number, obra: string, etapa: EtapaAprov, obs?: string): Promise<void> {
  await api.aprovacaoAcao(obra, pr, etapa, 'aprovada', obs)
}

export async function reprovar(pr: number, obra: string, etapa: EtapaAprov, motivo: string): Promise<void> {
  await api.aprovacaoAcao(obra, pr, etapa, 'reprovada', motivo)
}

export async function devolver(pr: number, obra: string, etapa: EtapaAprov, obs: string): Promise<void> {
  await api.aprovacaoAcao(obra, pr, etapa, 'devolvida', obs)
}
