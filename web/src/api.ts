export type Status = 'ruptura' | 'critico' | 'baixo' | 'ok' | 'parado'

export interface FluxoMes { mes: string; entradas: number; saidas: number }
export interface FinanceiroKpis {
  capital_em_estoque: number; capital_ocioso: number; selic_mensal: number
  selic_anual_pct: number; estoque_consumido_pct: number; ociosidade_media_dias: number
  n_insumos: number; n_parados: number
}
export interface Financeiro { hoje: string; kpis: FinanceiroKpis; fluxo: FluxoMes[] }

export interface ConsumoMes { mes: string; consumo: number }
export interface ConsumoItem {
  resource_id: string; descricao: string; unidade: string
  consumo_periodo: number; consumo_dia_valor: number; consumo_qtd: number
  cobertura_dias: number | null; saldo: number; ultimo_consumo: string | null
}
export interface ConsumoKpis {
  consumo_mes: number; consumo_medio_mes: number; consumo_total_periodo: number
  tendencia_pct: number | null; n_ativos: number; meses: number
}
export interface ConsumoData { hoje: string; kpis: ConsumoKpis; serie: ConsumoMes[]; top: ConsumoItem[] }

export interface SubetapaOrcada {
  sheet_item_id: number | null; building_unit_id: number | null; uc_nome: string | null
  wbs_code: string; descricao: string; qtd_orcada: number | null; apropriado_nf: number | null
}
export interface InsumoOrcamento {
  resource_id: string; descricao: string; unidade: string; saldo: number
  custo_unit: number; familia: string; orcado_total: number; subetapas: SubetapaOrcada[]
}

export interface SolicSiengeItem {
  item_number: number; resource_id: string; descricao: string
  quantidade: number; unidade: string | null
}
export interface SolicSienge {
  purchase_request_id: number; obra: string
  requester: string | null; data: string | null; notes: string | null; status: string | null
  itens: SolicSiengeItem[]
}
export interface ItemSubetapa {
  wbs_code: string; descricao: string; percentual: number | null
  uc_id: number | null; uc_nome: string | null
}
export interface WbsOpcao {
  uc_id: number; uc_nome: string | null; wbs_code: string; descricao: string; qtd_orcada: number | null
}
export interface CorrigirBody {
  obra: string; purchase_request_id: number; item_number: number
  apropriacoes: { building_unit_id: number; wbs_code: string; percentage: number }[]
  reprovar_original: boolean
}

export interface RecebFila {
  pedido_id: number; numero: string; data: string | null; dias_aberto: number | null
  fornecedor: string; valor: number; status: string; parcial: boolean; atrasado: boolean; comprador: string | null
}
export interface RecebLog {
  data: string; nf: string; fornecedor: string; resource_id: string; descricao: string
  quantidade: number; unidade: string; valor: number; preco_unit: number | null
}
export interface PedidoItem {
  resource_id: string; descricao: string; detalhe: string
  quantidade: number; unidade: string; preco_unit: number; valor: number
}
export interface RecebLead { fornecedor: string; n_receb: number; lead_mediano: number; lead_min: number; lead_max: number }
export interface RecebReaj {
  resource_id: string; descricao: string; unidade: string; preco_ant: number; preco_novo: number
  var_pct: number; data_ant: string; data_novo: string; forn_ant: string; forn_novo: string; mesmo_forn: boolean
}
export interface RecebimentosData {
  hoje: string
  kpis: {
    n_pendentes: number; valor_pendente: number; n_atrasados: number; valor_atrasado: number
    recebido_30d: number; n_recebido_30d: number; lead_time_mediano: number | null; n_reajustes: number
  }
  fila: RecebFila[]; lead_fornecedores: RecebLead[]; recebimentos: RecebLog[]; reajustes: RecebReaj[]
}

export interface SupItem {
  resource_id: string; descricao: string; unidade: string; macro: string
  saldo: number; consumo_dia: number; custo_unit: number; cobertura_dias: number; data_ruptura: string | null
  fornecedor: string | null; lead_dias: number; pct_no_prazo: number
  ss_dias: number; protecao_dias: number; rop_qtd: number
  dias_ate_pedir: number; data_limite: string
  qtd_sugerida: number; valor_sugerido: number
  custo_antecipar_dia: number; exposicao_parada_dia: number
  urgencia: 'comprar_agora' | 'esta_semana' | 'programar' | 'ok'
}
export interface SuprimentosData {
  hoje: string
  parametros: { cobertura_alvo_dias: number; selic_anual_pct: number }
  kpis: {
    n_comprar_agora: number; valor_comprar_agora: number; n_esta_semana: number; valor_esta_semana: number
    n_itens: number; valor_total_sugerido: number; economia_selic_mes: number; exposicao_parada_dia: number
  }
  itens: SupItem[]
}

export interface FornecedorItem {
  supplier_id: string; nome: string; n_pedidos: number; valor_total: number
  n_atrasados: number; n_autorizados: number; ultimo_pedido: string | null
  pct_no_prazo: number; pct_do_total: number
}
export interface FornecedoresData {
  hoje: string
  kpis: { n_fornecedores: number; valor_total: number; n_pedidos: number; pct_atraso: number; meses: number }
  fornecedores: FornecedorItem[]
}

export interface GrupoItem {
  resource_id: string; descricao: string; saldo: number; unidade: string
  valor_saldo: number; status: Status; cobertura_dias: number | null
}
export interface GrupoPos {
  grupo: string; categoria: string; familia: string
  n_insumos: number; valor_em_estoque: number; valor_parado: number
  n_parados: number; n_alertas: number; impacto_dia: number; pct_do_total: number
  itens?: GrupoItem[] | null
}
export interface Posicao {
  nivel: string; hoje: string; mapa_ok: boolean
  totais: { n_grupos: number; n_insumos: number; valor_em_estoque: number; valor_parado: number; sem_grupo: number }
  grupos: GrupoPos[]
}

