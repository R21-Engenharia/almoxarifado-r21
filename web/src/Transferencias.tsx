import { useEffect, useMemo, useState } from 'react'
import {
  api, brl, num, familiaCurta, novaChave, MOTIVOS_SAIDA,
  type Item, type Embalagem, type Obra, type Transferencia, type TransfStatus, type Desmobilizacao, type DecisaoDesmob,
} from './api'
import { AddInsumoModal, linhaParaEscrita, resumoLinha, type CestaLinha } from './AddInsumo'
import Loader from './Loader'

// Transferência entre obras: sai da origem (saída avulsa) -> "em trânsito" -> entra no
// destino quando alguém da obra de destino confirma o recebimento (entrada avulsa com o
// custo da origem). Encerrar obra: decide o destino de cada saldo e executa em lote.

const ST: Record<TransfStatus, string> = {
  enviando: 'envio incompleto', falhou: 'não saiu', em_transito: 'em trânsito', recebendo: 'recebimento sem confirmação',
  recebida: 'recebida', recebida_divergencia: 'recebida com divergência', cancelando: 'cancelamento sem confirmação',
  cancelada: 'cancelada',
}

export default function Transferencias({ obra, obraNome }: { obra: string; obraNome: string }) {
  const [aba, setAba] = useState<'andamento' | 'nova' | 'encerrar'>('andamento')
  return (
    <>
      <div className="seg req-abas">
        <button className={aba === 'andamento' ? 'on' : ''} onClick={() => setAba('andamento')}>Em andamento</button>
        <button className={aba === 'nova' ? 'on' : ''} onClick={() => setAba('nova')}>Nova transferência</button>
        <button className={aba === 'encerrar' ? 'on' : ''} onClick={() => setAba('encerrar')}>Encerrar obra</button>
      </div>
      {aba === 'andamento' && <Andamento obra={obra} />}
      {aba === 'nova' && <Nova obra={obra} obraNome={obraNome} onCriada={() => setAba('andamento')} />}
      {aba === 'encerrar' && <Encerrar obra={obra} obraNome={obraNome} />}
    </>
  )
}

