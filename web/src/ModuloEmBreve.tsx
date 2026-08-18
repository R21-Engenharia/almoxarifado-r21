export interface SpecModulo {
  titulo: string
  subtitulo: string
  pergunta: string
  analisa: string[]
  decisao: string
  requer: string
}

export const MODULOS: Record<string, SpecModulo> = {
  recebimentos: {
    titulo: 'Recebimentos',
    subtitulo: 'Cada entrega acompanhada do pedido à nota.',
    pergunta: 'O que entrou, no prazo, e o que ainda está pendente ou atrasado?',
    analisa: [
      'Valor recebido no período e valor total recebido',
      'Entregas no prazo, em percentual',
      'Recebimentos por tipo: pedido, contrato, devolução, transferência',
      'Cronograma de entregas com atrasadas e próximas dos 7 dias',
      'Status dos pedidos e avaliação de recebimento (nota 0 a 5)',
    ],
    decisao: 'Cobrar o fornecedor com dado, conciliar a nota fiscal e nunca ser surpreendido por uma entrega atrasada.',
    requer: 'integração de pedidos de compra e notas fiscais do Sienge',
  },
  consumo: {
    titulo: 'Consumo de materiais',
    subtitulo: 'Onde, com quem e em quê o material é gasto.',
    pergunta: 'Para onde está indo o meu material, e o meu estoque atual dura quanto tempo?',
    analisa: [
      'Consumo no período, com comparação e tendência',
      'Saldo de estoque traduzido em meses de cobertura',
      'Consumo por local, funcionário, categoria e material',
      'Requisições atendidas e movimentação de material',
      'Alerta de estoque mínimo e custo de reposição',
    ],
    decisao: 'Enxergar desperdício por frente e dimensionar a compra pelo consumo real, não pela média grosseira.',
    requer: 'apropriação por subetapa na baixa (para consumo por local/funcionário)',
  },
  suprimentos: {
    titulo: 'Suprimentos (MRP)',
    subtitulo: 'Antecipe a ruptura antes de a frente parar.',
    pergunta: 'O que vai me faltar nos próximos dias e quais frentes de obra isso trava?',
    analisa: [
      'Insumos em risco no horizonte de 7 a 120 dias',
      'Atividades do cronograma com restrição de material',
      'Saúde do abastecimento, de 0 a 100',
      'Capital em risco de falta e capital parado em excesso',
      'Ponto de pedido: até quando dá para comprar sem faltar',
    ],
    decisao: 'Comprar na hora certa, na quantidade certa, sem parar a obra e sem inflar o estoque.',
    requer: 'pedidos de compra + Forecast Engine (previsão de consumo)',
  },
  fornecedores: {
    titulo: 'Fornecedores',
    subtitulo: 'Compre de quem entrega.',
    pergunta: 'Em quem posso confiar minha próxima compra?',
    analisa: [
      'Total de fornecedores ativos e inativos',
      'Entregas no prazo (%), comparadas ao mês anterior',
      'Valor total de compras por fornecedor',
      'Qualidade dos produtos: taxa de aprovação nas inspeções',
      'Nota média de 0 a 5 e ranking de fornecedores',
    ],
    decisao: 'Negociar com quem tem histórico, homologar melhor e descredenciar quem atrasa e reprova.',
    requer: 'integração de compras e cadastro de fornecedores do Sienge',
  },
  equipamentos: {
    titulo: 'Equipamentos',
    subtitulo: 'O que está locado, onde e por quanto.',
    pergunta: 'Quais equipamentos estão na obra, ociosos ou custando mais do que deveriam?',
    analisa: [
      'Equipamentos por obra e status de uso',
      'Custo de locação por período',
      'Ociosidade e utilização',
      'Contratos e prazos de devolução',
    ],
    decisao: 'Devolver o que está parado e renegociar locação cara.',
    requer: 'verificar exposição de equipamentos/locação na API do Sienge',
  },
}

export default function ModuloEmBreve({ spec }: { spec: SpecModulo }) {
  return (
    <div className="dash">
      <div className="kpi-row">
        {[0, 1, 2, 3].map(i => (
          <div className="kpi-card skeleton" key={i}>
            <div className="kpi-top"><span className="kpi-rot">—</span></div>
            <div className="kpi-big sk-bar" />
            <div className="kpi-hint sk-bar sk-sm" />
          </div>
        ))}
      </div>

      <div className="embreve">
        <div className="embreve-badge">Em breve</div>
        <h2>{spec.titulo}</h2>
        <p className="embreve-sub">{spec.subtitulo}</p>
        <blockquote>“{spec.pergunta}”</blockquote>
        <div className="embreve-cols">
          <div>
            <div className="embreve-label">O que você vai analisar</div>
            <ul>{spec.analisa.map((a, i) => <li key={i}>{a}</li>)}</ul>
          </div>
          <div className="embreve-decisao">
            <div className="embreve-label green">Decisão que habilita</div>
            <p>{spec.decisao}</p>
            <div className="embreve-requer">Requer: {spec.requer}</div>
          </div>
        </div>
      </div>
    </div>
  )
}
