import { useEffect, useMemo, useState } from 'react'
import { authAtiva } from './supabase'
import Loader from './Loader'
import { api, num, type InsumoOrcamento, type SolicSienge, type SolicSiengeItem, type ItemSubetapa } from './api'
import {
  overlays, eventos, meuPapel, aprovar, reprovar, devolver,
  STATUS_SOLIC, STATUS_TONE,
  type AprovOverlay, type SolicStatus, type AprovEvento,
} from './aprovacao'

type Aba = SolicStatus | 'todas'

// "Cape Town - Custos Diretos" -> "Custos Diretos" (mostra só a UC)
const ucCurta = (s: string) => { const p = s.split(' - '); return p.length > 1 ? p.slice(1).join(' - ') : s }

// linha da tabela = 1 solicitação do Sienge + o estado da aprovação no BOX21
interface Linha {
  pr: number
  obra: string
  requester: string | null
  data: string | null
  notes: string | null
  itens: SolicSiengeItem[]
  status: SolicStatus
  ov: AprovOverlay | null
}

export default function Aprovacoes({ obra, obraNome }: { obra: string; obraNome: string }) {
  const [pend, setPend] = useState<SolicSienge[]>([])
  const [ovs, setOvs] = useState<Record<number, AprovOverlay>>({})
  const [papel, setPapel] = useState('')
  const [aba, setAba] = useState<Aba>('aguardando_engenharia')
  const [detalhe, setDetalhe] = useState<Linha | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [err, setErr] = useState('')

  const carregar = () => {
    setCarregando(true)
    // as duas fontes são independentes: a lista do Sienge NÃO pode sumir só
    // porque a tabela de overlay (Supabase) ainda não existe / falhou.
    api.pendentesSolic(obra)
      .then(p => setPend(p.solicitacoes))
      .catch(e => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setCarregando(false))
    overlays(obra)
      .then(setOvs)
      .catch(e => setErr(prev => prev || `Aprovações (Supabase): ${e instanceof Error ? e.message : String(e)} — rode o schema_aprovacao.sql`))
  }
  useEffect(() => { setErr(''); carregar(); meuPapel().then(setPapel) }, [obra])

  const podeEng = papel === 'engenheiro' || papel === 'admin'
  const podePlan = papel === 'planejamento' || papel === 'admin'

  const linhas: Linha[] = useMemo(() => {
    const prPend = new Set(pend.map(s => s.purchase_request_id))
    const rows: Linha[] = pend.map(s => {
      const ov = ovs[s.purchase_request_id] || null
      return {
        pr: s.purchase_request_id, obra: s.obra, requester: s.requester, data: s.data,
        notes: s.notes, itens: s.itens,
        status: (ov?.status as SolicStatus) || 'aguardando_engenharia', ov,
      }
    })
    // históricas: já saíram do Sienge (autorizadas/reprovadas) mas guardadas no overlay
    for (const ov of Object.values(ovs)) {
      if (!prPend.has(ov.purchase_request_id) && (ov.status === 'em_compras' || ov.status === 'reprovada')) {
        rows.push({
          pr: ov.purchase_request_id, obra: ov.obra, requester: null, data: ov.criado_em,
          notes: null, itens: [], status: ov.status, ov,
        })
      }
    }
    return rows.sort((a, b) => (b.data || '').localeCompare(a.data || ''))
  }, [pend, ovs])

  const cont = useMemo(() => {
    const c: Record<string, number> = {}
    linhas.forEach(l => { c[l.status] = (c[l.status] || 0) + 1 })
    return c
  }, [linhas])

  const filtradas = aba === 'todas' ? linhas : linhas.filter(l => l.status === aba)

  // em produção exige login; no dev local (sem Supabase) libera pra visualização
  if (!authAtiva && !import.meta.env.DEV) return <div className="empty">As aprovações exigem login (Supabase). Rode o app em produção.</div>
  if (carregando && !pend.length && !Object.keys(ovs).length)
    return <Loader label="as aprovações" dica="Lendo as solicitações de compra pendentes no Sienge…" />

  return (
    <div className="dash">
      <div className="kpi-row eq-kpis">
        <Kpi rot="Aguardando Engenharia" v={cont.aguardando_engenharia || 0} tone="baixo" />
        <Kpi rot="Aguardando Planejamento" v={cont.aguardando_planejamento || 0} tone="critico" />
        <Kpi rot="Enviadas p/ Compras" v={cont.em_compras || 0} tone="ok" />
        <Kpi rot="Devolvidas" v={cont.devolvida || 0} tone="parado" />
        <Kpi rot="Reprovadas" v={cont.reprovada || 0} tone="" />
      </div>
      {err && <div className="msg bad" onClick={() => setErr('')}>{err}</div>}

      <div className="chart-card">
        <div className="chart-head">
          <div><h3>Solicitações de compra · Sienge</h3>
            <span className="chart-sub">Dupla aprovação · Engenharia → Planejamento → autoriza no Sienge (Compras){papel ? ` · você: ${papel}` : ''}</span></div>
          <button className="ghost" onClick={carregar} disabled={carregando}>{carregando ? 'Atualizando…' : '↻ Atualizar'}</button>
        </div>
        <div className="chips">
          {(['aguardando_engenharia', 'aguardando_planejamento', 'em_compras', 'devolvida', 'reprovada', 'todas'] as Aba[]).map(a =>
            <button key={a} className={aba === a ? 'on' : ''} onClick={() => setAba(a)}>{a === 'todas' ? 'Todas' : STATUS_SOLIC[a]}</button>)}
        </div>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Solicitação (Sienge)</th><th>Itens</th><th>Solicitante</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {filtradas.map(l => (
                <tr key={l.pr} style={{ cursor: 'pointer' }} onClick={() => setDetalhe(l)}>
                  <td><div className="desc">Solicitação #{l.pr}</div>
                    <div className="meta">{l.data ? new Date(l.data).toLocaleDateString('pt-BR') : ''}{l.notes ? ` · ${l.notes}` : ''}</div></td>
                  <td><div className="desc" style={{ fontSize: 13 }}>{l.itens.length ? `${l.itens.length} ${l.itens.length === 1 ? 'item' : 'itens'}` : '—'}</div>
                    {l.itens[0] && <div className="meta">{l.itens[0].descricao}{l.itens.length > 1 ? ` +${l.itens.length - 1}` : ''}</div>}</td>
                  <td><div className="desc" style={{ fontSize: 13 }}>{l.requester || '—'}</div></td>
                  <td><span className={`pill ${STATUS_TONE[l.status]}`}>{STATUS_SOLIC[l.status]}</span></td>
                  <td className="r"><button className="mini">Analisar</button></td>
                </tr>
              ))}
              {filtradas.length === 0 && <tr><td colSpan={5}><div className="empty">{carregando ? 'Carregando solicitações do Sienge…' : 'Nenhuma solicitação neste status.'}</div></td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {detalhe && <DetalheModal l={detalhe} obraNome={obraNome} podeEng={podeEng} podePlan={podePlan}
        onAcao={() => { setDetalhe(null); carregar() }} onFechar={() => setDetalhe(null)} />}
    </div>
  )
}

function Kpi({ rot, v, tone }: { rot: string; v: number; tone: string }) {
  return <div className="kpi-card"><div className="kpi-rot">{rot}</div><div className="kpi-big" style={tone === 'critico' && v > 0 ? { color: 'var(--critico)' } : undefined}>{v}</div></div>
}

/* ---------------- Detalhe / visualizador de contexto ---------------- */
interface ItemCtx { item: SolicSiengeItem; orc: InsumoOrcamento | null; subs: ItemSubetapa[]; loading: boolean; erro?: string }

function DetalheModal({ l, obraNome, podeEng, podePlan, onAcao, onFechar }: {
  l: Linha; obraNome: string; podeEng: boolean; podePlan: boolean; onAcao: () => void; onFechar: () => void
}) {
  const [ctx, setCtx] = useState<ItemCtx[]>([])
  const [evs, setEvs] = useState<AprovEvento[]>([])
  const [obs, setObs] = useState('')
  const [proc, setProc] = useState(false)
  const [erro, setErro] = useState('')

  useEffect(() => { eventos(l.pr).then(setEvs) }, [l.pr])

  // carrega o contexto (orçado + subetapa) de cada item — UM DE CADA VEZ, para
  // não estourar o rate limit do Sienge (429) quando a solicitação tem muitos itens.
  useEffect(() => {
    if (!l.itens.length) return
    let cancelado = false
    setCtx(l.itens.map(item => ({ item, orc: null, subs: [], loading: true })))
    ;(async () => {
      for (let idx = 0; idx < l.itens.length; idx++) {
        const item = l.itens[idx]
        const orc = await api.insumoOrcamento(l.obra, item.resource_id).catch(() => null)
        const subs = await api.itemSubetapa(l.obra, l.pr, item.item_number).then(r => r.subetapas).catch(() => [])
        if (cancelado) return
        setCtx(prev => prev.map((c, i) => i === idx ? { ...c, orc, subs, loading: false } : c))
      }
    })()
    return () => { cancelado = true }
  }, [l.pr]) // eslint-disable-line react-hooks/exhaustive-deps

  const etapa: 'engenharia' | 'planejamento' | null =
    l.status === 'aguardando_engenharia' && podeEng ? 'engenharia'
      : l.status === 'aguardando_planejamento' && podePlan ? 'planejamento' : null

  const agir = async (acao: 'aprovada' | 'reprovada' | 'devolvida') => {
    if (!etapa) return
    if ((acao === 'reprovada' || acao === 'devolvida') && !obs.trim()) { setErro('Informe o motivo.'); return }
    setProc(true); setErro('')
    try {
      if (acao === 'aprovada') await aprovar(l.pr, l.obra, etapa, obs.trim() || undefined)
      else if (acao === 'reprovada') await reprovar(l.pr, l.obra, etapa, obs.trim())
      else await devolver(l.pr, l.obra, etapa, obs.trim())
      onAcao()
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); setProc(false) }
  }

  const algumaDivergencia = ctx.some(c => c.subs.some(s => c.orc && !c.orc.subetapas.find(o => o.wbs_code === s.wbs_code && o.building_unit_id === s.uc_id)))

  return (
    <div className="modal" onClick={() => !proc && onFechar()}>
      <div className="modal-card ctx" onClick={e => e.stopPropagation()} style={{ maxWidth: 720 }}>
        <div className="ctx-head">
          <div><h3 style={{ margin: 0 }}>Solicitação #{l.pr}</h3>
            <div className="chart-sub">{obraNome}{l.requester ? ` · ${l.requester}` : ''}{l.data ? ` · ${new Date(l.data).toLocaleDateString('pt-BR')}` : ''}</div></div>
          <span className={`pill ${STATUS_TONE[l.status]}`}>{STATUS_SOLIC[l.status]}</span>
        </div>
        {l.notes && <div className="meta" style={{ marginTop: 6 }}>Obs. do solicitante: {l.notes}</div>}
        {algumaDivergencia && <div className="msg bad" style={{ marginTop: 10 }}>⚠ <b>Divergência:</b> há item pedido numa subetapa onde ele <b>não está orçado</b>.</div>}

        <div className="ctx-itens">
          {ctx.map((c, i) => <ItemCard key={i} c={c} />)}
          {!l.itens.length && <div className="empty">Solicitação já processada no Sienge — detalhe dos itens indisponível.</div>}
        </div>

        <div className="ctx-time">
          <div className="ctx-lbl">Linha do tempo</div>
          {evs.length === 0 && <div className="meta">Sem eventos ainda.</div>}
          {evs.map(e => (
            <div className="ctx-ev" key={e.id}>
              <span className="ctx-dot" />
              <div><b>{e.acao}</b> <span className="meta">· {e.etapa} · {e.usuario} · {new Date(e.quando).toLocaleString('pt-BR')}</span>
                {e.observacao && <div className="meta">{e.observacao}</div>}</div>
            </div>
          ))}
        </div>

        {etapa && (
          <>
            <label className="campo"><span>Observação {'/ motivo'}</span><input value={obs} onChange={e => setObs(e.target.value)} placeholder="observação da decisão (obrigatória p/ reprovar/devolver)" /></label>
            <div className="modal-acts">
              <button className="ghost" onClick={() => agir('reprovada')} disabled={proc} style={{ color: 'var(--ruptura)' }}>Reprovar (Sienge)</button>
              <button className="ghost" onClick={() => agir('devolvida')} disabled={proc}>Devolver p/ ajuste</button>
              <button className="cta" onClick={() => agir('aprovada')} disabled={proc}>
                {proc ? '…' : etapa === 'engenharia' ? 'Aprovar (Engenharia)' : 'Aprovar → autorizar no Sienge'}</button>
            </div>
            {etapa === 'planejamento' && <div className="meta" style={{ textAlign: 'right' }}>Ao aprovar, a solicitação é <b>autorizada no Sienge</b> e segue para Compras.</div>}
          </>
        )}
        {erro && <div className="msg bad">{erro}</div>}
        {!etapa && <div className="modal-acts"><button className="ghost" onClick={onFechar}>Fechar</button></div>}
      </div>
    </div>
  )
}

