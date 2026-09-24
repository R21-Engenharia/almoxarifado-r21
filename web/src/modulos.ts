// Metadados dos módulos do BOX21 — usado no menu e na gestão de usuários.
export interface ModuloInfo {
  id: string; nome: string; grupo: 'Dashboards' | 'Almoxarifado'
  desc: string            // o que a pessoa faz nesta tela (linguagem simples)
  semGravar?: string      // como a tela fica para quem NÃO grava no Sienge
}

export const MODULOS: ModuloInfo[] = [
  { id: 'financeiro', nome: 'Financeiro', grupo: 'Dashboards', desc: 'capital em estoque e fluxo de materiais' },
  { id: 'posicao', nome: 'Posição por grupo', grupo: 'Dashboards', desc: 'estoque consolidado por grupo de insumo' },
  { id: 'recebimentos', nome: 'Recebimentos', grupo: 'Dashboards', desc: 'entregas, pedidos e notas' },
  { id: 'consumo', nome: 'Consumo', grupo: 'Dashboards', desc: 'consumo de materiais e consumo × orçado' },
  { id: 'suprimentos', nome: 'Suprimentos', grupo: 'Dashboards', desc: 'MRP: o que comprar e quando' },
  { id: 'fornecedores', nome: 'Fornecedores', grupo: 'Dashboards', desc: 'prazo e desempenho dos fornecedores' },
  { id: 'equipamentos', nome: 'Equipamentos', grupo: 'Dashboards', desc: 'locação e ociosidade de equipamentos' },
  { id: 'aprovacao', nome: 'Aprovações', grupo: 'Almoxarifado', desc: 'solicitações de compra do Sienge' },
  { id: 'requisicao', nome: 'Requisição', grupo: 'Almoxarifado', desc: 'retirada no balcão e pedidos da obra', semGravar: 'faz e acompanha pedidos, sem dar baixa' },
  { id: 'estoque', nome: 'Estoque', grupo: 'Almoxarifado', desc: 'riscos de ruptura e curva ABC' },
  { id: 'operar', nome: 'Operar', grupo: 'Almoxarifado', desc: 'baixa, entrada, devolução e saída', semGravar: 'NÃO consegue gravar nada aqui' },
  { id: 'transferencias', nome: 'Transferências', grupo: 'Almoxarifado', desc: 'mandar/receber material entre obras', semGravar: 'só consulta' },
  { id: 'inventario', nome: 'Inventário', grupo: 'Almoxarifado', desc: 'contagem cíclica e ajuste', semGravar: 'só consulta o plano e as contagens' },
  { id: 'historico', nome: 'Histórico', grupo: 'Almoxarifado', desc: 'movimentos gravados pelo app' },
]
export const TODOS_MODULOS = MODULOS.map(m => m.id)

// pode ver o módulo? (lista vazia = acesso a todos — só administrador fica assim)
export function podeVer(modulos: string[] | undefined, id: string): boolean {
  return !modulos || modulos.length === 0 || modulos.includes(id)
}

// ---- papel na dupla aprovação de compras (coluna role) ----
export const PAPEIS: { v: string; l: string; desc: string }[] = [
  { v: 'user', l: 'Não aprova', desc: 'não participa das aprovações' },
  { v: 'engenheiro', l: 'Engenheiro', desc: '1ª aprovação das compras e aprova os pedidos de material da obra' },
  { v: 'planejamento', l: 'Planejamento', desc: '2ª aprovação das compras (autoriza no Sienge)' },
  { v: 'admin', l: 'Administrador', desc: 'faz tudo, inclusive as duas aprovações' },
]

// ---- perfis de acesso: o ponto de partida de toda conta ----
export interface PerfilPreset {
  id: string; nome: string; descricao: string
  role: string; tipo: string; modulos: string[]
  operar: boolean; gerar_plano: boolean; gerenciar_usuarios: boolean
}

export const PERFIS: PerfilPreset[] = [
  {
    id: 'almoxarife', nome: 'Almoxarife', tipo: 'Geral', role: 'user',
    descricao: 'Opera o almoxarifado da obra: retirada, entrada, devolução, transferência e inventário.',
    modulos: ['posicao', 'recebimentos', 'equipamentos', 'requisicao', 'estoque', 'operar', 'transferencias', 'inventario', 'historico'],
    operar: true, gerar_plano: false, gerenciar_usuarios: false,
  },
  {
    id: 'engenheiro', nome: 'Engenheiro de obra', tipo: 'Geral', role: 'engenheiro',
    descricao: 'Acompanha a obra, faz a 1ª aprovação das compras e aprova os pedidos de material. Não grava no Sienge.',
    modulos: TODOS_MODULOS.filter(m => m !== 'operar'),
    operar: false, gerar_plano: true, gerenciar_usuarios: false,
  },
  {
    id: 'planejamento', nome: 'Planejamento', tipo: 'Geral', role: 'planejamento',
    descricao: 'MRP, compras e 2ª aprovação (autoriza no Sienge). Gera plano de compra.',
    modulos: ['financeiro', 'posicao', 'recebimentos', 'consumo', 'suprimentos', 'fornecedores', 'aprovacao', 'estoque', 'transferencias', 'inventario', 'historico'],
    operar: false, gerar_plano: true, gerenciar_usuarios: false,
  },
  {
    id: 'diretoria', nome: 'Diretoria / Leitura', tipo: 'Geral', role: 'user',
    descricao: 'Só consulta os painéis de gestão. Não grava nada.',
    modulos: ['financeiro', 'posicao', 'consumo', 'fornecedores', 'recebimentos', 'suprimentos'],
    operar: false, gerar_plano: false, gerenciar_usuarios: false,
  },
  {
    id: 'admin', nome: 'Administrador', tipo: 'Administrador', role: 'admin',
    descricao: 'Acesso total, inclusive gestão de usuários e estorno.',
    modulos: [], operar: true, gerar_plano: true, gerenciar_usuarios: true,
  },
]
