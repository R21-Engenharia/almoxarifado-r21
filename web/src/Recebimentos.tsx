import { useEffect, useMemo, useState } from 'react'
import { api, brl, num, type RecebimentosData, type RecebFila, type PedidoItem } from './api'
import Loader from './Loader'

type Aba = 'fila' | 'recebidos' | 'lead' | 'reajuste'

const data = (s: string | null) => s ? new Date(s + 'T00:00:00').toLocaleDateString('pt-BR') : '—'

export default function Recebimentos({ obra }: { obra: string }) {
  const [d, setD] = useState<RecebimentosData | null>(null)
  const [err, setErr] = useState('')
  const [aba, setAba] = useState<Aba>('fila')
  const [pedido, setPedido] = useState<RecebFila | null>(null)

  useEffect(() => {
    setD(null); setErr('')
    api.recebimentos(obra).then(setD).catch(e => setErr(e instanceof Error ? e.message : String(e)))
  }, [obra])

  if (err) return <div className="err">Falha ao carregar: {err}</div>
  if (!d) return <Loader label="os recebimentos" dica="Cruzando pedidos, entradas físicas e notas do Sienge…" />
  const k = d.kpis

  return (
    <div className="dash">
      <div className="kpi-row">
        <Kpi rot="Pendentes de recebimento" v={num(k.n_pendentes)} hint={`${brl(k.valor_pendente)} em aberto`} />
        <Kpi rot="Atrasados" v={num(k.n_atrasados)} hint={`${brl(k.valor_atrasado)} em risco`} tone={k.n_atrasados > 0 ? 'bad' : ''} />
        <Kpi rot="Recebido (30 dias)" v={brl(k.recebido_30d)} hint={`${num(k.n_recebido_30d)} entradas`} />
        <Kpi rot="Lead time típico" v={k.lead_time_mediano != null ? `${num(k.lead_time_mediano, 1)} d` : '—'} hint="pedido → entrega (mediana)" />
      </div>

      <div className="chart-card">
        <div className="chart-head">
          <div><h3>Recebimento &amp; Conferência</h3>
            <span className="chart-sub">O que chegou fecha com o pedido e a nota? · dados reais do Sienge</span></div>
        </div>
        <div className="chips">
          <button className={aba === 'fila' ? 'on' : ''} onClick={() => setAba('fila')}>Fila pendente ({d.fila.length})</button>
          <button className={aba === 'recebidos' ? 'on' : ''} onClick={() => setAba('recebidos')}>Recebidos ({d.recebimentos.length})</button>
          <button className={aba === 'lead' ? 'on' : ''} onClick={() => setAba('lead')}>Lead time ({d.lead_fornecedores.length})</button>
          <button className={aba === 'reajuste' ? 'on' : ''} onClick={() => setAba('reajuste')}>Reajustes ({k.n_reajustes})</button>
        </div>

        {aba === 'fila' && <FilaTbl d={d} onAbrir={setPedido} />}
        {aba === 'recebidos' && <RecebidosTbl d={d} />}
        {aba === 'lead' && <LeadTbl d={d} />}
        {aba === 'reajuste' && <ReajusteTbl d={d} />}
      </div>

      {pedido && <PedidoModal obra={obra} f={pedido} onFechar={() => setPedido(null)} />}
    </div>
  )
}