function Andamento({ obra }: { obra: string }) {
  const [ts, setTs] = useState<Transferencia[] | null>(null)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [receber, setReceber] = useState<Transferencia | null>(null)
  const [agindo, setAgindo] = useState<number | null>(null)
  const carregar = () => api.transferencias(obra).then(r => setTs(r.transferencias))
    .catch(e => setErr(e instanceof Error ? e.message : String(e)))
  useEffect(() => { setTs(null); setErr(''); carregar() }, [obra]) // eslint-disable-line react-hooks/exhaustive-deps

  const acao = async (t: Transferencia, fn: () => Promise<unknown>, ok: string) => {
    setAgindo(t.id); setMsg('')
    try { await fn(); setMsg('✓ ' + ok) } catch (e) { setMsg('✗ ' + (e instanceof Error ? e.message : String(e))) }
    finally { setAgindo(null); carregar() }
  }
  if (err) return <div className="err">Falha ao carregar: {err}</div>
  if (!ts) return <Loader label="as transferências" />
  const abertas = (t: Transferencia) => ['enviando', 'em_transito', 'recebendo', 'cancelando'].includes(t.status)
  const receberAqui = ts.filter(t => t.sentido === 'entrada' && abertas(t))
  const enviadas = ts.filter(t => t.sentido === 'saida' && abertas(t))
  const fechadas = ts.filter(t => !abertas(t))

  const card = (t: Transferencia) => (
    <div key={t.id} className={`req-card st-${t.status}`}>
      <div className="req-card-top">
        <b>#{t.id} · {t.origem_nome} → {t.destino_nome}</b>
        <span className={`st-pill st-${t.status}`}>{ST[t.status] || t.status}</span>
      </div>
      <div className="meta">{t.criado_por} · {new Date(t.criado_em).toLocaleString('pt-BR')}{t.obs ? ` · “${t.obs}”` : ''}</div>
      <ul className="req-itens">
        {t.itens.map((l, n) => (
          <li key={n}>
            <span>{l.descricao}{l.variante && <em className="cesta-var"> · {l.variante}</em>}</span>
            <b>{num(l.qtd_enviada || 0, 2)}{l.qtd_enviada < l.quantidade ? ` de ${num(l.quantidade, 2)}` : ''} {l.unidade}
              {l.qtd_recebida != null && <em className={l.qtd_recebida < l.qtd_enviada ? 'reserva-hint' : 'req-entregue'}> · recebido {num(l.qtd_recebida, 2)}</em>}</b>
          </li>
        ))}
      </ul>
      {t.obs_recebimento && <div className="meta">Recebimento: {t.obs_recebimento}</div>}
      {t.erro && <div className="msg bad">{t.erro}</div>}
      <div className="req-acts">
        {t.sentido === 'entrada' && t.status === 'em_transito' && <button className="cta" onClick={() => setReceber(t)}>Confirmar recebimento</button>}
        {t.sentido === 'entrada' && t.status === 'recebendo' &&
          <button className="cta" disabled={agindo === t.id} onClick={() => acao(t, () => api.transfReceber(obra, t.id, []), 'Recebimento concluído.')}>Retomar recebimento</button>}
        {t.sentido === 'saida' && t.status === 'enviando' && <>
          <button className="cta" disabled={agindo === t.id || !t.chave} onClick={() => acao(t, () => api.transfCriar(obra, t.destino,
            t.itens.map(l => ({ resource_id: l.resource_id, quantidade: l.quantidade, unidade: l.unidade || undefined, descricao: l.descricao || undefined,
              detail_id: l.detail_id, trademark_id: l.trademark_id, variante: l.variante || undefined })), t.chave || ''), 'Envio concluído.')}>Tentar enviar o resto</button>
          {t.itens.some(l => l.qtd_enviada > 0) &&
            <button className="ghost" disabled={agindo === t.id} onClick={() => acao(t, () => api.transfSeguir(obra, t.id), 'Seguiu com os itens que saíram.')}>Seguir só com o que saiu</button>}
        </>}
        {t.sentido === 'saida' && ['em_transito', 'enviando', 'cancelando'].includes(t.status) &&
          <button className="ghost" disabled={agindo === t.id} onClick={() => {
            if (t.status !== 'cancelando' && !confirm('Cancelar a transferência? O que saiu volta para o saldo desta obra.')) return
            acao(t, () => api.transfCancelar(obra, t.id), 'Transferência cancelada; material de volta ao saldo.')
          }}>{t.status === 'cancelando' ? 'Retomar cancelamento' : 'Cancelar'}</button>}
      </div>
    </div>
  )

  return (
    <div className="dash">
      {msg && <div className={`msg ${msg.startsWith('✓') ? 'ok' : 'bad'}`} onClick={() => setMsg('')}>{msg}</div>}
      <h3 className="sec-tt">A receber nesta obra ({receberAqui.length})</h3>
      {receberAqui.length === 0 ? <div className="empty">Nada em trânsito para esta obra.</div> : <div className="req-cards">{receberAqui.map(card)}</div>}
      <h3 className="sec-tt">Enviadas, aguardando a outra obra ({enviadas.length})</h3>
      {enviadas.length === 0 ? <div className="empty">Nenhuma transferência enviada em aberto.</div> : <div className="req-cards">{enviadas.map(card)}</div>}
      {fechadas.length > 0 && <>
        <h3 className="sec-tt">Concluídas</h3>
        <div className="req-cards">{fechadas.slice(0, 30).map(card)}</div>
      </>}
      {receber && <ReceberModal obra={obra} t={receber} onClose={() => setReceber(null)}
        onFeito={() => { setReceber(null); setMsg('✓ Recebimento registrado — o material entrou no saldo desta obra.'); carregar() }} />}
    </div>
  )
}

