import { useEffect, useMemo, useState } from 'react'
import { api, num, familiaCurta, type Item, type Embalagem, type EapRef, type RequisicaoObra, type ReqStatus } from './api'
import { AddInsumoModal, linhaParaEscrita, resumoLinha, type CestaLinha } from './AddInsumo'
import { EapCampo } from './Eap'
import { useEapLista, eapTexto } from './eapDados'
import { FichaView, type Ficha } from './Requisicao'
import Loader from './Loader'

// Pedido de material da obra: solicitada -> aprovada (engenheiro) -> separada -> entregue.
// Aprovada = saldo RESERVADO até a entrega; a baixa no Sienge acontece na entrega.

const ST: Record<ReqStatus, string> = {
  solicitada: 'aguardando engenheiro', aprovada: 'aprovada · reservada', reprovada: 'reprovada',
  separada: 'separada', entregando: 'entrega sem confirmação', parcial: 'entregue em parte',
  entregue: 'entregue', cancelada: 'cancelada',
}

export default function PedidosObra({ obra, obraNome, operador, email, podeOperar }: {
  obra: string; obraNome: string; operador: string; email: string; podeOperar: boolean
}) {
  const [lista, setLista] = useState<RequisicaoObra[] | null>(null)
  const [papel, setPapel] = useState('')
  const [abertas, setAbertas] = useState(true)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [novo, setNovo] = useState(false)
  const [entregar, setEntregar] = useState<RequisicaoObra | null>(null)
  const [ficha, setFicha] = useState<Ficha | null>(null)
  const [agindo, setAgindo] = useState<number | null>(null)
  const [saldos, setSaldos] = useState<Record<string, Item>>({})

  const carregar = () => {
    setErr('')
    api.requisicoes(obra, abertas).then(r => { setLista(r.requisicoes); setPapel(r.papel) })
      .catch(e => setErr(e instanceof Error ? e.message : String(e)))
  }
  useEffect(() => { setLista(null); carregar() }, [obra, abertas]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    api.catalogo(obra).then(r => {
      const m: Record<string, Item> = {}
      r.itens.forEach(i => { m[i.resource_id] = i })
      setSaldos(m)
    }).catch(() => {})
  }, [obra, lista])

  const engenheiro = papel === 'engenheiro' || papel === 'admin'
  const agir = async (r: RequisicaoObra, acao: 'aprovar' | 'reprovar' | 'separar' | 'cancelar') => {
    let obs: string | undefined
    if (acao === 'reprovar' || acao === 'cancelar') {
      const t = prompt(acao === 'reprovar' ? 'Motivo da reprovação:' : 'Motivo do cancelamento (opcional):')
      if (t === null) return
      obs = t.trim()
      if (acao === 'reprovar' && !obs) return
    }
    setAgindo(r.id); setMsg('')
    try { await api.reqAcao(obra, r.id, acao, { obs }); carregar() }
    catch (e) { setMsg('✗ ' + (e instanceof Error ? e.message : String(e))) }
    finally { setAgindo(null) }
  }

  if (ficha) return <FichaView ficha={ficha} rotuloNova="Voltar aos pedidos" onNova={() => { setFicha(null); carregar() }} />
  if (novo) return <NovoPedido obra={obra} onFechar={ok => { setNovo(false); if (ok) { setMsg('✓ Pedido enviado ao engenheiro.'); carregar() } }} />

  return (
    <div className="dash">
      <div className="painel-topo">
        <div className="seg sm">
          <button className={abertas ? 'on' : ''} onClick={() => setAbertas(true)}>Em aberto</button>
          <button className={!abertas ? 'on' : ''} onClick={() => setAbertas(false)}>Todos</button>
        </div>
        <button className="cta" onClick={() => setNovo(true)}>+ Novo pedido de material</button>
      </div>
      {msg && <div className={`msg ${msg.startsWith('✓') ? 'ok' : 'bad'}`} onClick={() => setMsg('')}>{msg}</div>}
      {err && <div className="err">Falha ao carregar: {err}</div>}
      {!lista && !err && <Loader label="os pedidos da obra" />}
      {lista && lista.length === 0 && <div className="empty">Nenhum pedido {abertas ? 'em aberto' : ''} nesta obra.</div>}
      <div className="req-cards">
        {lista?.map(r => {
          const podeCancelar = ['solicitada', 'aprovada', 'separada', 'parcial'].includes(r.status) && (r.criado_por === email || engenheiro)
          return (
            <div key={r.id} className={`req-card st-${r.status}`}>
              <div className="req-card-top">
                <b>Pedido #{r.id}</b>
                <span className={`st-pill st-${r.status}`}>{ST[r.status] || r.status}</span>
              </div>
              <div className="meta">
                {r.solicitante || r.criado_por} · {new Date(r.criado_em).toLocaleDateString('pt-BR')}
                {r.necessario_em && <> · precisa em <b>{new Date(r.necessario_em + 'T12:00').toLocaleDateString('pt-BR')}</b></>}
                {r.terceiro && <> · retira: {r.terceiro}</>}
              </div>
              {r.eap_codigo && <div className="meta">EAP {eapTexto(r)}</div>}
              {r.obs && <div className="meta">“{r.obs}”</div>}
              {r.aprov_obs && <div className="meta">Engenheiro: {r.aprov_obs}</div>}
              <ul className="req-itens">
                {r.itens.map((l, n) => {
                  const s = saldos[l.resource_id]
                  const falta = l.quantidade - (l.qtd_entregue || 0)
                  return (
                    <li key={n}>
                      <span>{l.descricao}{l.variante && <em className="cesta-var"> · {l.variante}</em>}</span>
                      <b>{num(l.quantidade, 2)} {l.unidade}
                        {l.qtd_entregue > 0 && <em className="req-entregue"> · entregue {num(l.qtd_entregue, 2)}</em>}
                        {s && falta > 0 && r.status === 'solicitada' && s.saldo - (s.reservado || 0) < falta &&
                          <em className="reserva-hint"> · disponível só {num(Math.max(0, s.saldo - (s.reservado || 0)), 2)}</em>}</b>
                    </li>
                  )
                })}
              </ul>
              {r.erro && <div className="msg bad">{r.erro}</div>}
              <div className="req-acts">
                {r.status === 'solicitada' && engenheiro && <>
                  <button className="cta" disabled={agindo === r.id} onClick={() => agir(r, 'aprovar')}>Aprovar e reservar</button>
                  <button className="ghost" disabled={agindo === r.id} onClick={() => agir(r, 'reprovar')}>Reprovar</button>
                </>}
                {r.status === 'aprovada' && podeOperar &&
                  <button className="ghost" disabled={agindo === r.id} onClick={() => agir(r, 'separar')}>Marcar como separado</button>}
                {['aprovada', 'separada', 'parcial'].includes(r.status) && podeOperar &&
                  <button className="cta" onClick={() => setEntregar(r)}>Entregar</button>}
                {r.status === 'entregando' && podeOperar &&
                  <button className="cta" onClick={() => setEntregar(r)}>Retomar entrega</button>}
                {podeCancelar && <button className="ghost" disabled={agindo === r.id} onClick={() => agir(r, 'cancelar')}>Cancelar</button>}
              </div>
            </div>
          )
        })}
      </div>

      {entregar && <EntregaModal obra={obra} r={entregar} onClose={() => setEntregar(null)}
        onEntregue={(r, qtds) => {
          setEntregar(null)
          setFicha({
            numero: `PED-${String(r.id).padStart(5, '0')}-${r.n_entregas}`, terceiro: r.terceiro || r.solicitante || r.criado_por,
            solicitante: r.solicitante || r.criado_por, obraNome, data: new Date().toLocaleString('pt-BR'), operador,
            eap: r.eap_codigo ? eapTexto(r) : undefined,
            itens: qtds.map(({ idx, quantidade }) => ({
              descricao: r.itens[idx].descricao || '', qtd: quantidade, unidade: r.itens[idx].unidade || '',
              resource_id: r.itens[idx].resource_id, variante: r.itens[idx].variante || undefined,
            })),
          })
        }} />}
    </div>
  )
}

