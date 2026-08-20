import { supabase } from './supabase'

export type EquipStatus = 'almoxarifado' | 'campo' | 'manutencao' | 'emprestado' | 'inativo'
export type Conservacao = 'bom' | 'regular' | 'ruim'

export interface Equipamento {
  id: string
  codigo: string
  nome: string
  tipo: string | null
  marca_modelo: string | null
  foto_url: string | null
  obra: string | null
  status: EquipStatus
  conservacao: Conservacao
  localizacao: string | null
  responsavel: string | null
  prox_manutencao: string | null
  criado_em: string
  criado_por: string | null
}

export interface EquipMov {
  id: number
  equipamento_id: string
  quando: string
  tipo: string
  status: string | null
  conservacao: string | null
  localizacao: string | null
  responsavel: string | null
  usuario: string | null
  obs: string | null
}

export const STATUS_EQUIP: Record<EquipStatus, string> = {
  almoxarifado: 'No almoxarifado', campo: 'Em campo', manutencao: 'Em manutenção',
  emprestado: 'Emprestado', inativo: 'Inativo',
}
export const CONSERVACAO_LABEL: Record<Conservacao, string> = { bom: 'Bom', regular: 'Regular', ruim: 'Ruim' }

async function usuarioAtual(): Promise<string> {
  if (!supabase) return 'dev'
  const { data } = await supabase.auth.getUser()
  return data.user?.email || 'app'
}

export async function listar(obra: string): Promise<Equipamento[]> {
  if (!supabase) return []
  const { data, error } = await supabase.from('equipamentos').select('*')
    .eq('obra', obra).order('codigo')
  if (error) throw new Error(error.message)
  return (data || []) as Equipamento[]
}

export async function buscarPorId(id: string): Promise<Equipamento | null> {
  if (!supabase) return null
  const { data } = await supabase.from('equipamentos').select('*').eq('id', id).maybeSingle()
  return (data as Equipamento | null) ?? null
}

export async function criar(e: Partial<Equipamento> & { obra: string }): Promise<Equipamento> {
  if (!supabase) throw new Error('Supabase indisponível')
  const criado_por = await usuarioAtual()
  const { data, error } = await supabase.from('equipamentos')
    .insert({ ...e, criado_por }).select().single()
  if (error) throw new Error(error.message)
  await supabase.from('equip_movimentacoes').insert({
    equipamento_id: data.id, tipo: 'cadastro', status: data.status,
    conservacao: data.conservacao, localizacao: data.localizacao,
    responsavel: data.responsavel, usuario: criado_por, obs: 'Cadastro',
  })
  return data as Equipamento
}

export async function movimentar(id: string, patch: Partial<Equipamento>, mov: {
  tipo: string; obs?: string
}): Promise<void> {
  if (!supabase) throw new Error('Supabase indisponível')
  const usuario = await usuarioAtual()
  const { error } = await supabase.from('equipamentos').update(patch).eq('id', id)
  if (error) throw new Error(error.message)
  await supabase.from('equip_movimentacoes').insert({
    equipamento_id: id, tipo: mov.tipo, status: patch.status ?? null,
    conservacao: patch.conservacao ?? null, localizacao: patch.localizacao ?? null,
    responsavel: patch.responsavel ?? null, usuario, obs: mov.obs ?? null,
  })
}

export async function historico(id: string): Promise<EquipMov[]> {
  if (!supabase) return []
  const { data } = await supabase.from('equip_movimentacoes').select('*')
    .eq('equipamento_id', id).order('quando', { ascending: false })
  return (data || []) as EquipMov[]
}

export async function uploadFotoEquip(file: File): Promise<string> {
  if (!supabase) throw new Error('Supabase indisponível')
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
  const path = `${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage.from('equipamentos').upload(path, file, { contentType: file.type })
  if (error) throw new Error(error.message)
  const { data } = supabase.storage.from('equipamentos').getPublicUrl(path)
  return data.publicUrl
}