function ItemCard({ c }: { c: ItemCtx }) {
  const { item, orc, subs, loading } = c
  return (
    <div className="ctx-item">
      <div className="ctx-item-head">
        <div><b>{item.descricao}</b> <span className="meta">#{item.resource_id}</span></div>
        <div className="ctx-v" style={{ fontSize: 15 }}>{num(item.quantidade, 2)} <span className="u">{item.unidade}</span></div>
      </div>
      {loading && <div className="meta" style={{ padding: '4px 0' }}>carregando orçado e subetapa…</div>}
      {!loading && (
        <>
          <div className="meta">Saldo em estoque: {orc ? `${num(orc.saldo, 2)} ${orc.unidade}` : '—'} · Orçado total: {orc ? `${num(orc.orcado_total, 2)}` : '—'}</div>
          <div className="ctx-subs">
            {subs.length === 0 && <div className="meta">Sem apropriação de subetapa informada na solicitação.</div>}
            {subs.map((s, i) => {
              const oSub = orc?.subetapas.find(o => o.wbs_code === s.wbs_code && o.building_unit_id === s.uc_id) || null
              const pct = s.percentual ?? 0
              const solicitado = item.quantidade * pct / 100
              const orcado = oSub?.qtd_orcada ?? null
              const aprop = oSub?.apropriado_nf ?? null
              const div = !oSub
              const estouro = orcado != null && aprop != null && (aprop + solicitado) > orcado
              return (
                <div key={i} className="ctx-sub">
                  <div className="ctx-sub-top">
                    <span className="ctx-sub-name">
                      <code className="wbs">{s.wbs_code}</code>
                      <span>{s.descricao && s.descricao !== s.wbs_code ? s.descricao : 'sem descrição no orçamento'}
                        {pct !== 100 ? <span className="meta"> · {num(pct, 0)}%</span> : null}</span>
                      {s.uc_nome && <span className="uc-tag">{ucCurta(s.uc_nome)}</span>}
                    </span>
                    {div && <span className="pill ruptura" style={{ fontSize: 10, flexShrink: 0 }}>não orçado aqui</span>}
                  </div>
                  <div className="ctx-sub-nums">
                    <span>Solicitado <b>{num(solicitado, 2)}</b></span>
                    <span>Orçado <b>{orcado != null ? num(orcado, 2) : '—'}</b></span>
                    <span>Apropriado NF <b>{aprop != null ? num(aprop, 2) : '—'}</b></span>
                    <span style={estouro ? { color: 'var(--ruptura)' } : undefined}>
                      Saldo orç. <b>{orcado != null ? num(orcado - (aprop ?? 0) - solicitado, 2) : '—'}</b></span>
                  </div>
                  {estouro && <div className="meta" style={{ color: 'var(--ruptura)' }}>⚠ estoura o orçado da subetapa</div>}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
