import { useEffect, useMemo, useState } from 'react'
import { api, brl, num, STATUS_LABEL, type CurvaABC, type LinhaABC, type ClasseABC } from './api'
import Loader from './Loader'

const MAX_LINHAS = 400  // teto de renderização; a exportação leva tudo

function fmtData(s: string | null): string {
  if (!s) return 'nunca'
  const p = s.slice(0, 10).split('-')
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : s
}
function diasDesde(s: string | null, hoje: string): number | null {
  if (!s) return null
  const a = new Date(s.slice(0, 10)).getTime(), b = new Date(hoje.slice(0, 10)).getTime()
  return Math.round((b - a) / 86400000)
}

function baixarCSV(nome: string, linhas: (string | number)[][]) {
  const csv = linhas.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob); a.download = nome; a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

type Ord = 'valor' | 'entrada' | 'consumo' | 'nome'

export default function CurvaAbc({ obra }: { obra: string }) {
  const [d, setD] = useState<CurvaABC | null>(null)
  const [err, setErr] = useState('')
  const [classe, setClasse] = useState<ClasseABC | 'todas'>('todas')
  const [q, setQ] = useState('')
  const [ord, setOrd] = useState<Ord>('valor')

  useEffect(() => {
    setD(null); setErr('')
    api.curvaAbc(obra).then(setD).catch(e => setErr(e instanceof Error ? e.message : String(e)))
  }, [obra])

  const filtradas = useMemo(() => {
    if (!d) return []
    const ql = q.toLowerCase().trim()
    let r = d.itens.filter(i =>
      (classe === 'todas' || i.abc === classe) &&
      (!ql || i.descricao.toLowerCase().includes(ql) || i.resource_id === ql || (i.grupo || '').toLowerCase().includes(ql)))
    if (ord === 'nome') r = [...r].sort((a, b) => a.descricao.localeCompare(b.descricao))
    else if (ord === 'entrada') r = [...r].sort((a, b) => (a.ultima_entrada || '') < (b.ultima_entrada || '') ? 1 : -1)
    else if (ord === 'consumo') r = [...r].sort((a, b) => (a.ultimo_consumo || '') < (b.ultimo_consumo || '') ? 1 : -1)
    // 'valor' já vem ordenado do backend
    return r
  }, [d, classe, q, ord])

  const exportar = () => {
    if (!d) return
    const head = ['Codigo', 'Descricao', 'Grupo', 'Familia', 'Macrofamilia', 'Unidade', 'Saldo',
      'Custo unit (R$)', 'Valor em estoque (R$)', '% do total', '% acumulado', 'Classe ABC',
      'Status', 'Ultima entrada', 'Ultimo consumo', 'Dias sem consumo']
    const rows = d.itens.map(i => [
      i.resource_id, i.descricao, i.grupo, i.familia, i.macro, i.unidade,
      num(i.saldo, 2), i.custo_unit, i.valor_saldo, i.pct_do_total,
      i.pct_acumulado ?? '', i.abc, STATUS_LABEL[i.status] || i.status,
      fmtData(i.ultima_entrada), fmtData(i.ultimo_consumo),
      i.ultimo_consumo ? (diasDesde(i.ultimo_consumo, d.hoje) ?? '') : 'nunca',
    ])
    baixarCSV(`curva_abc_${obra}_${d.hoje}.csv`, [head, ...rows])
  }

  if (err) return <div className="err">Falha ao carregar: {err}</div>
  if (!d) return <Loader label="a curva ABC" dica="Classificando o capital em estoque por item…" />

  const total = d.valor_total || 1
  const rA = d.resumo.A, rB = d.resumo.B, rC = d.resumo.C
  const visiveis = filtradas.slice(0, MAX_LINHAS)

  return (
    <div className="abc">
      <div className="abc-cards">
        <ClasseCard cls="A" titulo="Alto valor" r={rA} hint="~80% do capital — controle rígido" />
        <ClasseCard cls="B" titulo="Valor médio" r={rB} hint="controle periódico" />
        <ClasseCard cls="C" titulo="Baixo valor" r={rC} hint="controle simples / lote" />
        <div className="kpi-card abc-total">
          <div className="kpi-rot">Capital classificado</div>
          <div className="kpi-big">{brl(d.valor_total)}</div>
          <div className="kpi-hint">{num(d.n_itens)} itens · base {d.hoje.split('-').reverse().join('/')}</div>
        </div>
      </div>

      <div className="pareto">
        {(['A', 'B', 'C'] as const).map(c => {
          const w = d.resumo[c].valor / total * 100
          return w > 0 ? <span key={c} className={`pareto-seg abc-${c}`} style={{ width: `${w}%` }} title={`Classe ${c}: ${brl(d.resumo[c].valor)} (${d.resumo[c].pct_valor}%)`}>{w > 7 ? c : ''}</span> : null
        })}
      </div>

      <div className="chart-card">
        <div className="chart-head">
          <div>
            <h3>Curva ABC do estoque</h3>
            <span className="chart-sub">Classificação por capital imobilizado · última entrada e consumo por item · {d.hoje.split('-').reverse().join('/')}</span>
          </div>
          <div className="chart-ctrls">
            <div className="seg sm">
              <button className={classe === 'todas' ? 'on' : ''} onClick={() => setClasse('todas')}>Todas</button>
              <button className={classe === 'A' ? 'on' : ''} onClick={() => setClasse('A')}>A</button>
              <button className={classe === 'B' ? 'on' : ''} onClick={() => setClasse('B')}>B</button>
              <button className={classe === 'C' ? 'on' : ''} onClick={() => setClasse('C')}>C</button>
            </div>
            <button className="mini" onClick={exportar}>⬇ Exportar (Excel/CSV)</button>
          </div>
        </div>

        <div className="abc-tools">
          <input className="busca" placeholder="Buscar insumo, código ou grupo…" value={q} onChange={e => setQ(e.target.value)} />
          <div className="seg sm">
            <button className={ord === 'valor' ? 'on' : ''} onClick={() => setOrd('valor')}>Maior valor</button>
            <button className={ord === 'entrada' ? 'on' : ''} onClick={() => setOrd('entrada')}>Entrada recente</button>
            <button className={ord === 'consumo' ? 'on' : ''} onClick={() => setOrd('consumo')}>Consumo recente</button>
            <button className={ord === 'nome' ? 'on' : ''} onClick={() => setOrd('nome')}>A–Z</button>
          </div>
        </div>

        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr>
              <th>Insumo</th>
              <th className="c">ABC</th>
              <th className="r">Saldo</th>
              <th className="r">Valor em estoque</th>
              <th className="r">% total</th>
              <th className="r">% acum.</th>
              <th className="r">Últ. entrada</th>
              <th className="r">Últ. consumo</th>
            </tr></thead>
            <tbody>
              {visiveis.map(i => <LinhaAbc key={i.resource_id} i={i} hoje={d.hoje} />)}
            </tbody>
          </table>
        </div>
        {filtradas.length > MAX_LINHAS && (
          <div className="abc-nota">Mostrando os {MAX_LINHAS} primeiros de {num(filtradas.length)} itens. Use os filtros ou <b>exporte</b> para ver a lista completa.</div>
        )}
      </div>
    </div>
  )
}

