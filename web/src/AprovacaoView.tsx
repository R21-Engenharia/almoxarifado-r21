import { useEffect, useMemo, useState } from 'react'
import { authAtiva } from './supabase'
import { api, num, type Item, type InsumoOrcamento, type SubetapaOrcada } from './api'
import {
  listar, criar, decidir, reenviar, eventos, meuPapel,
  STATUS_SOLIC, STATUS_TONE,
  type Solicitacao, type SolicStatus, type SolicEvento,
} from './aprovacao'

type Aba = SolicStatus | 'todas'

export default function Aprovacoes({ obra, obraNome }: { obra: string; obraNome: string }) {
  const [lista, setLista] = useState<Solicitacao[]>([])
  const [papel, setPapel] = useState('')
  const [aba, setAba] = useState<Aba>('aguardando_engenharia')
  const [nova, setNova] = useState(false)
  const [detalhe, setDetalhe] = useState<Solicitacao | null>(null)
  const [err, setErr] = useState('')

  const carregar = () => listar(obra).then(setLista).catch(e => setErr(e instanceof Error ? e.message : String(e)))
  useEffect(() => { setErr(''); carregar(); meuPapel().then(setPapel) }, [obra])

  const podeEng = papel === 'engenheiro' || papel === 'admin'
  const podePlan = papel === 'planejamento' || papel === 'admin'

  const cont = useMemo(() => {
    const c: Record<string, number> = {}
    lista.forEach(s => { c[s.status] = (c[s.status] || 0) + 1 })
    return c
  }, [lista])

  const filtradas = aba === 'todas' ? lista : lista.filter(s => s.status === aba)
  // já aprovado no BOX21 por (resource, subetapa) — para a régua
  const jaAprov = (s: Solicitacao) => lista
    .filter(x => x.resource_id === s.resource_id && x.sheet_item_id === s.sheet_item_id
      && x.id !== s.id && (x.status === 'aguardando_planejamento' || x.status === 'em_compras'))
    .reduce((a, x) => a + Number(x.quantidade), 0)

  if (!authAtiva) return <div className="empty">As aprovações exigem login (Supabase). Rode o app em produção.</div>

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
          <div><h3>Solicitações de material</h3><span className="chart-sub">Dupla aprovação · Engenharia → Planejamento → Compras{papel ? ` · você: ${papel}` : ''}</span></div>
          <button className="cta" onClick={() => setNova(true)}>+ Nova solicitação</button>
        </div>
        <div className="chips">
          {(['aguardando_engenharia', 'aguardando_planejamento', 'em_compras', 'devolvida', 'reprovada', 'todas'] as Aba[]).map(a =>
            <button key={a} className={aba === a ? 'on' : ''} onClick={() => setAba(a)}>{a === 'todas' ? 'Todas' : STATUS_SOLIC[a]}</button>)}
        </div>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Solicitação</th><th>Subetapa</th><th className="r">Qtd</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {filtradas.map(s => (
                <tr key={s.id} style={{ cursor: 'pointer' }} onClick={() => setDetalhe(s)}>
                  <td><div className="desc">{s.insumo_desc}{s.divergencia && <span className="pill ruptura" style={{ fontSize: 10, marginLeft: 8 }}>divergência</span>}</div>
                    <div className="meta">#{s.resource_id} · {new Date(s.criado_em).toLocaleDateString('pt-BR')} · {s.criado_por}</div></td>
                  <td><div className="desc" style={{ fontSize: 13 }}>{s.subetapa_desc || s.wbs_code || '—'}</div></td>
                  <td className="r">{num(s.quantidade, 2)} {s.unidade}</td>
                  <td><span className={`pill ${STATUS_TONE[s.status]}`}>{STATUS_SOLIC[s.status]}</span></td>
                  <td className="r"><button className="mini">Analisar</button></td>
                </tr>
              ))}
              {filtradas.length === 0 && <tr><td colSpan={5}><div className="empty">Nenhuma solicitação neste status.</div></td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {nova && <NovaModal obra={obra} obraNome={obraNome} onSalvo={() => { setNova(false); carregar() }} onFechar={() => setNova(false)} />}
      {detalhe && <DetalheModal s={detalhe} jaAprovBox21={jaAprov(detalhe)} podeEng={podeEng} podePlan={podePlan}
        onAcao={() => { setDetalhe(null); carregar() }} onFechar={() => setDetalhe(null)} />}
    </div>
  )
}

function Kpi({ rot, v, tone }: { rot: string; v: number; tone: string }) {
  return <div className="kpi-card"><div className="kpi-rot">{rot}</div><div className="kpi-big" style={tone === 'critico' && v > 0 ? { color: 'var(--critico)' } : undefined}>{v}</div></div>
}