function EntregaModal({ obra, r, onClose, onEntregue }: {
  obra: string; r: RequisicaoObra; onClose: () => void
  onEntregue: (r: RequisicaoObra, qtds: { idx: number; quantidade: number }[]) => void
}) {
  const retomada = r.status === 'entregando'
  const [qtds, setQtds] = useState<string[]>(r.itens.map(l => String(Math.max(0, l.quantidade - (l.qtd_entregue || 0)))))
  const [gravando, setGravando] = useState(false)
  const [erro, setErro] = useState('')
  const entregas = r.itens.map((_, idx) => ({ idx, quantidade: parseFloat(qtds[idx]) || 0 })).filter(e => e.quantidade > 0)
  const confirmar = async () => {
    setGravando(true); setErro('')
    try {
      // retomada: o servidor usa a entrega já registrada (a mesma quantidade da tentativa anterior)
      const pend = retomada ? (r.entrega_pendente?.itens || []) : entregas
      const resp = await api.reqAcao(obra, r.id, 'entregar', retomada ? {} : { entregas })
      onEntregue(resp.requisicao, pend)
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)) }
    finally { setGravando(false) }
  }
  return (
    <div className="modal" onClick={() => !gravando && onClose()}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <h3>Entregar pedido #{r.id}</h3>
        <p className="warn-txt">{retomada
          ? 'A entrega anterior ficou sem confirmação do Sienge. Retomar reenvia só o que não foi gravado (não duplica).'
          : 'Dá baixa no estoque (Sienge) na subetapa do pedido e gera a ficha para assinatura.'}</p>
        {r.eap_codigo && <p className="conf-eap">Subetapa: <b>{r.eap_codigo}</b> {r.eap_descricao}</p>}
        <ul className="conf-list">
          {r.itens.map((l, idx) => {
            const falta = Math.max(0, l.quantidade - (l.qtd_entregue || 0))
            return (
              <li key={idx}>
                <span>{l.descricao}{l.variante && <em className="cesta-var"> · {l.variante}</em>}
                  <em className="cesta-emb"> · falta {num(falta, 2)} {l.unidade}</em></span>
                <b><input type="number" min={0} max={falta} step="any" className="qtd" disabled={retomada || falta <= 0}
                  value={qtds[idx]} onChange={e => setQtds(q => q.map((v, i) => i === idx ? e.target.value : v))} /> {l.unidade}</b>
              </li>
            )
          })}
        </ul>
        {erro && <div className="msg bad">{erro}</div>}
        <div className="modal-acts">
          <button className="ghost" onClick={onClose} disabled={gravando}>Cancelar</button>
          <button className="cta" onClick={confirmar} disabled={gravando || (!retomada && entregas.length === 0)}>
            {gravando ? 'Gravando no Sienge…' : retomada ? 'Retomar entrega' : 'Confirmar entrega'}</button>
        </div>
      </div>
    </div>
  )
}