function ReceberModal({ obra, t, onClose, onFeito }: { obra: string; t: Transferencia; onClose: () => void; onFeito: () => void }) {
  const [qtds, setQtds] = useState<string[]>(t.itens.map(l => String(l.qtd_enviada || 0)))
  const [obs, setObs] = useState('')
  const [gravando, setGravando] = useState(false)
  const [erro, setErro] = useState('')
  const divergente = t.itens.some((l, i) => (parseFloat(qtds[i]) || 0) < (l.qtd_enviada || 0))
  const confirmar = async () => {
    setGravando(true); setErro('')
    try {
      await api.transfReceber(obra, t.id, t.itens.map((_, idx) => ({ idx, qtd_recebida: parseFloat(qtds[idx]) || 0 })), obs)
      onFeito()
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)) }
    finally { setGravando(false) }
  }
  return (
    <div className="modal" onClick={() => !gravando && onClose()}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <h3>Receber transferência #{t.id}</h3>
        <p className="warn-txt">Vindo de <b style={{ color: 'var(--text)' }}>{t.origem_nome}</b>. Confira o que chegou: entra no saldo desta obra (Sienge) com o custo da origem.</p>
        <ul className="conf-list">
          {t.itens.filter(l => l.qtd_enviada > 0).map(l => {
            const idx = t.itens.indexOf(l)
            return (
              <li key={idx}>
                <span>{l.descricao}{l.variante && <em className="cesta-var"> · {l.variante}</em>}<em className="cesta-emb"> · enviado {num(l.qtd_enviada, 2)}</em></span>
                <b><input type="number" min={0} max={l.qtd_enviada} step="any" className="qtd" value={qtds[idx]}
                  onChange={e => setQtds(q => q.map((v, i) => i === idx ? e.target.value : v))} /> {l.unidade}</b>
              </li>
            )
          })}
        </ul>
        {divergente && <div className="campo"><span>O que aconteceu com a diferença? *</span>
          <input value={obs} onChange={e => setObs(e.target.value)} placeholder="ex.: 2 sacos rasgados no transporte" /></div>}
        {erro && <div className="msg bad">{erro}</div>}
        <div className="modal-acts">
          <button className="ghost" onClick={onClose} disabled={gravando}>Cancelar</button>
          <button className="cta" onClick={confirmar} disabled={gravando || (divergente && !obs.trim())}>{gravando ? 'Gravando no Sienge…' : 'Confirmar recebimento'}</button>
        </div>
      </div>
    </div>
  )
}