/* Detalhe do pedido: os insumos daquela solicitação de compra */
function PedidoModal({ obra, f, onFechar }: { obra: string; f: RecebFila; onFechar: () => void }) {
  const [itens, setItens] = useState<PedidoItem[] | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    setItens(null); setErr('')
    api.pedidoItens(obra, f.pedido_id).then(r => setItens(r.itens)).catch(e => setErr(e instanceof Error ? e.message : String(e)))
  }, [obra, f.pedido_id])
  const total = (itens || []).reduce((a, i) => a + i.valor, 0)
  return (
    <div className="modal" onClick={onFechar}>
      <div className="modal-card" onClick={e => e.stopPropagation()} style={{ maxWidth: 660 }}>
        <div className="ctx-head">
          <div><h3 style={{ margin: 0 }}>Pedido #{f.numero}</h3>
            <div className="chart-sub">{f.fornecedor} · {data(f.data)}{f.comprador ? ` · ${f.comprador}` : ''}</div></div>
          <span className={`pill ${f.atrasado ? 'ruptura' : f.parcial ? 'baixo' : ''}`}>{f.atrasado ? 'Atrasado' : f.parcial ? 'Parcial' : 'Pendente'}</span>
        </div>
        {err && <div className="msg bad" style={{ marginTop: 10 }}>{err}</div>}
        {!itens && !err && <div className="loading" style={{ padding: 20 }}>Carregando itens do pedido…</div>}
        {itens && (
          <div className="tbl-wrap" style={{ marginTop: 12 }}>
            <table className="tbl">
              <thead><tr><th>Insumo</th><th className="r">Qtd</th><th className="r">Preço un.</th><th className="r">Valor</th></tr></thead>
              <tbody>
                {itens.map((i, n) => (
                  <tr key={n}>
                    <td><div className="desc" style={{ fontSize: 13 }}>{i.descricao}</div>
                      <div className="meta">#{i.resource_id}{i.detalhe ? ` · ${i.detalhe}` : ''}</div></td>
                    <td className="r">{num(i.quantidade, 2)} {i.unidade}</td>
                    <td className="r">{brl(i.preco_unit)}</td>
                    <td className="r">{brl(i.valor)}</td>
                  </tr>
                ))}
                {itens.length === 0 && <tr><td colSpan={4}><div className="empty">Sem itens retornados para este pedido.</div></td></tr>}
              </tbody>
              {itens.length > 0 && <tfoot><tr><td colSpan={3} className="r"><b>Total</b></td><td className="r"><b>{brl(total)}</b></td></tr></tfoot>}
            </table>
          </div>
        )}
        <div className="modal-acts" style={{ marginTop: 12 }}><button className="ghost" onClick={onFechar}>Fechar</button></div>
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

/* Fila de recebimentos pendentes/atrasados — valor em risco */
function FilaTbl({ d, onAbrir }: { d: RecebimentosData; onAbrir: (f: RecebFila) => void }) {
  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead><tr><th>Pedido</th><th>Fornecedor</th><th className="r">Aberto há</th><th className="r">Valor</th><th>Situação</th><th></th></tr></thead>
        <tbody>
          {d.fila.map(f => (
            <tr key={f.pedido_id} style={{ cursor: 'pointer' }} onClick={() => onAbrir(f)}>
              <td><div className="desc">#{f.numero}</div><div className="meta">{data(f.data)}{f.comprador ? ` · ${f.comprador}` : ''}</div></td>
              <td><div className="desc" style={{ fontSize: 13 }}>{f.fornecedor}</div></td>
              <td className="r">{f.dias_aberto != null ? `${num(f.dias_aberto)} d` : '—'}</td>
              <td className="r">{brl(f.valor)}</td>
              <td>
                {f.atrasado && <span className="pill ruptura" style={{ marginRight: 6 }}>Atrasado</span>}
                <span className={`pill ${f.parcial ? 'baixo' : ''}`}>{f.parcial ? 'Parcial' : 'Pendente'}</span>
              </td>
              <td className="r"><button className="mini">Ver itens</button></td>
            </tr>
          ))}
          {d.fila.length === 0 && <tr><td colSpan={6}><div className="empty">Nenhum pedido pendente de recebimento. Tudo entregue. ✓</div></td></tr>}
        </tbody>
      </table>
    </div>
  )
}

