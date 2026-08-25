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
