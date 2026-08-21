import { useEffect, useMemo, useState } from 'react'
import { api, brl, num, type FornecedoresData, type FornecedorItem } from './api'
import Loader from './Loader'

type SortKey = 'valor_total' | 'n_pedidos' | 'pct_no_prazo'

function baixarCSV(nome: string, linhas: (string | number)[][]) {
  const csv = linhas.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nome; a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export default function Fornecedores({ obra }: { obra: string }) {
  const [d, setD] = useState<FornecedoresData | null>(null)
  const [err, setErr] = useState('')
  const [meses, setMeses] = useState(12)
  const [sortKey, setSortKey] = useState<SortKey>('valor_total')
  const [atualizando, setAtualizando] = useState(false)
  const [msg, setMsg] = useState('')

  const carregar = () => { setD(null); setErr(''); api.fornecedores(obra, meses).then(setD).catch(e => setErr(e instanceof Error ? e.message : String(e))) }
  useEffect(carregar, [obra, meses])

  const atualizar = async () => {
    setAtualizando(true); setMsg('')
    try { await api.atualizarPedidos(obra); setMsg('✓ Coleta de pedidos iniciada (~6 min). Atualize a página depois.') }
    catch (e) { setMsg('✗ ' + (e instanceof Error ? e.message : String(e))) }
    finally { setAtualizando(false) }
  }

  const linhas = useMemo(() => {
    if (!d) return []
    return [...d.fornecedores].sort((a, b) => (b[sortKey] as number) - (a[sortKey] as number))
  }, [d, sortKey])

  const exportar = () => {
    if (!d) return
    const head = ['Fornecedor', 'ID', 'Pedidos', 'Valor comprado (R$)', '% do total', '% no prazo', 'Atrasados', 'Último pedido']
    baixarCSV(`fornecedores_${d.hoje}.csv`, [head, ...linhas.map(f =>
      [f.nome, f.supplier_id, f.n_pedidos, f.valor_total, f.pct_do_total, f.pct_no_prazo, f.n_atrasados, f.ultimo_pedido || ''])])
  }

  if (err) return <div className="err">Falha ao carregar: {err}</div>
  if (!d) return <Loader label="os fornecedores" dica="Cruzando pedidos, prazos e notas fiscais…" />
  const k = d.kpis
  const semDados = k.n_pedidos === 0

  return (
    <div className="dash">
      <div className="kpi-row">
        <div className="kpi-card"><div className="kpi-rot">Fornecedores ativos</div><div className="kpi-big">{num(k.n_fornecedores)}</div><div className="kpi-hint">com pedidos nos últimos {k.meses} meses</div></div>
        <div className="kpi-card"><div className="kpi-rot">Valor comprado</div><div className="kpi-big">{brl(k.valor_total)}</div><div className="kpi-hint">{num(k.n_pedidos)} pedidos no período</div></div>
        <div className="kpi-card"><div className="kpi-top"><span className="kpi-rot">Entregas no prazo</span><span className={`kpi-tag ${k.pct_atraso > 15 ? 'critico' : k.pct_atraso > 5 ? 'baixo' : ''}`}>{k.pct_atraso > 15 ? 'atenção' : 'OK'}</span></div><div className="kpi-big">{num(100 - k.pct_atraso, 1)}%</div><div className="kpi-hint">{num(k.pct_atraso, 1)}% dos pedidos com atraso</div></div>
        <div className="kpi-card"><div className="kpi-rot">Ticket médio</div><div className="kpi-big">{brl(k.n_pedidos ? k.valor_total / k.n_pedidos : 0)}</div><div className="kpi-hint">valor médio por pedido</div></div>
      </div>

      {msg && <div className={`demo-banner`} style={{ marginBottom: 14 }}>{msg}</div>}
      {semDados && (
        <div className="demo-banner" style={{ marginBottom: 14 }}>
          Nenhum pedido carregado ainda para esta obra.
          <button className="mini" style={{ marginLeft: 10 }} onClick={atualizar} disabled={atualizando}>
            {atualizando ? 'Coletando…' : 'Coletar pedidos do Sienge'}</button>
        </div>
      )}

      <div className="chart-card">
        <div className="chart-head">
          <div>
            <h3>Ranking de fornecedores</h3>
            <span className="chart-sub">Compras, prazo de entrega e confiabilidade · a partir dos pedidos do Sienge · {d.hoje}</span>
          </div>
          <div className="chart-ctrls">
            <div className="seg sm">{[6, 12, 24].map(m => <button key={m} className={meses === m ? 'on' : ''} onClick={() => setMeses(m)}>{m}m</button>)}</div>
            <button className="mini" onClick={exportar}>⬇ Exportar</button>
          </div>
        </div>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr>
              <th>Fornecedor</th>
              <th className={`r ord ${sortKey === 'n_pedidos' ? 'on' : ''}`} onClick={() => setSortKey('n_pedidos')}>Pedidos {sortKey === 'n_pedidos' ? '▾' : ''}</th>
              <th className={`r ord ${sortKey === 'valor_total' ? 'on' : ''}`} onClick={() => setSortKey('valor_total')}>Valor comprado {sortKey === 'valor_total' ? '▾' : ''}</th>
              <th className="r">%</th>
              <th className={`r ord ${sortKey === 'pct_no_prazo' ? 'on' : ''}`} onClick={() => setSortKey('pct_no_prazo')}>No prazo {sortKey === 'pct_no_prazo' ? '▾' : ''}</th>
              <th className="r">Último pedido</th>
            </tr></thead>
            <tbody>
              {linhas.slice(0, 200).map(f => <LinhaForn key={f.supplier_id} f={f} />)}
              {linhas.length === 0 && <tr><td colSpan={6}><div className="empty">Sem fornecedores no período.</div></td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function LinhaForn({ f }: { f: FornecedorItem }) {
  const tone = f.pct_no_prazo < 70 ? 'critico' : f.pct_no_prazo < 90 ? 'baixo' : 'ok'
  return (
    <tr>
      <td><div className="desc">{f.nome}</div><div className="meta">#{f.supplier_id}</div></td>
      <td className="r">{num(f.n_pedidos)}</td>
      <td className="r"><b>{brl(f.valor_total)}</b></td>
      <td className="r">{num(f.pct_do_total, 1)}%</td>
      <td className="r"><span className={`pill ${tone}`} style={{ fontSize: 11 }}>{num(f.pct_no_prazo, 0)}%</span></td>
      <td className="r">{f.ultimo_pedido || '—'}</td>
    </tr>
  )
}