function Nova({ obra, obraNome, onCriada }: { obra: string; obraNome: string; onCriada: () => void }) {
  const [obras, setObras] = useState<Obra[]>([])
  const [destino, setDestino] = useState('')
  const [itens, setItens] = useState<Item[]>([])
  const [q, setQ] = useState('')
  const [cesta, setCesta] = useState<CestaLinha[]>([])
  const [embMap, setEmbMap] = useState<Record<string, Embalagem[]>>({})
  const [sel, setSel] = useState<Item | null>(null)
  const [obs, setObs] = useState('')
  const [confirmar, setConfirmar] = useState(false)
  const [gravando, setGravando] = useState(false)
  const [erro, setErro] = useState('')
  const [chave, setChave] = useState<string | null>(null)
  useEffect(() => { if (cesta.length === 0) setChave(null) }, [cesta])
  useEffect(() => { setChave(null) }, [destino, obra])

  useEffect(() => {
    api.transfObras().then(os => setObras(os.filter(o => o.prevision_id !== obra))).catch(() => {})
    api.catalogo(obra).then(r => setItens(r.itens))
    api.embalagens().then(r => {
      const m: Record<string, Embalagem[]> = {}
      r.embalagens.forEach(e => { (m[e.resource_id] ||= []).push(e) })
      setEmbMap(m)
    }).catch(() => {})
    setCesta([])
  }, [obra])
  const filtrados = useMemo(() => {
    const ql = q.toLowerCase().trim()
    return itens.filter(i => i.saldo > 0 && (!ql || i.descricao.toLowerCase().includes(ql) || i.resource_id === ql)).slice(0, 100)
  }, [itens, q])

  const gravar = async () => {
    const k = chave ?? novaChave()
    setChave(k); setErro(''); setGravando(true)
    try {
      await api.transfCriar(obra, destino, cesta.map(linhaParaEscrita), k, obs.trim() || undefined)
      setCesta([]); setConfirmar(false); onCriada()
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)) }
    finally { setGravando(false) }
  }
  const nomeDestino = obras.find(o => o.prevision_id === destino)?.nome || ''

  return (
    <div className="dash req">
      <div className="req-topo">
        <div className="campo"><span>Obra de destino *</span>
          <select className="obra-sel" value={destino} onChange={e => setDestino(e.target.value)}>
            <option value="">escolha…</option>
            {obras.map(o => <option key={o.prevision_id} value={o.prevision_id}>{o.nome}</option>)}
          </select></div>
        <div className="campo"><span>Observação</span><input value={obs} onChange={e => setObs(e.target.value)} placeholder="ex.: sobra do térreo para a Holmes" /></div>
      </div>
      <div className="op-toolbar">
        <input className="busca" placeholder="buscar insumo com saldo para transferir…" value={q} onChange={e => setQ(e.target.value)} />
      </div>
      <div className="tbl-wrap">
        <table className="tbl operar-tbl">
          <thead><tr><th>Insumo</th><th className="r">Saldo</th><th className="r"></th></tr></thead>
          <tbody>
            {filtrados.map(i => (
              <tr key={i.resource_id}>
                <td><div className="desc">{i.descricao}</div><div className="meta">{i.macro}{i.familia ? ` · ${familiaCurta(i.familia)}` : ''} · #{i.resource_id}</div></td>
                <td className="r">{num(i.saldo, 2)} <span className="u">{i.unidade}</span></td>
                <td className="r"><button className="mini" onClick={() => setSel(i)}>+ Transferir</button></td>
              </tr>
            ))}
            {filtrados.length === 0 && <tr><td colSpan={3}>{itens.length === 0 ? <Loader label="os insumos da obra" /> : <div className="empty">Nenhum insumo com saldo nesse filtro.</div>}</td></tr>}
          </tbody>
        </table>
      </div>
      {sel && <AddInsumoModal obra={obra} op="baixa" item={sel} embalagens={embMap[sel.resource_id] || []} verbo="Transferir"
        onEmbSalva={() => {}} onAdd={l => setCesta(c => [...c.filter(x => x.key !== l.key), l])} onClose={() => setSel(null)} />}
      {cesta.length > 0 && (
        <div className="cesta-bar">
          <div className="cesta-info">{cesta.length} item(ns) para transferir</div>
          <button className="cta" disabled={!destino} onClick={() => { setErro(''); setConfirmar(true) }}>{destino ? 'Revisar transferência' : 'Escolha o destino'}</button>
        </div>
      )}
      {confirmar && (
        <div className="modal" onClick={() => !gravando && setConfirmar(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <h3>{obraNome} → {nomeDestino}</h3>
            <p className="warn-txt">Sai agora do saldo desta obra (Sienge) e fica <b>em trânsito</b> até alguém da {nomeDestino} confirmar o recebimento — aí entra no saldo de lá com o custo daqui.</p>
            <ul className="conf-list">
              {cesta.map(l => (
                <li key={l.key}>
                  <span>{l.item.descricao}{resumoLinha(l) && <em className="cesta-var"> · {resumoLinha(l)}</em>}</span>
                  <b>{num(l.baseQtd, 2)} {l.unidade} <button className="x" onClick={() => setCesta(c => c.filter(x => x.key !== l.key))}>✕</button></b>
                </li>
              ))}
            </ul>
            {erro && <div className="msg bad">{erro}</div>}
            <div className="modal-acts">
              <button className="ghost" onClick={() => setConfirmar(false)} disabled={gravando}>Cancelar</button>
              <button className="cta" onClick={gravar} disabled={gravando}>{gravando ? 'Gravando no Sienge…' : erro ? 'Tentar de novo' : 'Confirmar e enviar'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Encerrar({ obra, obraNome }: { obra: string; obraNome: string }) {
  const [d, setD] = useState<Desmobilizacao | null>(null)
  const [err, setErr] = useState('')
  const [dest, setDest] = useState<Record<number, string>>({})
  const [qtd, setQtd] = useState<Record<number, string>>({})
  const [confirmar, setConfirmar] = useState(false)
  const [gravando, setGravando] = useState(false)
  const [res, setRes] = useState<{ ok: boolean; resultados: { grupo: string; ok: boolean; n_itens: number; mensagem: string }[] } | null>(null)
  const [erro, setErro] = useState('')
  const [chave, setChave] = useState<string | null>(null)
  const carregar = () => api.desmobilizacao(obra).then(r => {
    setD(r); setDest({}); setQtd({})
  }).catch(e => setErr(e instanceof Error ? e.message : String(e)))
  useEffect(() => { setD(null); setErr(''); setRes(null); setChave(null); carregar() }, [obra]) // eslint-disable-line react-hooks/exhaustive-deps

  const nomeObra = (pid: string) => d?.obras.find(o => o.prevision_id === pid)?.nome || pid
  const rotulo = (g: string) => g.startsWith('transferir:') ? `Transferir para ${nomeObra(g.split(':')[1])}` : (MOTIVOS_SAIDA[g] || g)
  const decisoes: DecisaoDesmob[] = (d?.itens || []).map((i, n) => ({
    resource_id: i.resource_id, detail_id: i.detail_id, trademark_id: i.trademark_id, descricao: i.descricao,
    variante: i.variante, unidade: i.unidade, quantidade: Math.min(i.saldo, parseFloat(qtd[n] ?? String(i.saldo)) || 0),
    destino: dest[n] || 'manter',
  })).filter(x => x.destino !== 'manter' && x.quantidade > 0)
  const grupos = useMemo(() => {
    const m = new Map<string, { n: number; valor: number }>()
    decisoes.forEach(x => {
      const it = d?.itens.find(i => i.resource_id === x.resource_id && i.detail_id === x.detail_id && i.trademark_id === x.trademark_id)
      const g = m.get(x.destino) || { n: 0, valor: 0 }
      m.set(x.destino, { n: g.n + 1, valor: g.valor + x.quantidade * (it?.custo_unit || 0) })
    })
    return Array.from(m.entries())
  }, [decisoes, d])

  const executar = async () => {
    const k = chave ?? novaChave()
    setChave(k); setGravando(true); setErro('')
    try {
      const r = await api.desmobExecutar(obra, decisoes, k)
      setRes(r); setConfirmar(false)
      if (r.ok) { setChave(null); carregar() }
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)) }
    finally { setGravando(false) }
  }

  if (err) return <div className="err">Falha ao carregar: {err}</div>
  if (!d) return <Loader label="o saldo da obra" dica="Lendo o inventário do Sienge…" />
  const aplicarSugestoes = () => setDest(Object.fromEntries(d.itens.map((i, n) => [n, i.sugestao || dest[n] || 'manter'])))
  const tudo = (v: string) => setDest(Object.fromEntries(d.itens.map((_, n) => [n, v])))

  return (
    <div className="dash">
      <p className="nota-eap">Encerramento de obra: para cada saldo, escolha o destino — transferir para outra obra (a outra obra confirma o recebimento),
        devolver ao fornecedor, vender, doar ou baixar como perda. Os grupos são executados um a um; repetir não duplica nada.
        Só aparecem as obras que o app conhece.</p>
      <div className="kpi-row">
        <div className="kpi-card"><div className="kpi-rot">Saldo em {obraNome}</div><div className="kpi-big">{brl(d.valor_total)}</div><div className="kpi-hint">{d.itens.length} item(ns) com saldo</div></div>
        <div className="kpi-card"><div className="kpi-rot">Decidido</div><div className="kpi-big">{decisoes.length}</div><div className="kpi-hint">{brl(grupos.reduce((a, [, g]) => a + g.valor, 0))}</div></div>
      </div>
      {res && (
        <div className={`msg ${res.ok ? 'ok' : 'bad'}`}>
          {res.resultados.map(r => <div key={r.grupo}>{r.ok ? '✓' : '✗'} {rotulo(r.grupo)} ({r.n_itens}): {r.mensagem}</div>)}
          {!res.ok && <div>Corrija e execute de novo — o que já foi feito não se repete.</div>}
        </div>
      )}
      <div className="chips">
        <button onClick={aplicarSugestoes}>Aplicar sugestões</button>
        <button onClick={() => tudo('manter')}>Limpar</button>
      </div>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>Insumo</th><th className="r">Saldo</th><th className="r">Valor</th><th className="r">Quantidade</th><th>Destino</th></tr></thead>
          <tbody>
            {d.itens.map((i, n) => (
              <tr key={`${i.resource_id}|${i.detail_id}|${i.trademark_id}`}>
                <td><div className="desc">{i.descricao}</div>
                  <div className="meta">#{i.resource_id}{i.variante ? ` · ${i.variante}` : ''}
                    {i.consumo_outras[0] && ` · ${i.consumo_outras[0].nome} consome ${num(i.consumo_outras[0].consumo_dia, 2)}/dia`}</div></td>
                <td className="r">{num(i.saldo, 2)} {i.unidade}</td>
                <td className="r">{brl(i.valor)}</td>
                <td className="r"><input type="number" className="qtd" min={0} max={i.saldo} step="any"
                  value={qtd[n] ?? String(i.saldo)} onChange={e => setQtd(q => ({ ...q, [n]: e.target.value }))} /></td>
                <td>
                  <select className="obra-sel" value={dest[n] || 'manter'} onChange={e => setDest(x => ({ ...x, [n]: e.target.value }))}>
                    <option value="manter">— manter —</option>
                    {d.obras.map(o => <option key={o.prevision_id} value={`transferir:${o.prevision_id}`}>Transferir → {o.nome}</option>)}
                    {d.motivos.map(m => <option key={m} value={m}>{MOTIVOS_SAIDA[m] || m}</option>)}
                  </select>
                </td>
              </tr>
            ))}
            {d.itens.length === 0 && <tr><td colSpan={5}><div className="empty">Esta obra não tem saldo em estoque.</div></td></tr>}
          </tbody>
        </table>
      </div>
      {decisoes.length > 0 && (
        <div className="cesta-bar">
          <div className="cesta-info">{decisoes.length} item(ns) em {grupos.length} grupo(s)</div>
          <button className="cta" onClick={() => { setErro(''); setConfirmar(true) }}>Revisar e executar</button>
        </div>
      )}
      {confirmar && (
        <div className="modal" onClick={() => !gravando && setConfirmar(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <h3>Executar encerramento</h3>
            <p className="warn-txt">Cada grupo grava no Sienge: transferências saem desta obra e ficam em trânsito; as demais são saídas avulsas com o motivo.</p>
            <ul className="conf-list">
              {grupos.map(([g, v]) => <li key={g}><span>{rotulo(g)}</span><b>{v.n} item(ns) · {brl(v.valor)}</b></li>)}
            </ul>
            {erro && <div className="msg bad">{erro}</div>}
            <div className="modal-acts">
              <button className="ghost" onClick={() => setConfirmar(false)} disabled={gravando}>Cancelar</button>
              <button className="cta" onClick={executar} disabled={gravando}>{gravando ? 'Gravando no Sienge…' : 'Confirmar e executar'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
