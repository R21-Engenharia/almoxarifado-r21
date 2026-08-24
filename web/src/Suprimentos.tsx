import { useEffect, useMemo, useState } from 'react'
import { api, brl, num, type SuprimentosData, type SupItem } from './api'
import { authAtiva } from './supabase'
import Loader from './Loader'
import {
  gerarPlanos, listarPlanos, resourcesNoPlano, marcarPedido, cancelarPlano,
  type Plano, type CestaItem,
} from './planoCompra'

type Filtro = 'comprar_agora' | 'esta_semana' | 'programar' | 'todos'
type Vista = 'necessidades' | 'planos'

const URG_LABEL: Record<SupItem['urgencia'], string> = {
  comprar_agora: 'Comprar agora', esta_semana: 'Esta semana', programar: 'Programar', ok: 'Ok',
}
const URG_TONE: Record<SupItem['urgencia'], string> = {
  comprar_agora: 'ruptura', esta_semana: 'critico', programar: 'baixo', ok: 'ok',
}
const data = (s: string | null) => s ? new Date(s + 'T00:00:00').toLocaleDateString('pt-BR') : '—'

interface Sel { item: SupItem; qtd: number }

export default function Suprimentos({ obra }: { obra: string }) {
  const [d, setD] = useState<SuprimentosData | null>(null)
  const [err, setErr] = useState('')
  const [f, setF] = useState<Filtro>('comprar_agora')
  const [vista, setVista] = useState<Vista>('necessidades')
  const [cesta, setCesta] = useState<Record<string, Sel>>({})
  const [noPlano, setNoPlano] = useState<Set<string>>(new Set())
  const [planos, setPlanos] = useState<Plano[]>([])
  const [modal, setModal] = useState(false)

  const carregar = () => {
    setD(null); setErr('')
    api.suprimentos(obra).then(setD).catch(e => setErr(e instanceof Error ? e.message : String(e)))
    resourcesNoPlano(obra).then(setNoPlano).catch(() => {})
    listarPlanos(obra).then(setPlanos).catch(() => {})
  }
  useEffect(() => { setCesta({}); carregar() }, [obra])

  const itens = useMemo(() => {
    if (!d) return []
    if (f === 'todos') return d.itens
    if (f === 'programar') return d.itens.filter(i => i.urgencia === 'programar' || i.urgencia === 'ok')
    return d.itens.filter(i => i.urgencia === f)
  }, [d, f])

  const toggle = (i: SupItem) => setCesta(c => {
    const n = { ...c }
    if (n[i.resource_id]) delete n[i.resource_id]
    else n[i.resource_id] = { item: i, qtd: i.qtd_sugerida }
    return n
  })
  const selecionarVencidos = () => {
    if (!d) return
    const n: Record<string, Sel> = { ...cesta }
    d.itens.filter(i => i.urgencia === 'comprar_agora' && !noPlano.has(i.resource_id))
      .forEach(i => { n[i.resource_id] = { item: i, qtd: i.qtd_sugerida } })
    setCesta(n)
  }

  const linhas = Object.values(cesta)
  const totalCesta = linhas.reduce((a, s) => a + s.qtd * s.item.custo_unit, 0)
  const nFornecedores = new Set(linhas.map(s => s.item.fornecedor || '—')).size

  if (err) return <div className="err">Falha ao carregar: {err}</div>
  if (!d) return <Loader label="o MRP" dica="Projetando consumo, ponto de pedido e trade-off de capital…" />
  const k = d.kpis

  return (
    <div className="dash">
      <div className="kpi-row">
        <Kpi rot="Comprar agora" v={num(k.n_comprar_agora)} hint={`${brl(k.valor_comprar_agora)} em compra`} tone={k.n_comprar_agora > 0 ? 'bad' : ''} />
        <Kpi rot="Comprar esta semana" v={num(k.n_esta_semana)} hint={`${brl(k.valor_esta_semana)} em compra`} />
        <Kpi rot="Exposição se parar" v={brl(k.exposicao_parada_dia)} hint="por dia, nos itens em ruptura" tone={k.exposicao_parada_dia > 0 ? 'bad' : ''} />
        <Kpi rot="Capital que fica livre" v={`${brl(k.economia_selic_mes)}/mês`} hint={`em Selic, comprando no ponto certo (${d.parametros.selic_anual_pct}% a.a.)`} />
      </div>

      <div className="chart-card">
        <div className="chart-head">
          <div><h3>Suprimentos · MRP preditivo</h3>
            <span className="chart-sub">Selecione o que comprar → o BOX21 consolida por fornecedor e gera o plano de compra.</span></div>
          <div className="seg sm">
            <button className={vista === 'necessidades' ? 'on' : ''} onClick={() => setVista('necessidades')}>Necessidades</button>
            <button className={vista === 'planos' ? 'on' : ''} onClick={() => setVista('planos')}>Planos ({planos.length})</button>
          </div>
        </div>

        {vista === 'necessidades' ? (
          <>
            <div className="chips">
              {(['comprar_agora', 'esta_semana', 'programar', 'todos'] as Filtro[]).map(x =>
                <button key={x} className={f === x ? 'on' : ''} onClick={() => setF(x)}>
                  {x === 'comprar_agora' ? `Comprar agora (${d.itens.filter(i => i.urgencia === 'comprar_agora').length})`
                    : x === 'esta_semana' ? `Esta semana (${d.itens.filter(i => i.urgencia === 'esta_semana').length})`
                      : x === 'programar' ? `Programar (${d.itens.filter(i => i.urgencia === 'programar' || i.urgencia === 'ok').length})`
                        : `Todos (${d.itens.length})`}
                </button>)}
              {f === 'comprar_agora' && <button className="mini" style={{ marginLeft: 'auto' }} onClick={selecionarVencidos}>+ Selecionar todos vencidos</button>}
            </div>

            <div className="tbl-wrap">
              <table className="tbl sup-tbl">
                <thead><tr>
                  <th style={{ width: 34 }}></th>
                  <th>Insumo</th><th>Cobertura</th><th>Fornecedor · proteção</th>
                  <th>Comprar até</th><th className="r">Quantidade</th><th className="r">Risco/dia</th>
                </tr></thead>
                <tbody>
                  {itens.map(i => {
                    const sel = !!cesta[i.resource_id]
                    const emPlano = noPlano.has(i.resource_id)
                    return (
                      <tr key={i.resource_id} className={sel ? 'sel' : ''}>
                        <td><input type="checkbox" checked={sel} onChange={() => toggle(i)} disabled={emPlano} /></td>
                        <td>
                          <div className="desc" style={{ fontSize: 13 }}>{i.descricao}
                            {emPlano && <span className="pill ok" style={{ fontSize: 10, marginLeft: 6 }}>no plano</span>}</div>
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
                        <td className="r"><b>{num(i.qtd_sugerida, 1)}</b> <span className="u">{i.unidade}</span>
                          <div className="meta">{brl(i.valor_sugerido)}</div></td>
                        <td className="r">
                          <span style={i.exposicao_parada_dia > 0 ? { color: 'var(--ruptura)', fontWeight: 700 } : undefined}>{brl(i.exposicao_parada_dia)}</span>
                          <div className="meta">preso: {brl(i.custo_antecipar_dia)}/d</div></td>
                      </tr>
                    )
                  })}
                  {itens.length === 0 && <tr><td colSpan={7}><div className="empty">Nenhum insumo neste grupo. 👍</div></td></tr>}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <PlanosView planos={planos} onMudou={carregar} />
        )}
      </div>

      {linhas.length > 0 && vista === 'necessidades' && (
        <div className="cesta-bar">
          <div className="cesta-info">{linhas.length} {linhas.length === 1 ? 'insumo' : 'insumos'} · {nFornecedores} {nFornecedores === 1 ? 'fornecedor' : 'fornecedores'} · <b>{brl(totalCesta)}</b></div>
          <button className="ghost" onClick={() => setCesta({})}>Limpar</button>
          <button className="cta" onClick={() => setModal(true)}>Gerar plano de compra</button>
        </div>
      )}

      {modal && <GerarModal cesta={cesta} setCesta={setCesta} obra={obra}
        onGerado={() => { setModal(false); setCesta({}); setVista('planos'); carregar() }}
        onFechar={() => setModal(false)} />}
    </div>
  )
}

