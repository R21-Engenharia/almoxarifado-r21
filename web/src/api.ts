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

export interface VarianteSaldo {
  detail_id: number | null; detail_desc: string
  trademark_id: number | null; trademark_desc: string
  saldo: number; unidade: string | null
}
export interface SolicSiengeItem {
  item_number: number; resource_id: string; descricao: string
  quantidade: number; unidade: string | null
  // detalhe/variação pedida (quando o Sienge informa) + projeção de estoque da compra
  detail_id?: number | null; detail_desc?: string | null
  trademark_id?: number | null; trademark_desc?: string | null
  estoque_atual?: number; estoque_unidade?: string | null; estoque_projetado?: number
  variantes?: VarianteSaldo[]
  // outros detalhes do MESMO insumo com estoque > 0 (exceto o solicitado) — informativo
  outros_detalhes?: VarianteSaldo[]
  // comprado e ainda não recebido (pedidos em aberto) — informativo, fora da fórmula
  a_caminho?: number; a_caminho_estimado?: boolean; a_caminho_pedidos?: string[]
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
  a_caminho: number; posicao: number   // comprado e não recebido; posição = saldo + a caminho
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
    n_com_a_caminho?: number
  }
  itens: SupItem[]
  // pedidos em aberto lidos ao vivo do Sienge (base do "a caminho")
  a_caminho?: { atualizado_em: string | null; erro: string | null; n_pedidos: number; n_sem_conversao: number }
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
  ultima_entrada?: string | null
  ultimo_mov: string | null
  n_movs: number
  fornecedores: string[]
  saldo_negativo: boolean
  unidade_inconsistente: boolean
  reservado?: number   // requisições aprovadas e ainda não entregues (disponível = saldo − reservado)
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
  estornado: boolean | number
  estorno_de: number | null
  // escrita segura: pendente = enviado ao Sienge sem confirmação; falhou = recusado
  status?: 'pendente' | 'gravado' | 'falhou' | null
  erro?: string | null
  variante?: string | null
  detail_id?: number | null
  eap_codigo?: string | null
  eap_descricao?: string | null
  motivo?: string | null
  condicao?: string | null
  obra_contraparte?: string | null
  terceiro?: string | null
}

export type EtapaAprov = 'engenharia' | 'planejamento'
export type AcaoAprov = 'aprovada' | 'reprovada' | 'devolvida'

export type ClasseABC = 'A' | 'B' | 'C' | '—'

export interface LinhaABC {
  resource_id: string
  descricao: string
  grupo: string
  familia: string
  macro: string
  unidade: string
  saldo: number
  custo_unit: number
  valor_saldo: number
  pct_do_total: number
  pct_acumulado: number | null
  abc: ClasseABC
  status: Status
  ultima_entrada: string | null
  ultimo_consumo: string | null
}