export interface Item {
  resource_id: string
  descricao: string
  grupo: string
  macro: string
  familia?: string
  grupo_sienge?: string
  categoria?: string
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

export interface Conta {
  email: string; nome: string | null; cargo: string | null; tipo: string
  ativo: boolean; role: string; modulos: string[]; obras: string[]
  gerenciar_usuarios: boolean; operar: boolean; gerar_plano: boolean
}

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
  eu: () => req<Conta>('/api/eu'),
  usuarios: () => req<{ usuarios: Conta[]; modulos: string[] }>('/api/usuarios'),
  salvarUsuario: (u: Partial<Conta> & { email: string }) =>
    req<Conta>('/api/usuarios', { method: 'POST', body: JSON.stringify(u) }),
  material: (obra: string, janela = 90) =>
    req<Material>(`/api/estoque/material?obra=${obra}&janela_dias=${janela}`),
  financeiro: (obra: string, meses = 12) =>
    req<Financeiro>(`/api/estoque/financeiro?obra=${obra}&meses=${meses}`),
  consumo: (obra: string, meses = 12) =>
    req<ConsumoData>(`/api/estoque/consumo?obra=${obra}&meses=${meses}`),
  fornecedores: (obra: string, meses = 12) =>
    req<FornecedoresData>(`/api/estoque/fornecedores?obra=${obra}&meses=${meses}`),
  recebimentos: (obra: string, meses = 12) =>
    req<RecebimentosData>(`/api/estoque/recebimentos?obra=${obra}&meses=${meses}`),
  pedidoItens: (obra: string, pedidoId: number) =>
    req<{ itens: PedidoItem[] }>(`/api/estoque/pedido-itens?obra=${obra}&pedido_id=${pedidoId}`),
  suprimentos: (obra: string, coberturaAlvo = 45) =>
    req<SuprimentosData>(`/api/estoque/suprimentos?obra=${obra}&cobertura_alvo=${coberturaAlvo}`),
  atualizarPedidos: (obra: string) =>
    req<{ ok: boolean; rodando?: boolean; atual?: number }>(`/api/estoque/pedidos/atualizar?obra=${obra}`, { method: 'POST' }),
  posicao: (obra: string, nivel: 'grupo' | 'familia' | 'macro' = 'macro', detalhe = false) =>
    req<Posicao>(`/api/estoque/posicao?obra=${obra}&nivel=${nivel}&detalhe=${detalhe}`),
  atualizarGrupos: () =>
    req<{ ok: boolean; rodando?: boolean; atual?: number; n?: number }>(`/api/estoque/grupos/atualizar`, { method: 'POST' }),
  catalogo: (obra: string) =>
    req<{ itens: Item[]; macro_ordem: string[] }>(`/api/estoque/catalogo?obra=${obra}`),
  insumos: (obra: string, q: string) =>
    req<{ itens: Item[] }>(`/api/estoque/insumos?obra=${obra}&q=${encodeURIComponent(q)}`),
  insumoOrcamento: (obra: string, resourceId: string) =>
    req<InsumoOrcamento>(`/api/aprovacao/insumo-orcamento?obra=${obra}&resource_id=${resourceId}`),
  pendentesSolic: (obra: string) =>
    req<{ solicitacoes: SolicSienge[] }>(`/api/aprovacao/pendentes?obra=${obra}`),
  itemSubetapa: (obra: string, prId: number, itemNumber: number) =>
    req<{ subetapas: ItemSubetapa[] }>(`/api/aprovacao/item-subetapa?obra=${obra}&pr_id=${prId}&item_number=${itemNumber}`),
  wbsBusca: (obra: string, q: string, uc?: number) =>
    req<{ subetapas: WbsOpcao[] }>(`/api/aprovacao/wbs-busca?obra=${obra}&q=${encodeURIComponent(q)}${uc != null ? `&uc=${uc}` : ''}`),
  corrigirItem: (body: CorrigirBody) =>
    req<{ ok: boolean; reprovado_original: boolean }>(`/api/aprovacao/corrigir-item`, { method: 'POST', body: JSON.stringify(body) }),
  siengeAutorizar: (purchase_request_id: number) =>
    req<{ ok: boolean }>(`/api/aprovacao/sienge/autorizar`, { method: 'POST', body: JSON.stringify({ purchase_request_id }) }),
  siengeReprovar: (purchase_request_id: number, motivo: string) =>
    req<{ ok: boolean }>(`/api/aprovacao/sienge/reprovar`, { method: 'POST', body: JSON.stringify({ purchase_request_id, motivo }) }),
  movimentos: (obra: string) =>
    req<{ itens: Movimento[] }>(`/api/estoque/movimentos?obra=${obra}`),
  atualizar: (obra: string) =>
    req<{ ok: boolean; coletado_em: string | null }>(`/api/estoque/atualizar?obra=${obra}`, { method: 'POST' }),
  baixa: (obra: string, itens: EscritaItem[], extra?: { terceiro?: string; solicitante?: string }) =>
    req<WriteResp>(`/api/estoque/baixa?obra=${obra}`, { method: 'POST', body: JSON.stringify({ itens, ...extra }) }),
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
// família curta: descarta o prefixo "Custos Diretos | ..." e mostra o nome específico
export function familiaCurta(f?: string): string {
  if (!f) return ''
  const p = f.split('|'); return (p[p.length - 1] || f).trim()
}
