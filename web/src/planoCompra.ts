// Plano de Compra do MRP — camada de dados (Supabase, client-side).
// A cesta selecionada no Suprimentos é consolidada por fornecedor e persistida
// como um plano por fornecedor (a decisão que o comprador executa).
import { supabase } from './supabase'

export interface PlanoItem {
  resource_id: string; descricao: string; unidade: string
  quantidade: number; custo_unit: number; valor: number
}
export interface Plano {
  id: string; obra: string; criado_em: string; criado_por: string | null
  fornecedor: string | null; status: 'aberto' | 'pedido' | 'cancelado'
  n_itens: number; valor_total: number
  itens?: PlanoItem[]
}

// item que entra na cesta (vem do MRP)
export interface CestaItem {
  resource_id: string; descricao: string; unidade: string
  fornecedor: string | null; quantidade: number; custo_unit: number
}

async function usuarioAtual(): Promise<string> {
  if (!supabase) return 'dev'
  const { data } = await supabase.auth.getUser()
  return data.user?.email || 'app'
}

// resource_ids desta obra que já estão em algum plano aberto (para marcar no MRP)
export async function resourcesNoPlano(obra: string): Promise<Set<string>> {
  if (!supabase) return new Set()
  const { data: planos } = await supabase.from('plano_compra').select('id').eq('obra', obra).eq('status', 'aberto')
  const ids = (planos || []).map(p => p.id)
  if (!ids.length) return new Set()
  const { data: itens } = await supabase.from('plano_compra_itens').select('resource_id').in('plano_id', ids)
  return new Set((itens || []).map(i => i.resource_id as string))
}

export async function listarPlanos(obra: string): Promise<Plano[]> {
  if (!supabase) return []
  const { data: planos, error } = await supabase.from('plano_compra').select('*')
    .eq('obra', obra).neq('status', 'cancelado').order('criado_em', { ascending: false })
  if (error) throw new Error(error.message)
  const lista = (planos || []) as Plano[]
  if (!lista.length) return []
  const { data: itens } = await supabase.from('plano_compra_itens').select('*').in('plano_id', lista.map(p => p.id))
  const porPlano: Record<string, PlanoItem[]> = {}
  for (const it of (itens || []) as (PlanoItem & { plano_id: string })[]) {
    (porPlano[it.plano_id] ||= []).push(it)
  }
  return lista.map(p => ({ ...p, itens: porPlano[p.id] || [] }))
}

// consolida a cesta por fornecedor e grava um plano por fornecedor
export async function gerarPlanos(obra: string, cesta: CestaItem[]): Promise<number> {
  if (!supabase) throw new Error('Supabase indisponível')
  const criado_por = await usuarioAtual()
  const porForn: Record<string, CestaItem[]> = {}
  for (const c of cesta) {
    const key = c.fornecedor || 'Sem fornecedor definido'
    ;(porForn[key] ||= []).push(c)
  }
  let n = 0
  for (const [fornecedor, itens] of Object.entries(porForn)) {
    const valor_total = itens.reduce((a, c) => a + c.quantidade * c.custo_unit, 0)
    const { data: plano, error } = await supabase.from('plano_compra')
      .insert({ obra, criado_por, fornecedor, n_itens: itens.length, valor_total: round(valor_total) })
      .select().single()
    if (error) throw new Error(error.message)
    const rows = itens.map(c => ({
      plano_id: plano.id, resource_id: c.resource_id, descricao: c.descricao, unidade: c.unidade,
      quantidade: c.quantidade, custo_unit: c.custo_unit, valor: round(c.quantidade * c.custo_unit),
    }))
    const { error: e2 } = await supabase.from('plano_compra_itens').insert(rows)
    if (e2) throw new Error(e2.message)
    n++
  }
  return n
}

export async function marcarPedido(planoId: string): Promise<void> {
  if (!supabase) return
  await supabase.from('plano_compra').update({ status: 'pedido' }).eq('id', planoId)
}
export async function cancelarPlano(planoId: string): Promise<void> {
  if (!supabase) return
  await supabase.from('plano_compra').update({ status: 'cancelado' }).eq('id', planoId)
}

const round = (v: number) => Math.round(v * 100) / 100
