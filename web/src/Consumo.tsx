import { useEffect, useMemo, useState } from 'react'
import { api, brl, num, type ConsumoData, type ConsumoMes } from './api'

const MESES_PT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const rotuloMes = (k: string) => { const [y, m] = k.split('-'); return `${MESES_PT[+m - 1]}/${y.slice(2)}` }

export default function Consumo({ obra }: { obra: string }) {
  const [d, setD] = useState<ConsumoData | null>(null)
  const [err, setErr] = useState('')
  const [meses, setMeses] = useState(12)
  useEffect(() => {
    setD(null); setErr('')
    api.consumo(obra, meses).then(setD).catch(e => setErr(e instanceof Error ? e.message : String(e)))
  }, [obra, meses])

  if (err) return <div className="err">Falha ao carregar: {err}</div>
  if (!d) return <div className="loading">Carregando consumo…</div>
  const k = d.kpis
  const tend = k.tendencia_pct
  const tendTxt = tend === null ? '—' : `${tend > 0 ? '▲' : '▼'} ${num(Math.abs(tend), 1)}%`
  const tendTone = tend === null ? '' : tend > 0 ? 'critico' : 'baixo'

  return (
    <div className="dash">
      <div className="kpi-row">
        <div className="kpi-card"><div className="kpi-rot">Consumo do mês</div><div className="kpi-big">{brl(k.consumo_mes)}</div><div className="kpi-hint">valor consumido no mês atual</div></div>
        <div className="kpi-card"><div className="kpi-rot">Consumo médio/mês</div><div className="kpi-big">{brl(k.consumo_medio_mes)}</div><div className="kpi-hint">média dos últimos {k.meses} meses</div></div>
        <div className="kpi-card"><div className="kpi-top"><span className="kpi-rot">Tendência</span><span className={`kpi-tag ${tendTone}`}>{tend === null ? 'sem base' : tend > 0 ? 'acelerando' : 'desacelerando'}</span></div><div className="kpi-big">{tendTxt}</div><div className="kpi-hint">mês atual vs. anterior</div></div>
        <div className="kpi-card"><div className="kpi-rot">Insumos ativos</div><div className="kpi-big">{num(k.n_ativos)}</div><div className="kpi-hint">com consumo no período</div></div>
      </div>

      <SerieChart serie={d.serie} meses={meses} setMeses={setMeses} />

      <div className="chart-card" style={{ marginTop: 16 }}>
        <div className="chart-head">
          <div>
            <h3>Insumos que mais consomem capital</h3>
            <span className="chart-sub">Ordenado pelo valor consumido no período · destaque para cobertura baixa</span>
          </div>
        </div>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr>
              <th>Insumo</th><th className="r">Consumo no período</th><th className="r">R$/dia</th>
              <th className="r">Saldo</th><th className="r">Cobertura</th>
            </tr></thead>
            <tbody>
              {d.top.map(i => {
                const cob = i.cobertura_dias
                const tone = cob === null ? '' : cob < 7 ? 'critico' : cob < 15 ? 'baixo' : ''
                return (
                  <tr key={i.resource_id}>
                    <td><div className="desc">{i.descricao}</div><div className="meta">#{i.resource_id}</div></td>
                    <td className="r"><b>{brl(i.consumo_periodo)}</b></td>
                    <td className="r">{brl(i.consumo_dia_valor)}</td>
                    <td className="r">{num(i.saldo, 2)} {i.unidade}</td>
                    <td className="r">{cob === null ? '—' : <span className={tone ? `pill ${tone}` : ''} style={{ fontSize: 11 }}>{num(cob, 1)} d</span>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function SerieChart({ serie, meses, setMeses }: { serie: ConsumoMes[]; meses: number; setMeses: (n: number) => void }) {
  const view = useMemo(() => serie, [serie])
  const W = 900, H = 300, padL = 64, padR = 16, padT = 16, padB = 40
  const maxV = Math.max(1, ...view.map(v => v.consumo))
  const n = view.length
  const groupW = (W - padL - padR) / n
  const barW = Math.min(30, groupW / 1.8)
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / maxV)
  const grid = [0, 0.25, 0.5, 0.75, 1].map(t => maxV * t)
  const fmt = (v: number) => v >= 1e6 ? `${(v / 1e6).toFixed(1)}mi` : v >= 1e3 ? `${Math.round(v / 1e3)}mil` : `${Math.round(v)}`
  const pts = view.map((v, i) => `${padL + groupW * i + groupW / 2},${y(v.consumo)}`).join(' ')

  return (
    <div className="chart-card">
      <div className="chart-head">
        <div>
          <h3>Consumo mensal</h3>
          <span className="chart-sub">Valor consumido por mês (só movimentos de consumo), em R$</span>
        </div>
        <div className="seg sm">
          {[3, 6, 12].map(m => <button key={m} className={meses === m ? 'on' : ''} onClick={() => setMeses(m)}>{m === 12 ? 'Ano' : `${m}m`}</button>)}
        </div>
      </div>
      <div className="chart-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" preserveAspectRatio="xMidYMid meet">
          {grid.map((gv, i) => (
            <g key={i}>
              <line x1={padL} x2={W - padR} y1={y(gv)} y2={y(gv)} className="grid" />
              <text x={padL - 8} y={y(gv) + 4} className="axis" textAnchor="end">R$ {fmt(gv)}</text>
            </g>
          ))}
          {view.map((v, i) => {
            const cx = padL + groupW * i + groupW / 2
            return <rect key={i} x={cx - barW / 2} y={y(v.consumo)} width={barW} height={y(0) - y(v.consumo)} rx="3" className="bar-b" />
          })}
          <polyline points={pts} className="linha" />
          {view.map((v, i) => (
            <text key={i} x={padL + groupW * i + groupW / 2} y={H - padB + 20} className="axis" textAnchor="middle">{rotuloMes(v.mes)}</text>
          ))}
        </svg>
      </div>
    </div>
  )
}
