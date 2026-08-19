import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, brl, num, type Posicao as Pos, type GrupoPos } from './api'

type SortKey = 'valor_em_estoque' | 'valor_parado' | 'n_insumos' | 'impacto_dia' | 'pct_do_total'

function baixarCSV(nome: string, linhas: (string | number)[][]) {
  const csv = linhas.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob); a.download = nome; a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export default function Posicao({ obra }: { obra: string }) {
  const [d, setD] = useState<Pos | null>(null)
  const [err, setErr] = useState('')
  const [nivel, setNivel] = useState<'grupo' | 'familia' | 'macro'>('macro')
  const [sortKey, setSortKey] = useState<SortKey>('valor_em_estoque')
  const [atualizando, setAtualizando] = useState(false)
  const [msg, setMsg] = useState('')

  const carregar = () => {
    setD(null); setErr('')
    api.posicao(obra, nivel).then(setD).catch(e => setErr(e instanceof Error ? e.message : String(e)))
  }
  useEffect(carregar, [obra, nivel])

  const atualizarGrupos = async () => {
    setAtualizando(true); setMsg('')
    try { await api.atualizarGrupos(); setMsg('✓ Coleta iniciada — o mapa fica pronto em ~11 min (o Sienge é lento nessa página). Atualize a página depois.') }
    catch (e) { setMsg('✗ ' + (e instanceof Error ? e.message : String(e))) }
    finally { setAtualizando(false) }
  }

  const linhas = useMemo(() => {
    if (!d) return []
    return [...d.grupos].sort((a, b) => (b[sortKey] as number) - (a[sortKey] as number))
  }, [d, sortKey])

  const exportarResumo = async () => {
    if (!d) return
    const head = ['Grupo', 'Categoria', 'Insumos', 'Valor em estoque (R$)', '% do total', 'Capital parado (R$)', 'Parados', 'Alertas', 'R$/dia consumido']
    const rows = linhas.map(g => [g.grupo, g.categoria, g.n_insumos, g.valor_em_estoque, g.pct_do_total, g.valor_parado, g.n_parados, g.n_alertas, g.impacto_dia])
    baixarCSV(`posicao_estoque_${nivel}_${d.hoje}.csv`, [head, ...rows])
  }

  const exportarDetalhado = async () => {
    setMsg('Gerando relatório detalhado…')
    try {
      const full = await api.posicao(obra, nivel, true)
      const head = ['Grupo', 'Insumo', 'Código', 'Saldo', 'Unidade', 'Valor saldo (R$)', 'Status', 'Cobertura (dias)']
      const rows: (string | number)[][] = []
      full.grupos.forEach(g => (g.itens || []).forEach(i =>
        rows.push([g.grupo, i.descricao, i.resource_id, i.saldo, i.unidade, i.valor_saldo, i.status, i.cobertura_dias ?? ''])))
      baixarCSV(`posicao_estoque_DETALHADO_${d?.hoje}.csv`, [head, ...rows])
      setMsg(`✓ ${num(rows.length)} linhas exportadas.`)
    } catch (e) { setMsg('✗ ' + (e instanceof Error ? e.message : String(e))) }
  }

  if (err) return <div className="err">Falha ao carregar: {err}</div>
  if (!d) return <div className="loading">Carregando posição…</div>
  const t = d.totais

  return (
    <div className="dash">
      <div className="kpi-row">
        <div className="kpi-card"><div className="kpi-rot">Valor em estoque</div><div className="kpi-big">{brl(t.valor_em_estoque)}</div><div className="kpi-hint">{num(t.n_insumos)} insumos em {num(t.n_grupos)} {nivel === 'familia' ? 'famílias' : nivel === 'macro' ? 'macrofamílias' : 'grupos'}</div></div>
        <div className="kpi-card"><div className="kpi-rot">Capital parado</div><div className="kpi-big" style={{ color: 'var(--parado)' }}>{brl(t.valor_parado)}</div><div className="kpi-hint">{t.valor_em_estoque ? num(t.valor_parado / t.valor_em_estoque * 100, 1) : 0}% do estoque</div></div>
        <div className="kpi-card"><div className="kpi-rot">Grupos / famílias</div><div className="kpi-big">{num(t.n_grupos)}</div><div className="kpi-hint">consolidação pela classificação do Sienge</div></div>
        <div className="kpi-card"><div className="kpi-rot">Sem classificação</div><div className="kpi-big">{num(t.sem_grupo)}</div><div className="kpi-hint">insumos fora do mapa de grupos</div></div>
      </div>

      {!d.mapa_ok && (
        <div className="demo-banner" style={{ marginBottom: 14 }}>
          O mapa de grupos do Sienge ainda não foi coletado — os itens aparecem como "(Sem grupo)".
          <button className="mini" style={{ marginLeft: 10 }} onClick={atualizarGrupos} disabled={atualizando}>
            {atualizando ? 'Coletando… (~min)' : 'Coletar grupos do Sienge'}</button>
        </div>
      )}

      <div className="chart-card">
        <div className="chart-head">
          <div>
            <h3>Posição de estoque por {nivel === 'familia' ? 'família' : nivel === 'macro' ? 'macrofamília' : 'grupo'}</h3>
            <span className="chart-sub">Consolidação da posição atual pela classificação de insumos do Sienge · {d.hoje}</span>
          </div>
          <div className="chart-ctrls">
            <div className="seg sm">
              <button className={nivel === 'grupo' ? 'on' : ''} onClick={() => setNivel('grupo')}>Grupo</button>
              <button className={nivel === 'macro' ? 'on' : ''} onClick={() => setNivel('macro')}>Macrofamília</button>
              <button className={nivel === 'familia' ? 'on' : ''} onClick={() => setNivel('familia')}>Família</button>
            </div>
            <button className="mini" onClick={exportarResumo}>⬇ Exportar resumo</button>
            <button className="mini" onClick={exportarDetalhado}>⬇ Detalhado</button>
          </div>
        </div>

        {msg && <div className={`msg ${msg.startsWith('✗') ? 'bad' : 'ok'}`} onClick={() => setMsg('')}>{msg}</div>}

        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr>
              <th>{nivel === 'familia' ? 'Família' : nivel === 'macro' ? 'Macrofamília' : 'Grupo'}</th>
              <th>Categoria</th>
              <Th k="n_insumos" sk={sortKey} set={setSortKey}>Insumos</Th>
              <Th k="valor_em_estoque" sk={sortKey} set={setSortKey}>Valor em estoque</Th>
              <Th k="pct_do_total" sk={sortKey} set={setSortKey}>%</Th>
              <Th k="valor_parado" sk={sortKey} set={setSortKey}>Capital parado</Th>
              <th className="r">Alertas</th>
              <Th k="impacto_dia" sk={sortKey} set={setSortKey}>R$/dia</Th>
            </tr></thead>
            <tbody>
              {linhas.map(g => <LinhaGrupo key={g.grupo} g={g} />)}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function Th({ k, sk, set, children }: { k: SortKey; sk: SortKey; set: (k: SortKey) => void; children: ReactNode }) {
  return <th className={`r ord ${sk === k ? 'on' : ''}`} onClick={() => set(k)}>{children} {sk === k ? '▾' : ''}</th>
}

function LinhaGrupo({ g }: { g: GrupoPos }) {
  const paradoPct = g.valor_em_estoque ? g.valor_parado / g.valor_em_estoque : 0
  return (
    <tr>
      <td><div className="desc">{g.grupo}</div></td>
      <td><span className="cat-badge">{g.categoria || '—'}</span></td>
      <td className="r">{num(g.n_insumos)}</td>
      <td className="r"><b>{brl(g.valor_em_estoque)}</b></td>
      <td className="r">
        <div className="barra-pct"><span style={{ width: `${Math.min(g.pct_do_total, 100)}%` }} /></div>
        {num(g.pct_do_total, 1)}%
      </td>
      <td className="r" style={{ color: paradoPct > 0.5 ? 'var(--parado)' : undefined }}>{brl(g.valor_parado)}</td>
      <td className="r">{g.n_alertas > 0 ? <span className="pill critico" style={{ fontSize: 10 }}>{g.n_alertas}</span> : '—'}</td>
      <td className="r">{brl(g.impacto_dia)}</td>
    </tr>
  )
}