function ClasseCard({ cls, titulo, r, hint }: { cls: 'A' | 'B' | 'C'; titulo: string; r: { n_itens: number; valor: number; pct_valor: number }; hint: string }) {
  return (
    <div className={`kpi-card abc-card abc-${cls}`}>
      <div className="abc-card-top"><span className={`abc-badge abc-${cls}`}>{cls}</span><span className="abc-card-tit">{titulo}</span></div>
      <div className="kpi-big">{brl(r.valor)}</div>
      <div className="kpi-hint">{num(r.n_itens)} itens · {r.pct_valor}% do capital</div>
      <div className="abc-card-hint">{hint}</div>
    </div>
  )
}

function LinhaAbc({ i, hoje }: { i: LinhaABC; hoje: string }) {
  const dias = diasDesde(i.ultimo_consumo, hoje)
  const semConsumo = !i.ultimo_consumo
  return (
    <tr>
      <td>
        <div className="desc">{i.descricao}</div>
        <div className="meta">{i.grupo || '—'} · #{i.resource_id} · {STATUS_LABEL[i.status] || i.status}</div>
      </td>
      <td className="c"><span className={`abc-badge abc-${i.abc === '—' ? 'x' : i.abc}`}>{i.abc}</span></td>
      <td className="r">{num(i.saldo, 2)} {i.unidade}</td>
      <td className="r"><b>{brl(i.valor_saldo)}</b></td>
      <td className="r">{num(i.pct_do_total, 2)}%</td>
      <td className="r">{i.pct_acumulado === null ? '—' : `${num(i.pct_acumulado, 1)}%`}</td>
      <td className="r">{fmtData(i.ultima_entrada)}</td>
      <td className="r" title={semConsumo ? 'nunca consumido' : `há ${dias} dias`}>
        {semConsumo ? <span className="nunca">nunca</span> : fmtData(i.ultimo_consumo)}
      </td>
    </tr>
  )
}
