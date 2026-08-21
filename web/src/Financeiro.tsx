import { useEffect, useMemo, useState } from 'react'
import { api, brl, num, type Financeiro as Fin, type FluxoMes } from './api'
import Loader from './Loader'

const MESES_PT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
function rotuloMes(k: string) {
  const [y, m] = k.split('-')
  return `${MESES_PT[parseInt(m) - 1]}/${y.slice(2)}`
}

export default function Financeiro({ obra }: { obra: string }) {
  const [d, setD] = useState<Fin | null>(null)
  const [err, setErr] = useState('')
  const [meses, setMeses] = useState(12)
  useEffect(() => {
    setD(null); setErr('')
    api.financeiro(obra, meses).then(setD).catch(e => setErr(e instanceof Error ? e.message : String(e)))
  }, [obra, meses])

  if (err) return <div className="err">Falha ao carregar: {err}</div>
  if (!d) return <Loader label="o financeiro" dica="Calculando capital em estoque e fluxo de materiais…" />
  const k = d.kpis
  const consumidoTone = k.estoque_consumido_pct < 20 ? 'baixo' : ''
  const ociosTone = k.ociosidade_media_dias >= 120 ? 'critico' : k.ociosidade_media_dias >= 60 ? 'baixo' : ''

  return (
    <div className="dash">
      <div className="kpi-row">
        <KpiCard rotulo="Ociosidade média" valor={`${num(k.ociosidade_media_dias)} dias`}
          tag={ociosTone === 'critico' ? 'Crítico' : ociosTone === 'baixo' ? 'Alerta' : 'OK'} tone={ociosTone}
          hint="Tempo médio sem movimentação dos itens em estoque" />
        <KpiCard rotulo="Estoque consumido" valor={`${num(k.estoque_consumido_pct, 2)}%`}
          tag={consumidoTone ? 'Baixo giro' : 'OK'} tone={consumidoTone}
          hint="Percentual do que foi recebido e já consumido" />
        <KpiCard rotulo="Capital ocioso" valor={brl(k.capital_ocioso)} tag="Custo de oportunidade" tone="critico"
          hint={`Em Selic (${num(k.selic_anual_pct, 1)}% a.a.): −${brl(k.selic_mensal)} / mês`} />
        <KpiCard rotulo="Capital em estoque" valor={brl(k.capital_em_estoque)}
          tag={`${num(k.n_insumos)} insumos`} tone=""
          hint={`${num(k.n_parados)} itens parados`} />
      </div>

      <FluxoChart fluxo={d.fluxo} meses={meses} setMeses={setMeses} />
    </div>
  )
}

function KpiCard({ rotulo, valor, tag, tone, hint }: {
  rotulo: string; valor: string; tag: string; tone: string; hint: string
}) {
  return (
    <div className="kpi-card">
      <div className="kpi-top">
        <span className="kpi-rot">{rotulo}</span>
        <span className={`kpi-tag ${tone}`}>{tag}</span>
      </div>
      <div className="kpi-big">{valor}</div>
      <div className="kpi-hint">{hint}</div>
    </div>
  )
}

function FluxoChart({ fluxo, meses, setMeses }: { fluxo: FluxoMes[]; meses: number; setMeses: (n: number) => void }) {
  const [modo, setModo] = useState<'fluxo' | 'saldo'>('fluxo')
  const view = useMemo(() => {
    if (modo === 'fluxo') return fluxo.map(f => ({ mes: f.mes, a: f.entradas, b: f.saidas }))
    let acc = 0
    return fluxo.map(f => { acc += f.entradas - f.saidas; return { mes: f.mes, a: acc, b: 0 } })
  }, [fluxo, modo])

  const W = 900, H = 320, padL = 64, padR = 16, padT = 16, padB = 40
  const maxV = Math.max(1, ...view.map(v => Math.max(v.a, v.b)))
  const n = view.length
  const groupW = (W - padL - padR) / n
  const barW = modo === 'fluxo' ? Math.min(18, groupW / 3) : Math.min(28, groupW / 2)
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / maxV)
  const gridVals = [0, 0.25, 0.5, 0.75, 1].map(t => maxV * t)
  const fmtMil = (v: number) => v >= 1e6 ? `${(v / 1e6).toFixed(1)}mi` : v >= 1e3 ? `${Math.round(v / 1e3)}mil` : `${Math.round(v)}`

  return (
    <div className="chart-card">
      <div className="chart-head">
        <div>
          <h3>Fluxo Financeiro de Estoque</h3>
          <span className="chart-sub">Comparativo entre recebimento e consumo de materiais (em R$)</span>
        </div>
        <div className="chart-ctrls">
          <div className="seg sm">
            <button className={modo === 'fluxo' ? 'on' : ''} onClick={() => setModo('fluxo')}>Fluxo</button>
            <button className={modo === 'saldo' ? 'on' : ''} onClick={() => setModo('saldo')}>Saldo</button>
          </div>
          <div className="seg sm">
            {[3, 6, 12].map(m => (
              <button key={m} className={meses === m ? 'on' : ''} onClick={() => setMeses(m)}>
                {m === 12 ? 'Ano' : `${m}m`}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="chart-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" preserveAspectRatio="xMidYMid meet">
          {gridVals.map((gv, i) => (
            <g key={i}>
              <line x1={padL} x2={W - padR} y1={y(gv)} y2={y(gv)} className="grid" />
              <text x={padL - 8} y={y(gv) + 4} className="axis" textAnchor="end">R$ {fmtMil(gv)}</text>
            </g>
          ))}
          {view.map((v, i) => {
            const cx = padL + groupW * i + groupW / 2
            if (modo === 'saldo') {
              return <rect key={i} x={cx - barW / 2} y={y(v.a)} width={barW} height={y(0) - y(v.a)} rx="3" className="bar-a" />
            }
            return (
              <g key={i}>
                <rect x={cx - barW - 2} y={y(v.a)} width={barW} height={y(0) - y(v.a)} rx="3" className="bar-a" />
                <rect x={cx + 2} y={y(v.b)} width={barW} height={y(0) - y(v.b)} rx="3" className="bar-b" />
              </g>
            )
          })}
          {view.map((v, i) => (
            <text key={i} x={padL + groupW * i + groupW / 2} y={H - padB + 20} className="axis" textAnchor="middle">
              {rotuloMes(v.mes)}</text>
          ))}
        </svg>
      </div>

      {modo === 'fluxo' && (
        <div className="legenda">
          <span><i className="dot-a" /> Entradas</span>
          <span><i className="dot-b" /> Saídas</span>
        </div>
      )}
    </div>
  )
}