export interface CurvaABC {
  hoje: string
  valor_total: number
  n_itens: number
  resumo: Record<'A' | 'B' | 'C', { n_itens: number; valor: number; pct_valor: number }>
  itens: LinhaABC[]
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
  curvaAbc: (obra: string, janela = 90) =>
    req<CurvaABC>(`/api/estoque/curva-abc?obra=${obra}&janela_dias=${janela}`),
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
  insumoVariantes: (obra: string, resourceId: string, todas = false) =>
    req<{ variantes: Variante[] }>(`/api/estoque/insumo-variantes?obra=${obra}&resource_id=${resourceId}&todas=${todas}`),
  embalagens: () => req<{ embalagens: Embalagem[] }>(`/api/estoque/embalagens`),
  salvarEmbalagem: (e: { resource_id: string; nome: string; fator: number; unidade?: string }) =>
    req<Embalagem>(`/api/estoque/embalagens`, { method: 'POST', body: JSON.stringify(e) }),
  deletarEmbalagem: (id: string) =>
    req<{ ok: boolean }>(`/api/estoque/embalagens/${id}`, { method: 'DELETE' }),
  insumos: (obra: string, q: string) =>
    req<{ itens: Item[] }>(`/api/estoque/insumos?obra=${obra}&q=${encodeURIComponent(q)}`),
  insumoOrcamento: (obra: string, resourceId: string) =>
    req<InsumoOrcamento>(`/api/aprovacao/insumo-orcamento?obra=${obra}&resource_id=${resourceId}`),
  pendentesSolic: (obra: string) =>
    req<{ solicitacoes: SolicSienge[] }>(`/api/aprovacao/pendentes?obra=${obra}`),
  itemSubetapa: (obra: string, prId: number, itemNumber: number) =>
    req<{ subetapas: ItemSubetapa[] }>(`/api/aprovacao/item-subetapa?obra=${obra}&pr_id=${prId}&item_number=${itemNumber}`),
  // dupla aprovação: o servidor confere papel, etapa e pendência no Sienge
  aprovacaoAcao: (obra: string, purchase_request_id: number, etapa: EtapaAprov, acao: AcaoAprov, obs?: string) =>
    req<{ ok: boolean }>(`/api/aprovacao/acao?obra=${obra}`, {
      method: 'POST', body: JSON.stringify({ purchase_request_id, etapa, acao, obs: obs || null }),
    }),
  movimentos: (obra: string) =>
    req<{ itens: Movimento[] }>(`/api/estoque/movimentos?obra=${obra}`),
  atualizar: (obra: string) =>
    req<{ ok: boolean; coletado_em: string | null }>(`/api/estoque/atualizar?obra=${obra}`, { method: 'POST' }),
  // chave = Idempotency-Key da cesta: repetir a mesma cesta não regrava no Sienge
  baixa: (obra: string, itens: EscritaItem[], chave: string, extra?: { terceiro?: string; solicitante?: string; eap?: EapRef | null }) =>
    req<WriteResp>(`/api/estoque/baixa?obra=${obra}`, {
      method: 'POST', headers: { 'Idempotency-Key': chave }, body: JSON.stringify({ itens, ...extra }),
    }),
  entrada: (obra: string, itens: EscritaItem[], chave: string) =>
    req<WriteResp>(`/api/estoque/entrada?obra=${obra}`, {
      method: 'POST', headers: { 'Idempotency-Key': chave }, body: JSON.stringify({ itens }),
    }),
  estorno: (auditoria_id: number) =>
    req<WriteResp>(`/api/estoque/estorno`, { method: 'POST', body: JSON.stringify({ auditoria_id }) }),
  // devolução (sobra que volta da frente) e saída avulsa com motivo
  devolucao: (obra: string, itens: EscritaItem[], chave: string, extra: { motivo: string; condicao: string; eap?: EapRef | null }) =>
    req<WriteResp>(`/api/estoque/devolucao?obra=${obra}`, {
      method: 'POST', headers: { 'Idempotency-Key': chave }, body: JSON.stringify({ itens, ...extra }),
    }),
  saida: (obra: string, itens: EscritaItem[], chave: string, motivo: string) =>
    req<WriteResp>(`/api/estoque/saida?obra=${obra}`, {
      method: 'POST', headers: { 'Idempotency-Key': chave }, body: JSON.stringify({ itens, motivo }),
    }),

  // ---- 08 · EAP no consumo
  eapLista: (obra: string) => req<EapLista>(`/api/eap/lista?obra=${obra}`),
  eapInsumo: (obra: string, resourceId: string, detailId?: number | null, trademarkId?: number | null) =>
    req<{ orcadas: EapOrcada[] }>(`/api/eap/insumo?obra=${obra}&resource_id=${resourceId}` +
      (detailId != null ? `&detail_id=${detailId}` : '') + (trademarkId != null ? `&trademark_id=${trademarkId}` : '')),
  consumoOrcado: (obra: string) => req<ConsumoOrcado>(`/api/eap/consumo-orcado?obra=${obra}`),

  // ---- 09 · transferências e desmobilização
  transfObras: () => req<Obra[]>(`/api/transferencias/obras`),
  transferencias: (obra: string) => req<{ transferencias: Transferencia[] }>(`/api/transferencias?obra=${obra}`),
  transfCriar: (obra: string, destino: string, itens: EscritaItem[], chave: string, obs?: string) =>
    req<{ transferencia: Transferencia; repetida: boolean }>(`/api/transferencias?obra=${obra}`, {
      method: 'POST', headers: { 'Idempotency-Key': chave }, body: JSON.stringify({ destino, itens, obs: obs || null }),
    }),
  transfReceber: (obra: string, id: number, itens: { idx: number; qtd_recebida: number }[], obs?: string) =>
    req<{ transferencia: Transferencia }>(`/api/transferencias/${id}/receber?obra=${obra}`, {
      method: 'POST', body: JSON.stringify({ itens, obs: obs || null }),
    }),
  transfCancelar: (obra: string, id: number) =>
    req<{ transferencia: Transferencia }>(`/api/transferencias/${id}/cancelar?obra=${obra}`, { method: 'POST' }),
  transfSeguir: (obra: string, id: number) =>
    req<{ transferencia: Transferencia }>(`/api/transferencias/${id}/seguir?obra=${obra}`, { method: 'POST' }),
  desmobilizacao: (obra: string) => req<Desmobilizacao>(`/api/desmobilizacao?obra=${obra}`),
  desmobExecutar: (obra: string, decisoes: DecisaoDesmob[], chave: string) =>
    req<{ ok: boolean; resultados: { grupo: string; ok: boolean; n_itens: number; mensagem: string }[] }>(
      `/api/desmobilizacao/executar?obra=${obra}`, {
        method: 'POST', headers: { 'Idempotency-Key': chave }, body: JSON.stringify({ decisoes }),
      }),

