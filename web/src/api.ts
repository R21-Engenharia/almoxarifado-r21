export type Status = 'ruptura' | 'critico' | 'baixo' | 'ok' | 'parado'

export interface FluxoMes { mes: string; entradas: number; saidas: number }
export interface FinanceiroKpis {
  capital_em_estoque: number; capital_ocioso: number; selic_mensal: number
  selic_anual_pct: number; estoque_consumido_pct: number; ociosidade_media_dias: number
  n_insumos: number; n_parados: number
}
export interface Financeiro { hoje: string; kpis: FinanceiroKpis; fluxo: FluxoMes[] }

export interface Item {
  resource_id: string
  descricao: string
  grupo: string
  macro: string
  saldo: number
  unidade: string
  consumo_dia: number
  cobertura_dias: number | null
  data_ruptura: string | null
  custo_unit: number
  valor_saldo: number
  impacto_dia: number
  status: Status
  ultimo_consumo: string | null
  ultimo_mov: string | null
  n_movs: number
  fornecedores: string[]
  saldo_negativo: boolean
  unidade_inconsistente: boolean
}

export interface Kpis {
  n_insumos: number
  valor_em_estoque: number
  valor_parado: number
  resumo_status: Record<string, number>
  unidades_inconsistentes: number
  saldos_negativos: number
}

export interface Material {
  hoje: string
  janela_dias: number
  kpis: Kpis
  alertas: Item[]
  parados: Item[]
  itens: Item[]
}

export interface Movimento {
  id: number
  criado_em: string
  usuario: string
  obra: string
  resource_id: string
  descricao: string | null
  operacao: string
  quantidade: number
  unidade: string | null
  document_id: string | null
  sienge_movement_id: string | null
  estornado: number
  estorno_de: number | null
}

export interface Obra { prevision_id: string; nome: string }

import { supabase } from './supabase'

// Em produção (Vercel) aponta para o backend no Render (VITE_API_BASE).
// No dev local fica vazio e o proxy do Vite cuida do /api.
const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') || ''

async function j<T>(r: Response): Promise<T> {
  if (!r.ok) {
    const txt = await r.text()
    let msg = txt || `${r.status}`
    try { const o = JSON.parse(txt); msg = o.detail || o.message || msg } catch { /* texto puro */ }
    throw new Error(msg)
  }
  return r.json()
}

// injeta o token do Supabase (Bearer) em toda requisição
async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(opts.headers as Record<string, string> || {}) }
  if (supabase) {
    const { data } = await supabase.auth.getSession()
    const tok = data.session?.access_token
    if (tok) headers['Authorization'] = `Bearer ${tok}`
  }
  return fetch(API_BASE + path, { ...opts, headers }).then(j<T>)
}

export const api = {
  health: () => fetch(API_BASE + '/api/health').then(j<{ ok: boolean; modo: string; auth: boolean }>),
  obras: () => req<Obra[]>('/api/obras'),
  material: (obra: string, janela = 90) =>
    req<Material>(`/api/estoque/material?obra=${obra}&janela_dias=${janela}`),
  financeiro: (obra: string, meses = 12) =>
    req<Financeiro>(`/api/estoque/financeiro?obra=${obra}&meses=${meses}`),
  catalogo: (obra: string) =>
    req<{ itens: Item[]; macro_ordem: string[] }>(`/api/estoque/catalogo?obra=${obra}`),
  insumos: (obra: string, q: string) =>
    req<{ itens: Item[] }>(`/api/estoque/insumos?obra=${obra}&q=${encodeURIComponent(q)}`),
  movimentos: (obra: string) =>
    req<{ itens: Movimento[] }>(`/api/estoque/movimentos?obra=${obra}`),
  atualizar: (obra: string) =>
    req<{ ok: boolean; coletado_em: string | null }>(`/api/estoque/atualizar?obra=${obra}`, { method: 'POST' }),
  baixa: (obra: string, itens: EscritaItem[]) =>
    req<WriteResp>(`/api/estoque/baixa?obra=${obra}`, { method: 'POST', body: JSON.stringify({ itens }) }),
  entrada: (obra: string, itens: EscritaItem[]) =>
    req<WriteResp>(`/api/estoque/entrada?obra=${obra}`, { method: 'POST', body: JSON.stringify({ itens }) }),
  estorno: (auditoria_id: number) =>
    req<WriteResp>(`/api/estoque/estorno`, { method: 'POST', body: JSON.stringify({ auditoria_id }) }),
}

export interface EscritaItem { resource_id: string; quantidade: number; unidade?: string; descricao?: string }
export interface WriteResp { ok: boolean; modo?: string; auditoria_ids: number[] }

export const STATUS_LABEL: Record<Status, string> = {
  ruptura: 'Ruptura', critico: 'Crítico', baixo: 'Baixo', ok: 'OK', parado: 'Parado',
}
export function brl(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
export function num(v: number | null, d = 0) {
  if (v === null || v === undefined) return '—'
  return v.toLocaleString('pt-BR', { maximumFractionDigits: d })
}