function Kpi({ rot, v, hint, tone }: { rot: string; v: string; hint?: string; tone?: string }) {
  return <div className="kpi-card"><div className="kpi-rot">{rot}</div>
    <div className="kpi-big" style={tone === 'bad' && v !== '0' ? { color: 'var(--ruptura)' } : undefined}>{v}</div>
    {hint && <div className="kpi-hint">{hint}</div>}</div>
}

/* ---- modal: revisar a cesta (por fornecedor) e gerar ---- */
function GerarModal({ cesta, setCesta, obra, onGerado, onFechar }: {
  cesta: Record<string, Sel>; setCesta: React.Dispatch<React.SetStateAction<Record<string, Sel>>>
  obra: string; onGerado: () => void; onFechar: () => void
}) {
  const [proc, setProc] = useState(false)
  const [erro, setErro] = useState('')
  const grupos = useMemo(() => {
    const g: Record<string, Sel[]> = {}
    Object.values(cesta).forEach(s => { (g[s.item.fornecedor || 'Sem fornecedor definido'] ||= []).push(s) })
    return g
  }, [cesta])

  const setQtd = (rid: string, q: number) => setCesta(c => ({ ...c, [rid]: { ...c[rid], qtd: q } }))

  const gerar = async () => {
    if (!authAtiva) { setErro('Gerar plano exige login (Supabase). Rode o app em produção.'); return }
    setProc(true); setErro('')
    try {
      const cestaArr: CestaItem[] = Object.values(cesta).map(s => ({
        resource_id: s.item.resource_id, descricao: s.item.descricao, unidade: s.item.unidade,
        fornecedor: s.item.fornecedor, quantidade: s.qtd, custo_unit: s.item.custo_unit,
      }))
      const n = await gerarPlanos(obra, cestaArr)
      void n; onGerado()
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); setProc(false) }
  }

  return (
    <div className="modal" onClick={() => !proc && onFechar()}>
      <div className="modal-card" onClick={e => e.stopPropagation()} style={{ maxWidth: 620 }}>
        <h3>Gerar plano de compra</h3>
        <p className="warn-txt" style={{ color: 'var(--muted)' }}>Um plano por fornecedor. Ajuste a quantidade se precisar.</p>
        {Object.entries(grupos).map(([forn, itens]) => {
          const tot = itens.reduce((a, s) => a + s.qtd * s.item.custo_unit, 0)
          return (
            <div key={forn} className="ctx-item" style={{ marginBottom: 10 }}>
              <div className="ctx-item-head"><b>{forn}</b><span className="ctx-v" style={{ fontSize: 15 }}>{brl(tot)}</span></div>
              <div className="ctx-subs">
                {itens.map(s => (
                  <div key={s.item.resource_id} className="plano-linha">
                    <span className="desc" style={{ fontSize: 13 }}>{s.item.descricao}</span>
                    <input type="number" min={0} step="any" className="qtd" value={s.qtd}
                      onChange={e => setQtd(s.item.resource_id, parseFloat(e.target.value) || 0)} />
                    <span className="u">{s.item.unidade}</span>
                    <span className="meta" style={{ minWidth: 78, textAlign: 'right' }}>{brl(s.qtd * s.item.custo_unit)}</span>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
        {erro && <div className="msg bad">{erro}</div>}
        <div className="modal-acts">
          <button className="ghost" onClick={onFechar} disabled={proc}>Cancelar</button>
          <button className="cta" onClick={gerar} disabled={proc}>{proc ? 'Gerando…' : `Gerar ${Object.keys(grupos).length} plano(s)`}</button>
        </div>
      </div>
    </div>
  )
}

/* ---- aba: planos gerados ---- */
function PlanosView({ planos, onMudou }: { planos: Plano[]; onMudou: () => void }) {
  const copiar = (p: Plano) => {
    const linhas = (p.itens || []).map(i => `- ${i.descricao} — ${num(i.quantidade, 2)} ${i.unidade}`).join('\n')
    const txt = `Pedido de compra — ${p.fornecedor}\nObra ${p.obra} · ${new Date(p.criado_em).toLocaleDateString('pt-BR')}\n\n${linhas}\n\nTotal estimado: ${brl(p.valor_total)}`
    navigator.clipboard?.writeText(txt)
  }
  if (!authAtiva) return <div className="empty">Os planos de compra exigem login (Supabase). Rode o app em produção.</div>
  if (planos.length === 0) return <div className="empty">Nenhum plano gerado ainda. Selecione insumos em "Necessidades" e gere o plano.</div>
  return (
    <div className="planos-lista">
      {planos.map(p => (
        <div key={p.id} className="ctx-item" style={{ marginBottom: 10 }}>
          <div className="ctx-item-head">
            <div><b>{p.fornecedor}</b>
              <span className={`pill ${p.status === 'pedido' ? 'ok' : 'baixo'}`} style={{ fontSize: 10, marginLeft: 8 }}>{p.status === 'pedido' ? 'Pedido feito' : 'Aberto'}</span>
              <div className="meta">{p.n_itens} itens · {new Date(p.criado_em).toLocaleDateString('pt-BR')}{p.criado_por ? ` · ${p.criado_por}` : ''}</div></div>
            <div className="ctx-v" style={{ fontSize: 16 }}>{brl(p.valor_total)}</div>
          </div>
          <div className="ctx-subs">
            {(p.itens || []).map(i => (
              <div key={i.resource_id} className="plano-linha">
                <span className="desc" style={{ fontSize: 13 }}>{i.descricao}</span>
                <b>{num(i.quantidade, 2)}</b><span className="u">{i.unidade}</span>
                <span className="meta" style={{ minWidth: 78, textAlign: 'right' }}>{brl(i.valor)}</span>
              </div>
            ))}
          </div>
          <div className="modal-acts" style={{ marginTop: 10 }}>
            <button className="ghost" onClick={() => copiar(p)}>Copiar lista</button>
            {p.status !== 'pedido' && <button className="ghost" onClick={async () => { await cancelarPlano(p.id); onMudou() }} style={{ color: 'var(--ruptura)' }}>Cancelar</button>}
            {p.status !== 'pedido' && <button className="cta" onClick={async () => { await marcarPedido(p.id); onMudou() }}>Marcar como pedido</button>}
          </div>
        </div>
      ))}
    </div>
  )
}