  // ---- 10 · requisição com reserva e inventário cíclico
  requisicoes: (obra: string, abertas = true) =>
    req<{ requisicoes: RequisicaoObra[]; papel: string }>(`/api/requisicoes?obra=${obra}&abertas=${abertas}`),
  reqCriar: (obra: string, dados: {
    itens: EscritaItem[]; eap: EapRef | null; terceiro?: string; solicitante?: string; necessario_em?: string; obs?: string
  }) => req<{ requisicao: RequisicaoObra }>(`/api/requisicoes?obra=${obra}`, { method: 'POST', body: JSON.stringify(dados) }),
  reqAcao: (obra: string, id: number, acao: 'aprovar' | 'reprovar' | 'separar' | 'entregar' | 'cancelar',
    extra?: { obs?: string; entregas?: { idx: number; quantidade: number }[] }) =>
    req<{ requisicao: RequisicaoObra; baixa?: WriteResp }>(`/api/requisicoes/${id}/acao?obra=${obra}`, {
      method: 'POST', body: JSON.stringify({ acao, ...extra }),
    }),
  invPlano: (obra: string) => req<PlanoInventario>(`/api/inventario/plano?obra=${obra}`),
  contagens: (obra: string) => req<{ contagens: Contagem[]; papel: string }>(`/api/inventario/contagens?obra=${obra}`),
  contagemCriar: (obra: string, dados: { classe?: 'A' | 'B' | 'C' | null; resource_ids?: string[]; max_itens?: number }) =>
    req<{ contagem: Contagem }>(`/api/inventario/contagens?obra=${obra}`, { method: 'POST', body: JSON.stringify(dados) }),
  contagemEnviar: (obra: string, id: number, contagens: { idx: number; qtd: number }[], obs?: string) =>
    req<{ contagem: Contagem }>(`/api/inventario/contagens/${id}/enviar?obra=${obra}`, {
      method: 'POST', body: JSON.stringify({ contagens, obs: obs || null }),
    }),
  contagemAjustar: (obra: string, id: number, motivo: string, idxs?: number[]) =>
    req<{ contagem: Contagem }>(`/api/inventario/contagens/${id}/ajustar?obra=${obra}`, {
      method: 'POST', body: JSON.stringify({ motivo, idxs: idxs ?? null }),
    }),
  contagemEncerrar: (obra: string, id: number) =>
    req<{ contagem: Contagem }>(`/api/inventario/contagens/${id}/encerrar?obra=${obra}`, { method: 'POST' }),
}

// ---- 08 · EAP (subetapa do orçamento onde o material é aplicado)
export interface EapRef { uc_id: number | null; codigo: string; descricao: string | null }
export interface EapSubetapa extends EapRef {
  uc_nome: string | null; unidade: string | null; grupo: string | null; pai: string | null
}
export interface EapLista { tem_mapa: boolean; subetapas: EapSubetapa[]; recentes: EapRef[] }
export interface EapOrcada extends EapRef { uc_nome: string | null; qtd_orcada: number | null }
export interface ConsumoOrcadoItem {
  resource_id: string; detail_id: number | null; descricao: string; unidade: string | null
  qtd_consumida: number; qtd_orcada: number | null; pct: number | null; valor: number; n_baixas: number
  status: 'ok' | 'atencao' | 'acima' | 'sem_orcamento'
}
export interface ConsumoOrcadoSub {
  uc_id: number | null; uc_nome: string | null; codigo: string; descricao: string
  valor_consumido: number; n_acima: number; n_sem_orcamento: number; itens: ConsumoOrcadoItem[]
}
export interface ConsumoOrcado {
  hoje: string; desde: string | null
  kpis: { n_baixas_com_eap: number; n_baixas_sem_eap: number; pct_com_eap: number; n_subetapas: number; n_itens_acima: number; valor_consumido: number }
  subetapas: ConsumoOrcadoSub[]
}

