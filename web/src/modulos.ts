// Metadados dos módulos do BOX21 — usado no menu e na tela de permissões.
export interface ModuloInfo { id: string; nome: string; grupo: 'Dashboards' | 'Almoxarifado' }

export const MODULOS: ModuloInfo[] = [
  { id: 'financeiro', nome: 'Financeiro', grupo: 'Dashboards' },
  { id: 'posicao', nome: 'Posição por grupo', grupo: 'Dashboards' },
  { id: 'recebimentos', nome: 'Recebimentos', grupo: 'Dashboards' },
  { id: 'consumo', nome: 'Consumo', grupo: 'Dashboards' },
  { id: 'suprimentos', nome: 'Suprimentos', grupo: 'Dashboards' },
  { id: 'fornecedores', nome: 'Fornecedores', grupo: 'Dashboards' },
  { id: 'equipamentos', nome: 'Equipamentos', grupo: 'Dashboards' },
  { id: 'aprovacao', nome: 'Aprovações', grupo: 'Almoxarifado' },
  { id: 'requisicao', nome: 'Requisição', grupo: 'Almoxarifado' },
  { id: 'estoque', nome: 'Estoque', grupo: 'Almoxarifado' },
  { id: 'operar', nome: 'Operar', grupo: 'Almoxarifado' },
  { id: 'historico', nome: 'Histórico', grupo: 'Almoxarifado' },
]

// pode ver o módulo? (lista vazia = acesso a todos)
export function podeVer(modulos: string[] | undefined, id: string): boolean {
  return !modulos || modulos.length === 0 || modulos.includes(id)
}

// ---- perfis prontos (presets) — preenchem as permissões de uma vez ----
export interface PerfilPreset {
  id: string; nome: string; descricao: string
  role: string; tipo: string; modulos: string[]
  operar: boolean; gerar_plano: boolean; gerenciar_usuarios: boolean
}

const TODOS = MODULOS.map(m => m.id)

export const PERFIS: PerfilPreset[] = [
  {
    id: 'engenheiro', nome: 'Engenheiro de obra', tipo: 'Geral', role: 'engenheiro',
    descricao: 'Visão geral da obra + 1ª aprovação. Não opera o almoxarifado.',
    modulos: TODOS.filter(m => m !== 'operar'),
    operar: false, gerar_plano: true, gerenciar_usuarios: false,
  },
  {
    id: 'almoxarife', nome: 'Almoxarife', tipo: 'Geral', role: 'user',
    descricao: 'Opera o almoxarifado: entrada, baixa, requisição, conferência.',
    modulos: ['posicao', 'recebimentos', 'equipamentos', 'requisicao', 'estoque', 'operar', 'historico'],
    operar: true, gerar_plano: false, gerenciar_usuarios: false,
  },
  {
    id: 'planejamento', nome: 'Planejamento', tipo: 'Geral', role: 'planejamento',
    descricao: 'MRP, compras e 2ª aprovação. Gera plano de compra.',
    modulos: ['financeiro', 'posicao', 'recebimentos', 'consumo', 'suprimentos', 'fornecedores', 'aprovacao', 'estoque', 'historico'],
    operar: false, gerar_plano: true, gerenciar_usuarios: false,
  },
  {
    id: 'diretoria', nome: 'Diretoria / Leitura', tipo: 'Geral', role: 'user',
    descricao: 'Só os painéis de gestão, sem ações de escrita.',
    modulos: ['financeiro', 'posicao', 'consumo', 'fornecedores', 'recebimentos', 'suprimentos'],
    operar: false, gerar_plano: false, gerenciar_usuarios: false,
  },
  {
    id: 'admin', nome: 'Administrador', tipo: 'Administrador', role: 'admin',
    descricao: 'Acesso total, inclusive gestão de usuários.',
    modulos: [], operar: true, gerar_plano: true, gerenciar_usuarios: true,
  },
]
