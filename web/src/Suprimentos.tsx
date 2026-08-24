import { useEffect, useMemo, useState } from 'react'
import { api, brl, num, type SuprimentosData, type SupItem } from './api'
import Loader from './Loader'

type Filtro = 'comprar_agora' | 'esta_semana' | 'programar' | 'todos'

const URG_LABEL: Record<SupItem['urgencia'], string> = {
  comprar_agora: 'Comprar agora', esta_semana: 'Esta semana', programar: 'Programar', ok: 'Ok',
}
const URG_TONE: Record<SupItem['urgencia'], string> = {
  comprar_agora: 'ruptura', esta_semana: 'critico', programar: 'baixo', ok: 'ok',
}
const data = (s: string | null) => s ? new Date(s + 'T00:00:00').toLocaleDateString('pt-BR') : '—'

export default function Suprimentos({ obra }: { obra: string }) {
  const [d, setD] = useState<SuprimentosData | null>(null)
  const [err, setErr] = useState('')
  const [f, setF] = useState<Filtro>('comprar_agora')

  useEffect(() => {
    setD(null); setErr('')
    api.suprimentos(obra).then(setD).catch(e => setErr(e instanceof Error ? e.message : String(e)))
  }, [obra])

  const itens = useMemo(() => {
    if (!d) return []
    if (f === 'todos') return d.itens
    if (f === 'programar') return d.itens.filter(i => i.urgencia === 'programar' || i.urgencia === 'ok')
    return d.itens.filter(i => i.urgencia === f)
  }, [d, f])

  if (err) return <div className="err">Falha ao carregar: {err}</div>
  if (!d) return <Loader label="o MRP" dica="Projetando consumo, ponto de pedido e trade-off de capital…" />
  const k = d.kpis

  return (
    <div className="dash">
      <div className="kpi-row">
        <Kpi rot="Comprar agora" v={num(k.n_comprar_agora)} hint={`${brl(k.valor_comprar_agora)} em compra`} tone={k.n_comprar_agora > 0 ? 'bad' : ''} />
        <Kpi rot="Comprar esta semana" v={num(k.n_esta_semana)} hint={`${brl(k.valor_esta_semana)} em compra`} />
        <Kpi rot="Exposição se parar" v={`${brl(k.exposicao_parada_dia)}`} hint="por dia, nos itens em ruptura" tone={k.exposicao_parada_dia > 0 ? 'bad' : ''} />
        <Kpi rot="Capital que fica livre" v={`${brl(k.economia_selic_mes)}/mês`} hint={`em Selic, comprando no ponto certo (${d.parametros.selic_anual_pct}% a.a.)`} />
      </div>

      <div className="chart-card">
        <div className="chart-head">
          <div><h3>Suprimentos · MRP preditivo</h3>
            <span className="chart-sub">
              Até que dia dá pra comprar cada insumo sem parar a obra e sem imobilizar capital à toa? ·
              estoque de segurança ajustado pela confiabilidade do fornecedor
            </span></div>
        </div>
        <div className="chips">
          <button className={f === 'comprar_agora' ? 'on' : ''} onClick={() => setF('comprar_agora')}>Comprar agora ({d.itens.filter(i => i.urgencia === 'comprar_agora').length})</button>
          <button className={f === 'esta_semana' ? 'on' : ''} onClick={() => setF('esta_semana')}>Esta semana ({d.itens.filter(i => i.urgencia === 'esta_semana').length})</button>
          <button className={f === 'programar' ? 'on' : ''} onClick={() => setF('programar')}>Programar ({d.itens.filter(i => i.urgencia === 'programar' || i.urgencia === 'ok').length})</button>
          <button className={f === 'todos' ? 'on' : ''} onClick={() => setF('todos')}>Todos ({d.itens.length})</button>
        </div>

        <div className="tbl-wrap">
          <table className="tbl sup-tbl">
            <thead><tr>
              <th>Insumo</th><th>Cobertura</th><th>Fornecedor · proteção</th>
              <th>Comprar até</th><th className="r">Quantidade</th><th className="r">Risco/dia</th>
            </tr></thead>
            <tbody>
              {itens.map(i => (
                <tr key={i.resource_id}>
                  <td>
                    <div className="desc" style={{ fontSize: 13 }}>{i.descricao}</div>
                    <div className="meta">{i.macro || '—'} · #{i.resource_id}</div>
                  </td>
                  <td>
                    <div className={i.cobertura_dias <= 0 ? 'sup-rup' : ''}>{num(i.cobertura_dias, 0)} d</div>
                    <div className="meta">saldo {num(i.saldo, 1)} {i.unidade}</div>
                  </td>
                  <td>
                    <div className="desc" style={{ fontSize: 12.5 }}>{i.fornecedor || '—'}</div>
                    <div className="meta">lead {num(i.lead_dias, 0)}d + seg. {i.ss_dias}d ·
                      <span style={{ color: i.pct_no_prazo >= 90 ? 'var(--ok)' : i.pct_no_prazo >= 75 ? 'var(--baixo)' : 'var(--ruptura)' }}> {num(i.pct_no_prazo, 0)}% no prazo</span></div>
                  </td>
                  <td>
                    <span className={`pill ${URG_TONE[i.urgencia]}`}>{URG_LABEL[i.urgencia]}</span>
                    <div className="meta" style={{ marginTop: 3 }}>
                      {i.dias_ate_pedir <= 0 ? `há ${num(-i.dias_ate_pedir, 0)} dias` : `${data(i.data_limite)} · em ${num(i.dias_ate_pedir, 0)}d`}</div>
                  </td>
                  <td className="r">
                    <b>{num(i.qtd_sugerida, 1)}</b> <span className="u">{i.unidade}</span>
                    <div className="meta">{brl(i.valor_sugerido)}</div>
                  </td>
                  <td className="r">
                    <span style={i.exposicao_parada_dia > 0 ? { color: 'var(--ruptura)', fontWeight: 700 } : undefined}>{brl(i.exposicao_parada_dia)}</span>
                    <div className="meta">preso: {brl(i.custo_antecipar_dia)}/d</div>
                  </td>
                </tr>
              ))}
              {itens.length === 0 && <tr><td colSpan={6}><div className="empty">Nenhum insumo neste grupo. 👍</div></td></tr>}
            </tbody>
          </table>
        </div>
        <div className="meta" style={{ marginTop: 10 }}>
          <b>Como lê:</b> "Comprar até" é o último dia para pedir sem arriscar parar a obra (já desconta o lead time do fornecedor + estoque de segurança).
          <b> Risco/dia</b> é o quanto o consumo desse insumo movimenta por dia (exposição se faltar); <b>preso/dia</b> é o custo de oportunidade (Selic) de comprar antes da hora.
        </div>
      </div>
    </div>
  )
}

function Kpi({ rot, v, hint, tone }: { rot: string; v: string; hint?: string; tone?: string }) {
  return (
    <div className="kpi-card">
      <div className="kpi-rot">{rot}</div>
      <div className="kpi-big" style={tone === 'bad' && v !== '0' ? { color: 'var(--ruptura)' } : undefined}>{v}</div>
      {hint && <div className="kpi-hint">{hint}</div>}
    </div>
  )
}