/* Log do que chegou fisicamente (entrada tipo Compra = físico + nota) */
function RecebidosTbl({ d }: { d: RecebimentosData }) {
  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead><tr><th>Data</th><th>Insumo</th><th>Fornecedor</th><th>NF</th><th className="r">Qtd</th><th className="r">Preço un.</th><th className="r">Valor</th></tr></thead>
        <tbody>
          {d.recebimentos.map((r, i) => (
            <tr key={i}>
              <td>{data(r.data)}</td>
              <td><div className="desc" style={{ fontSize: 13 }}>{r.descricao}</div><div className="meta">#{r.resource_id}</div></td>
              <td><div className="desc" style={{ fontSize: 12.5 }}>{r.fornecedor}</div></td>
              <td><span className="meta">{r.nf || '—'}</span></td>
              <td className="r">{num(r.quantidade, 2)} {r.unidade}</td>
              <td className="r">{r.preco_unit != null ? brl(r.preco_unit) : '—'}</td>
              <td className="r">{brl(r.valor)}</td>
            </tr>
          ))}
          {d.recebimentos.length === 0 && <tr><td colSpan={7}><div className="empty">Sem recebimentos registrados.</div></td></tr>}
        </tbody>
      </table>
    </div>
  )
}

/* Lead time real por fornecedor (pedido → recebimento) — insumo do MRP */
function LeadTbl({ d }: { d: RecebimentosData }) {
  const max = useMemo(() => Math.max(1, ...d.lead_fornecedores.map(l => l.lead_max)), [d])
  return (
    <>
      <div className="meta" style={{ marginBottom: 10 }}>
        Tempo estimado entre o pedido e a chegada física, por fornecedor (mediana). Vira insumo do MRP para antecipar a ruptura.
      </div>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>Fornecedor</th><th className="r">Recebimentos</th><th className="r">Mediana</th><th>Faixa (mín–máx)</th></tr></thead>
          <tbody>
            {d.lead_fornecedores.map((l, i) => (
              <tr key={i}>
                <td><div className="desc" style={{ fontSize: 13 }}>{l.fornecedor}</div></td>
                <td className="r">{num(l.n_receb)}</td>
                <td className="r"><b>{num(l.lead_mediano, 1)} d</b></td>
                <td>
                  <div className="lead-bar">
                    <span style={{ left: `${(l.lead_min / max) * 100}%`, right: `${100 - (l.lead_max / max) * 100}%` }} />
                    <i style={{ left: `${(l.lead_mediano / max) * 100}%` }} />
                  </div>
                  <div className="meta">{num(l.lead_min)}–{num(l.lead_max)} dias</div>
                </td>
              </tr>
            ))}
            {d.lead_fornecedores.length === 0 && <tr><td colSpan={4}><div className="empty">Sem histórico suficiente para lead time.</div></td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}

/* Reajuste silencioso: variação de preço do mesmo insumo entre recebimentos */
function ReajusteTbl({ d }: { d: RecebimentosData }) {
  return (
    <>
      <div className="meta" style={{ marginBottom: 10 }}>
        Insumos que chegaram mais caros que na compra anterior (mesma unidade). <b>Mesmo fornecedor</b> = reajuste silencioso;
        <b> outro fornecedor</b> = pagou mais que já pagou antes.
      </div>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>Insumo</th><th className="r">Antes</th><th className="r">Agora</th><th className="r">Variação</th><th>Origem</th></tr></thead>
          <tbody>
            {d.reajustes.map((r, i) => (
              <tr key={i}>
                <td><div className="desc" style={{ fontSize: 13 }}>{r.descricao}</div><div className="meta">#{r.resource_id} · {r.unidade}</div></td>
                <td className="r"><span className="meta">{data(r.data_ant)}</span><br />{brl(r.preco_ant)}</td>
                <td className="r"><span className="meta">{data(r.data_novo)}</span><br /><b>{brl(r.preco_novo)}</b></td>
                <td className="r"><span className="pill ruptura">+{num(r.var_pct, 1)}%</span></td>
                <td>
                  <span className={`pill ${r.mesmo_forn ? 'ruptura' : 'baixo'}`} style={{ fontSize: 10 }}>
                    {r.mesmo_forn ? 'mesmo fornecedor' : 'trocou fornecedor'}
                  </span>
                  <div className="meta" style={{ marginTop: 3 }}>{r.mesmo_forn ? r.forn_novo : `${r.forn_ant} → ${r.forn_novo}`}</div>
                </td>
              </tr>
            ))}
            {d.reajustes.length === 0 && <tr><td colSpan={5}><div className="empty">Nenhum reajuste relevante detectado.</div></td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}