function NovoPedido({ obra, onFechar }: { obra: string; onFechar: (ok: boolean) => void }) {
  const [itens, setItens] = useState<Item[]>([])
  const [q, setQ] = useState('')
  const [cesta, setCesta] = useState<CestaLinha[]>([])
  const [embMap, setEmbMap] = useState<Record<string, Embalagem[]>>({})
  const [sel, setSel] = useState<Item | null>(null)
  const [eap, setEap] = useState<EapRef | null>(null)
  const [solicitante, setSolicitante] = useState('')
  const [terceiro, setTerceiro] = useState('')
  const [quando, setQuando] = useState('')
  const [obs, setObs] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')
  const eapLista = useEapLista(obra)

  useEffect(() => {
    api.catalogo(obra).then(r => setItens(r.itens))
    api.embalagens().then(r => {
      const m: Record<string, Embalagem[]> = {}
      r.embalagens.forEach(e => { (m[e.resource_id] ||= []).push(e) })
      setEmbMap(m)
    }).catch(() => {})
  }, [obra])
  const filtrados = useMemo(() => {
    const ql = q.toLowerCase().trim()
    if (!ql) return []
    return itens.filter(i => i.descricao.toLowerCase().includes(ql) || i.resource_id === ql).slice(0, 40)
  }, [itens, q])

  const falta = !cesta.length ? 'Adicione os itens' : eapLista?.tem_mapa && !eap ? 'Escolha a subetapa' : ''
  const enviar = async () => {
    setEnviando(true); setErro('')
    try {
      await api.reqCriar(obra, {
        itens: cesta.map(linhaParaEscrita), eap, solicitante: solicitante.trim() || undefined,
        terceiro: terceiro.trim() || undefined, necessario_em: quando || undefined, obs: obs.trim() || undefined,
      })
      onFechar(true)
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)) }
    finally { setEnviando(false) }
  }

  return (
    <div className="dash req">
      <div className="painel-topo">
        <h3 style={{ margin: 0 }}>Novo pedido de material</h3>
        <button className="ghost" onClick={() => onFechar(false)}>Voltar</button>
      </div>
      <div className="req-topo">
        <div className="campo"><span>Solicitante</span><input value={solicitante} onChange={e => setSolicitante(e.target.value)} placeholder="quem está pedindo" /></div>
        <div className="campo"><span>Quem vai retirar (terceiro / equipe)</span><input value={terceiro} onChange={e => setTerceiro(e.target.value)} placeholder="ex.: Elétrica Silva" /></div>
        <div className="campo"><span>Precisa em</span><input type="date" value={quando} onChange={e => setQuando(e.target.value)} /></div>
      </div>
      <EapCampo obra={obra} valor={eap} onChange={setEap}
        sugerirDe={cesta.map(l => ({ resource_id: l.item.resource_id, detail_id: l.detailId, trademark_id: l.trademarkId }))} />
      <div className="campo"><span>Observação</span><input value={obs} onChange={e => setObs(e.target.value)} placeholder="opcional" /></div>

      <div className="op-toolbar">
        <input className="busca" placeholder="buscar insumo para pedir…" value={q} onChange={e => setQ(e.target.value)} />
      </div>
      {filtrados.length > 0 && (
        <div className="tbl-wrap">
          <table className="tbl operar-tbl">
            <tbody>
              {filtrados.map(i => (
                <tr key={i.resource_id}>
                  <td><div className="desc">{i.descricao}</div><div className="meta">{i.macro}{i.familia ? ` · ${familiaCurta(i.familia)}` : ''} · #{i.resource_id}</div></td>
                  <td className="r">{num(i.saldo - (i.reservado || 0), 2)} <span className="u">{i.unidade} disp.</span></td>
                  <td className="r"><button className="mini" onClick={() => setSel(i)}>+ Pedir</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {cesta.length > 0 && (
        <ul className="conf-list">
          {cesta.map(l => (
            <li key={l.key}>
              <span>{l.item.descricao}{resumoLinha(l) && <em className="cesta-var"> · {resumoLinha(l)}</em>}</span>
              <b>{num(l.baseQtd, 2)} {l.unidade} <button className="x" onClick={() => setCesta(c => c.filter(x => x.key !== l.key))}>✕</button></b>
            </li>
          ))}
        </ul>
      )}
      {erro && <div className="msg bad">{erro}</div>}
      <div className="modal-acts">
        <button className="cta" disabled={!!falta || enviando} onClick={enviar}>{enviando ? 'Enviando…' : falta || 'Enviar pedido ao engenheiro'}</button>
      </div>
      {sel && <AddInsumoModal obra={obra} op="baixa" item={sel} embalagens={embMap[sel.resource_id] || []} verbo="Pedir"
        onEmbSalva={() => {}} onAdd={l => setCesta(c => [...c.filter(x => x.key !== l.key), l])} onClose={() => setSel(null)} />}
    </div>
  )
}