/* ---------------- Nova solicitação ---------------- */
function NovaModal({ obra, obraNome, onSalvo, onFechar }: { obra: string; obraNome: string; onSalvo: () => void; onFechar: () => void }) {
  const [q, setQ] = useState('')
  const [achados, setAchados] = useState<Item[]>([])
  const [insumo, setInsumo] = useState<Item | null>(null)
  const [ctx, setCtx] = useState<InsumoOrcamento | null>(null)
  const [sub, setSub] = useState<SubetapaOrcada | null>(null)
  const [qtd, setQtd] = useState('')
  const [just, setJust] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  useEffect(() => {
    const t = setTimeout(() => { if (q.trim().length >= 2) api.insumos(obra, q).then(r => setAchados(r.itens.slice(0, 8))) }, 300)
    return () => clearTimeout(t)
  }, [q, obra])

  const escolher = async (i: Item) => {
    setInsumo(i); setAchados([]); setQ(i.descricao); setCtx(null); setSub(null)
    try { const c = await api.insumoOrcamento(obra, i.resource_id); setCtx(c); if (c.subetapas[0]) setSub(c.subetapas[0]) }
    catch (e) { setErro(String(e)) }
  }
  const divergencia = !!insumo && !!ctx && ctx.subetapas.length === 0

  const salvar = async () => {
    if (!insumo || !qtd) { setErro('Escolha o insumo e a quantidade.'); return }
    if (!sub && !divergencia) { setErro('Escolha a subetapa.'); return }
    if (divergencia && !just.trim()) { setErro('Insumo sem orçamento na obra — justifique.'); return }
    setSalvando(true); setErro('')
    try {
      await criar({
        obra, obra_nome: obraNome, resource_id: insumo.resource_id, insumo_desc: insumo.descricao,
        unidade: insumo.unidade, quantidade: parseFloat(qtd),
        sheet_item_id: sub?.sheet_item_id ?? null, wbs_code: sub?.wbs_code ?? null,
        subetapa_desc: sub?.descricao ?? null, qtd_orcada: sub?.qtd_orcada ?? null,
        divergencia, justificativa: just.trim() || null,
      })
      onSalvo()
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)) } finally { setSalvando(false) }
  }

  return (
    <div className="modal" onClick={() => !salvando && onFechar()}>
      <div className="modal-card" onClick={e => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <h3>Nova solicitação de material</h3>
        <label className="campo"><span>Insumo *</span>
          <input value={q} onChange={e => { setQ(e.target.value); setInsumo(null) }} placeholder="buscar insumo…" /></label>
        {achados.length > 0 && !insumo && (
          <div className="ach-list">{achados.map(i =>
            <button key={i.resource_id} className="ach" onClick={() => escolher(i)}>
              <span>{i.descricao}</span><span className="meta">#{i.resource_id} · saldo {num(i.saldo, 2)} {i.unidade}</span></button>)}</div>
        )}
        {insumo && !ctx && <div className="loading" style={{ padding: 12 }}>Buscando orçamento…</div>}
        {ctx && (
          <>
            {divergencia
              ? <div className="msg bad">⚠ Este insumo <b>não está orçado</b> em nenhuma subetapa desta obra. Requer justificativa.</div>
              : <label className="campo"><span>Subetapa (onde o insumo está orçado)</span>
                  <select value={sub?.wbs_code || ''} onChange={e => setSub(ctx.subetapas.find(s => s.wbs_code === e.target.value) || null)}>
                    {ctx.subetapas.map(s => <option key={s.wbs_code} value={s.wbs_code}>{s.descricao} — orçado {num(s.qtd_orcada, 2)} {ctx.unidade}</option>)}
                  </select></label>}
            <div className="req-topo">
              <label className="campo"><span>Quantidade solicitada * ({ctx.unidade})</span>
                <input type="number" min={0} step="any" value={qtd} onChange={e => setQtd(e.target.value)} /></label>
              <div className="campo"><span>Saldo em estoque</span><div style={{ padding: '11px 0', fontWeight: 700 }}>{num(ctx.saldo, 2)} {ctx.unidade}</div></div>
            </div>
            <label className="campo"><span>Justificativa {divergencia ? '*' : '(opcional)'}</span>
              <input value={just} onChange={e => setJust(e.target.value)} placeholder="motivo da solicitação" /></label>
          </>
        )}
        {erro && <div className="msg bad">{erro}</div>}
        <div className="modal-acts"><button className="ghost" onClick={onFechar} disabled={salvando}>Cancelar</button>
          <button className="cta" onClick={salvar} disabled={salvando || !ctx}>{salvando ? 'Enviando…' : 'Enviar para Engenharia'}</button></div>
      </div>
    </div>
  )
}

/* ---------------- Detalhe / visualizador de contexto ---------------- */
function DetalheModal({ s, jaAprovBox21, podeEng, podePlan, onAcao, onFechar }: {
  s: Solicitacao; jaAprovBox21: number; podeEng: boolean; podePlan: boolean; onAcao: () => void; onFechar: () => void
}) {
  const [evs, setEvs] = useState<SolicEvento[]>([])
  const [obs, setObs] = useState('')
  const [proc, setProc] = useState(false)
  const [erro, setErro] = useState('')
  useEffect(() => { eventos(s.id).then(setEvs) }, [s.id])

  const etapa: 'engenharia' | 'planejamento' | null =
    s.status === 'aguardando_engenharia' && podeEng ? 'engenharia'
      : s.status === 'aguardando_planejamento' && podePlan ? 'planejamento' : null

  const orcado = Number(s.qtd_orcada || 0)
  const totalApos = jaAprovBox21 + Number(s.quantidade)
  const saldoApos = orcado - totalApos
  const estouro = orcado > 0 && saldoApos < 0

  const agir = async (acao: 'aprovada' | 'reprovada' | 'devolvida') => {
    if (!etapa) return
    if ((acao === 'reprovada' || acao === 'devolvida') && !obs.trim()) { setErro('Informe o motivo.'); return }
    setProc(true); setErro('')
    try { await decidir(s, etapa, acao, obs.trim() || undefined); onAcao() }
    catch (e) { setErro(e instanceof Error ? e.message : String(e)); setProc(false) }
  }
  const reenv = async () => { setProc(true); try { await reenviar(s, obs.trim() || undefined); onAcao() } catch (e) { setErro(String(e)); setProc(false) } }

  return (
    <div className="modal" onClick={() => !proc && onFechar()}>
      <div className="modal-card ctx" onClick={e => e.stopPropagation()} style={{ maxWidth: 640 }}>
        <div className="ctx-head">
          <div><h3 style={{ margin: 0 }}>{s.insumo_desc}</h3>
            <div className="chart-sub">{s.obra_nome} · {s.subetapa_desc || s.wbs_code || 'sem subetapa'}</div></div>
          <span className={`pill ${STATUS_TONE[s.status]}`}>{STATUS_SOLIC[s.status]}</span>
        </div>

        {s.divergencia && <div className="msg bad" style={{ marginTop: 10 }}>⚠ <b>Divergência:</b> insumo não previsto no orçamento desta subetapa. Justificativa: {s.justificativa || '—'}</div>}

        <div className="ctx-cols">
          <div className="ctx-box">
            <div className="ctx-lbl">Solicitado</div>
            <div className="ctx-v">{num(s.quantidade, 2)} <span className="u">{s.unidade}</span></div>
            <div className="meta">#{s.resource_id}</div>
          </div>
          <div className="ctx-box">
            <div className="ctx-lbl">Orçado na subetapa</div>
            <div className="ctx-v">{s.qtd_orcada != null ? `${num(s.qtd_orcada, 2)} ` : '—'}<span className="u">{s.unidade}</span></div>
            <div className="meta">{s.wbs_code || ''}</div>
          </div>
        </div>

        <div className="ctx-regua">
          <ReguaLinha l="Orçado (subetapa)" v={orcado} u={s.unidade} />
          <ReguaLinha l="Já apropriado (NF)" v={null} u={s.unidade} hint="coleta de NF em andamento" />
          <ReguaLinha l="Já aprovado no BOX21 (subetapa)" v={jaAprovBox21} u={s.unidade} />
          <ReguaLinha l="Solicitação atual" v={Number(s.quantidade)} u={s.unidade} forte />
          <ReguaLinha l="Total após aprovação" v={totalApos} u={s.unidade} />
          <ReguaLinha l="Saldo após aprovação" v={orcado ? saldoApos : null} u={s.unidade} tone={estouro ? 'ruptura' : saldoApos === 0 ? 'ok' : ''} />
        </div>
        {estouro && <div className="msg bad">⚠ A solicitação <b>estoura o orçado</b> da subetapa em {num(Math.abs(saldoApos), 2)} {s.unidade}.</div>}

        <div className="ctx-time">
          <div className="ctx-lbl">Linha do tempo</div>
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
            <label className="campo"><span>Observação</span><input value={obs} onChange={e => setObs(e.target.value)} placeholder="observação da decisão" /></label>
            <div className="modal-acts">
              <button className="ghost" onClick={() => agir('reprovada')} disabled={proc} style={{ color: 'var(--ruptura)' }}>Reprovar</button>
              <button className="ghost" onClick={() => agir('devolvida')} disabled={proc}>Devolver p/ ajuste</button>
              <button className="cta" onClick={() => agir('aprovada')} disabled={proc}>
                {proc ? '…' : etapa === 'engenharia' ? 'Aprovar (Engenharia)' : 'Aprovar → Compras'}</button>
            </div>
          </>
        )}
        {s.status === 'devolvida' && <div className="modal-acts"><button className="cta" onClick={reenv} disabled={proc}>Reenviar para Engenharia</button></div>}
        {erro && <div className="msg bad">{erro}</div>}
        {!etapa && s.status !== 'devolvida' && <div className="modal-acts"><button className="ghost" onClick={onFechar}>Fechar</button></div>}
      </div>
    </div>
  )
}

function ReguaLinha({ l, v, u, forte, tone, hint }: { l: string; v: number | null; u: string | null; forte?: boolean; tone?: string; hint?: string }) {
  return (
    <div className={`regua-l ${forte ? 'forte' : ''}`}>
      <span>{l}{hint && <span className="meta"> · {hint}</span>}</span>
      <b style={tone === 'ruptura' ? { color: 'var(--ruptura)' } : tone === 'ok' ? { color: 'var(--ok)' } : undefined}>
        {v == null ? '—' : `${num(v, 2)} ${u || ''}`}</b>
    </div>
  )
}
