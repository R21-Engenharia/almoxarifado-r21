export interface SpecModulo {
  titulo: string
  subtitulo: string
  pergunta: string
  analisa: string[]
  decisao: string
  diferencial: string
  requer: string
}

// Conteúdo autoral R21 — pensado do ponto de vista de suprimentos/compras.
// A ideia não é repetir "dashboard bonito", é amarrar dado → decisão em R$,
// com ligações que um painel genérico não faz (ex.: atraso de fornecedor vira
// custo de estoque de segurança; prazo que vale é o da frente, não o do pedido).
export const MODULOS: Record<string, SpecModulo> = {
  recebimentos: {
    titulo: 'Recebimento & Conferência',
    subtitulo: 'O que chegou tem que bater com o pedido, com a nota e com o físico.',
    pergunta: 'O que chegou fecha com o pedido e a nota — e chegou antes de a frente precisar?',
    analisa: [
      'Conferência tripla na portaria: pedido × nota fiscal × quantidade física',
      'Lead time real por fornecedor e por insumo (vira insumo do MRP)',
      'Aderência à data de necessidade da obra — não só à data do pedido',
      'Reajuste silencioso: divergência de preço entre pedido e nota',
      'Fila de recebimentos pendentes/atrasados com o valor em risco',
    ],
    decisao: 'Barrar a divergência na portaria e não pagar nota que não bate com o físico.',
    diferencial: 'O prazo que importa não é o do pedido — é o dia em que a frente ia usar o material. Cruzamos os dois; um painel comum só olha o pedido.',
    requer: 'integração de pedidos de compra e notas fiscais do Sienge',
  },
  consumo: {
    titulo: 'Consumo & Desperdício',
    subtitulo: 'Para onde o material vai de verdade — e quanto disso vira perda.',
    pergunta: 'Qual frente está consumindo, no ritmo de quê, e quanto foge do orçado?',
    analisa: [
      'Consumo por subetapa/frente, capturado na baixa pelo nosso app',
      'Consumo real × orçado por insumo: índice de desperdício por frente',
      'Cobertura traduzida em dias de obra que o estoque atual aguenta',
      'Ritmo de consumo (tendência) para dimensionar a próxima compra',
      'Insumo saindo mais rápido que o previsto — alerta de perda/furto',
    ],
    decisao: 'Dimensionar a compra pelo ritmo real e cobrar a frente que estoura o orçado.',
    diferencial: 'Apropriação por subetapa que o próprio ERP não entrega — porque capturamos no momento da baixa, dentro do app, e guardamos do nosso lado.',
    requer: 'apropriação por subetapa na baixa (nosso app) + orçado por insumo',
  },
  suprimentos: {
    titulo: 'Suprimentos — MRP preditivo',
    subtitulo: 'Comprar na hora certa é otimizar dois custos opostos, não seguir estoque mínimo.',
    pergunta: 'Até que dia dá pra comprar cada insumo sem parar a obra e sem imobilizar capital à toa?',
    analisa: [
      'Projeção de consumo a partir do histórico de baixas + cronograma da obra',
      'Ponto de pedido por insumo, já com o lead time real do fornecedor',
      'Lista pronta: "comprar até o dia X, quantidade Y"',
      'Trade-off em R$: custo de faltar (obra parada) × custo de comprar cedo (capital + Selic)',
      'Estoque de segurança ajustado pela confiabilidade do fornecedor',
    ],
    decisao: 'Comprar no ponto ótimo entre risco de parar a obra e capital preso no galpão.',
    diferencial: 'Não é alerta de estoque mínimo. É otimização do trade-off faltar × imobilizar, medido em reais — e o buffer se ajusta a quem costuma atrasar.',
    requer: 'pedidos de compra + Forecast Engine + score de fornecedor',
  },
  fornecedores: {
    titulo: 'Fornecedores — scorecard',
    subtitulo: 'Quem entrega define quanto estoque extra você é obrigado a carregar.',
    pergunta: 'Em quem confio a próxima compra — e quanto de buffer cada fornecedor me custa?',
    analisa: [
      'OTIF: entregou no prazo E completo (não só "no prazo")',
      'Desvio de preço vs. histórico e vs. outras cotações',
      'Taxa de reprovação na conferência (qualidade real)',
      'Score de confiança 0–100 por fornecedor',
      'Impacto no estoque de segurança: quem atrasa, custa buffer',
    ],
    decisao: 'Homologar quem entrega, descredenciar quem atrasa e ajustar o buffer por confiança.',
    diferencial: 'Ligamos a reputação do fornecedor ao estoque de segurança do MRP: atraso deixa de ser reclamação e vira custo de capital medido em R$.',
    requer: 'compras + cadastro de fornecedores do Sienge',
  },
  equipamentos: {
    titulo: 'Equipamentos & Locação',
    subtitulo: 'Equipamento parado com contrato aberto é dinheiro sangrando em silêncio.',
    pergunta: 'Qual equipamento está locado e parado hoje — e quanto isso custa até a devolução?',
    analisa: [
      'Equipamentos locados por obra e status de uso',
      'Dias ocioso cruzado com o cronograma (locado, mas sem frente que o use)',
      'Custo de locação acumulado e projeção até a devolução',
      'Contrato vencendo e renovação cara em destaque',
    ],
    decisao: 'Devolver o que está parado hoje e renegociar locação longa e cara.',
    diferencial: 'Cruzamos a ociosidade com o cronograma — mostramos o que está parado de verdade, não o que está parado "no papel".',
    requer: 'verificar exposição de locação/equipamentos na API do Sienge',
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
        <div className="embreve-badge">Em construção</div>
        <h2>{spec.titulo}</h2>
        <p className="embreve-sub">{spec.subtitulo}</p>
        <blockquote>“{spec.pergunta}”</blockquote>
        <div className="embreve-cols">
          <div>
            <div className="embreve-label">O que você vai analisar</div>
            <ul>{spec.analisa.map((a, i) => <li key={i}>{a}</li>)}</ul>
          </div>
          <div>
            <div className="embreve-decisao">
              <div className="embreve-label green">Decisão que habilita</div>
              <p>{spec.decisao}</p>
            </div>
            <div className="embreve-dif">
              <div className="embreve-label">◆ Nosso diferencial</div>
              <p>{spec.diferencial}</p>
            </div>
            <div className="embreve-requer">Falta integrar: {spec.requer}</div>
          </div>
        </div>
      </div>
    </div>
  )
}