// ---- 09 · transferência entre obras
export interface TransfItem {
  resource_id: string; descricao: string | null; unidade: string | null; variante?: string | null
  detail_id?: number | null; trademark_id?: number | null
  quantidade: number; qtd_enviada: number; qtd_recebida: number | null; preco_unit: number
}
export type TransfStatus = 'enviando' | 'falhou' | 'em_transito' | 'recebendo' | 'recebida' | 'recebida_divergencia' | 'cancelando' | 'cancelada'
export interface Transferencia {
  id: number; criado_em: string; criado_por: string; origem: string; destino: string
  origem_nome?: string; destino_nome?: string; sentido?: 'saida' | 'entrada'
  status: TransfStatus; itens: TransfItem[]; obs: string | null; chave: string | null
  recebido_por: string | null; recebido_em: string | null; obs_recebimento: string | null; erro: string | null
}
export interface DesmobItem {
  resource_id: string; detail_id: number | null; trademark_id: number | null; descricao: string; variante: string | null
  unidade: string | null; saldo: number; custo_unit: number; valor: number; sugestao: string | null
  consumo_outras: { obra: string; nome: string; consumo_dia: number }[]
}
export interface Desmobilizacao { itens: DesmobItem[]; valor_total: number; motivos: string[]; obras: Obra[] }
export interface DecisaoDesmob {
  resource_id: string; detail_id: number | null; trademark_id: number | null; descricao: string
  variante: string | null; unidade: string | null; quantidade: number; destino: string
}

// ---- 10 · requisição da obra (com reserva) e inventário
export type ReqStatus = 'solicitada' | 'aprovada' | 'reprovada' | 'separada' | 'entregando' | 'parcial' | 'entregue' | 'cancelada'
export interface ReqItemObra {
  resource_id: string; descricao: string | null; unidade: string | null; variante?: string | null
  detail_id?: number | null; trademark_id?: number | null; quantidade: number; qtd_entregue: number
}
export interface RequisicaoObra {
  id: number; criado_em: string; obra: string; criado_por: string; solicitante: string | null; terceiro: string | null
  eap_uc_id: number | null; eap_codigo: string | null; eap_descricao: string | null
  necessario_em: string | null; obs: string | null; status: ReqStatus; itens: ReqItemObra[]
  aprovado_por: string | null; aprov_obs: string | null; erro: string | null; n_entregas: number
  entrega_pendente?: { n: number; itens: { idx: number; quantidade: number }[] } | null
}
export interface PlanoItem {
  resource_id: string; descricao: string; unidade: string; abc: 'A' | 'B' | 'C'; valor_saldo: number
  ultima_contagem: string | null; proxima: string; dias_atraso: number; vencido: boolean
}
export interface PlanoInventario {
  hoje: string; itens: PlanoItem[]
  resumo: Record<'A' | 'B' | 'C', { n_itens: number; n_vencidos: number; n_nunca: number; periodicidade_dias: number }>
  acuracidade: { n_itens: number; pct_exatos: number | null }
  tolerancia: { valor: number; pct: number }
}
export interface ContagemItem {
  resource_id: string; detail_id: number | null; trademark_id: number | null; descricao: string; variante: string | null
  unidade: string | null; abc: string; custo_unit: number; qtd_contada: number | null
  saldo_sistema?: number; divergencia?: number; valor_divergencia?: number; precisa_aprovacao?: boolean; ajustar?: boolean
}
export type ContagemStatus = 'aberta' | 'contada' | 'conferida' | 'ajustando' | 'ajustada' | 'encerrada'
export interface Contagem {
  id: number; criado_em: string; obra: string; criado_por: string; classe: string | null
  status: ContagemStatus; itens: ContagemItem[]; contado_por: string | null; contado_em: string | null
  motivo: string | null; erro: string | null
}

export interface EscritaItem {
  resource_id: string; quantidade: number; unidade?: string; descricao?: string
  detail_id?: number | null; trademark_id?: number | null
  variante?: string; embalagem?: string; fator_embalagem?: number
}

export interface Variante {
  detail_id: number | null; detail_desc: string
  trademark_id: number | null; trademark_desc: string
  saldo: number; unidade: string
}

export interface Embalagem {
  id: string; resource_id: string; nome: string; fator: number; unidade?: string | null
}
export interface WriteResp {
  ok: boolean; modo?: string; auditoria_ids: number[]
  repetida?: boolean        // a cesta já tinha sido gravada (resposta anterior perdida)
  aviso?: string | null     // gravado no Sienge, mas algo secundário falhou
}

// chave de idempotência de uma cesta (uma por cesta; renova quando a cesta muda)
export function novaChave(): string {
  const c = globalThis.crypto
  if (c && 'randomUUID' in c) return c.randomUUID()
  return `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

export const MOTIVOS_SAIDA: Record<string, string> = {
  perda: 'Perda', avaria: 'Avaria', devolucao_fornecedor: 'Devolução ao fornecedor',
  venda: 'Venda', doacao: 'Doação', outro: 'Outro',
}
// rótulo curto das operações gravadas pelo app (Histórico)
export const OP_LABEL: Record<string, string> = {
  baixa: 'baixa', entrada: 'entrada', estorno: 'estorno', devolucao: 'devolução', saida: 'saída',
  transf_saida: 'transf. saída', transf_entrada: 'transf. entrada', transf_retorno: 'transf. volta',
  ajuste_mais: 'ajuste +', ajuste_menos: 'ajuste −',
}

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
