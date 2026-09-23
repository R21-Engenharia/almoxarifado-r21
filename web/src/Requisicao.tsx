import { useEffect, useMemo, useState } from 'react'
import { api, num, familiaCurta, novaChave, type Item, type Embalagem } from './api'
import { AddInsumoModal, linhaParaEscrita, resumoLinha, type CestaLinha } from './AddInsumo'
import Loader from './Loader'

interface FichaItem { descricao: string; qtd: number; unidade: string; resource_id: string; variante?: string; embalagem?: string }
interface Ficha {
  numero: string; terceiro: string; solicitante: string; obraNome: string
  data: string; operador: string; itens: FichaItem[]
}

export default function Requisicao({ obra, obraNome, operador }: { obra: string; obraNome: string; operador: string }) {
  const [itens, setItens] = useState<Item[]>([])
  const [macros, setMacros] = useState<string[]>([])
  const [macro, setMacro] = useState('')
  const [q, setQ] = useState('')
  const [cesta, setCesta] = useState<CestaLinha[]>([])
  const [embMap, setEmbMap] = useState<Record<string, Embalagem[]>>({})
  const [sel, setSel] = useState<Item | null>(null)
  const [terceiro, setTerceiro] = useState('')
  const [solicitante, setSolicitante] = useState('')
  const [recentes, setRecentes] = useState<string[]>([])
  const [confirmar, setConfirmar] = useState(false)
  const [gravando, setGravando] = useState(false)
  const [erroGravar, setErroGravar] = useState('')
  // chave de idempotência da requisição: repetir a mesma (ex.: após falha de rede) não
  // dá baixa duas vezes. Vale enquanto a cesta existir; renova ao esvaziar ou mudar de obra.
  const [chave, setChave] = useState<string | null>(null)
  useEffect(() => { if (cesta.length === 0) setChave(null) }, [cesta])
  useEffect(() => { setChave(null) }, [obra])
  const [msg, setMsg] = useState('')
  const [ficha, setFicha] = useState<Ficha | null>(null)

  const carregar = () => api.catalogo(obra).then(r => { setItens(r.itens); setMacros(r.macro_ordem) })
  const carregarEmb = () => api.embalagens().then(r => {
    const m: Record<string, Embalagem[]> = {}
    r.embalagens.forEach(e => { (m[e.resource_id] ||= []).push(e) })
    setEmbMap(m)
  }).catch(() => {})
  useEffect(() => { setCesta([]); setFicha(null); carregar(); carregarEmb() }, [obra])
  useEffect(() => {
    api.movimentos(obra).then(r => {
      const ts = Array.from(new Set(r.itens.map(m => (m as { terceiro?: string }).terceiro).filter(Boolean))) as string[]
      setRecentes(ts.slice(0, 30))
    }).catch(() => {})
  }, [obra])

  const filtrados = useMemo(() => {
    const ql = q.toLowerCase().trim()
    return itens.filter(i => (!macro || i.macro === macro) &&
      (!ql || i.descricao.toLowerCase().includes(ql) || i.resource_id === ql)).slice(0, 200)
  }, [itens, macro, q])

  const addLinha = (l: CestaLinha) => setCesta(c => [...c.filter(x => x.key !== l.key), l])
  const removeLinha = (key: string) => setCesta(c => c.filter(x => x.key !== key))
  const naCesta = (rid: string) => cesta.filter(l => l.item.resource_id === rid).length
  const excede = cesta.some(l => l.baseQtd > l.saldoVariante + 1e-6)

  const gravar = async () => {
    const k = chave ?? novaChave()
    setChave(k); setErroGravar(''); setGravando(true)
    try {
      const r = await api.baixa(obra, cesta.map(linhaParaEscrita), k, { terceiro: terceiro.trim(), solicitante: solicitante.trim() || undefined })
      if (r.aviso) setMsg('⚠ ' + r.aviso)
      setFicha({
        numero: `REQ-${(r.auditoria_ids[0] ?? Date.now()).toString().padStart(5, '0')}`,
        terceiro: terceiro.trim(), solicitante: solicitante.trim(), obraNome,
        data: new Date().toLocaleString('pt-BR'), operador,
        itens: cesta.map(l => ({
          descricao: l.item.descricao, qtd: l.baseQtd, unidade: l.unidade, resource_id: l.item.resource_id,
          variante: l.varianteLabel || undefined,
          embalagem: l.embalagemNome ? `${num(l.qtdEmb, 2)} ${l.embalagemNome} × ${num(l.fator, 2)}` : undefined,
        })),
      })
      setCesta([]); setConfirmar(false); carregar()
    } catch (e) { setErroGravar(e instanceof Error ? e.message : String(e)) }
    finally { setGravando(false) }
  }

  if (ficha) return <FichaView ficha={ficha} onNova={() => { setFicha(null); setTerceiro(''); setSolicitante('') }} />

  return (
    <div className="dash req">
      <div className="req-topo">
        <div className="campo">
          <span>Quem está retirando (terceiro / fornecedor) *</span>
          <input value={terceiro} onChange={e => setTerceiro(e.target.value)} list="terceiros" placeholder="ex.: Elétrica Silva LTDA" />
          <datalist id="terceiros">{recentes.map(t => <option key={t} value={t} />)}</datalist>
        </div>
        <div className="campo">
          <span>Solicitante (opcional)</span>
          <input value={solicitante} onChange={e => setSolicitante(e.target.value)} placeholder="quem pediu" />
        </div>
      </div>

      {msg && <div className="msg bad" onClick={() => setMsg('')}>{msg}</div>}

      <div className="op-toolbar">
        <input className="busca" placeholder="buscar insumo para adicionar à lista…" value={q} onChange={e => setQ(e.target.value)} />
      </div>
      <div className="chips">
        <button className={!macro ? 'on' : ''} onClick={() => setMacro('')}>Todos</button>
        {macros.map(m => <button key={m} className={macro === m ? 'on' : ''} onClick={() => setMacro(m)}>{m}</button>)}
      </div>

      <div className="tbl-wrap">
        <table className="tbl operar-tbl">
          <thead><tr><th>Insumo</th><th className="r">Saldo</th><th className="r"></th></tr></thead>
          <tbody>
            {filtrados.map(i => {
              const n = naCesta(i.resource_id)
              return (
                <tr key={i.resource_id} className={n ? 'sel' : ''}>
                  <td><div className="desc">{i.descricao}</div><div className="meta">{i.macro}{i.familia ? ` · ${familiaCurta(i.familia)}` : ''} · #{i.resource_id}</div></td>
                  <td className="r">{num(i.saldo, 2)} <span className="u">{i.unidade}</span></td>
                  <td className="r"><button className="mini" onClick={() => setSel(i)}>{n ? `+ (${n})` : '+ Adicionar'}</button></td>
                </tr>
              )
            })}
            {filtrados.length === 0 && <tr><td colSpan={3}>
              {itens.length === 0 ? <Loader label="os insumos da obra" dica="Carregando o catálogo do Sienge…" />
                : <div className="empty">Nenhum insumo com esse filtro.</div>}</td></tr>}
          </tbody>
        </table>
      </div>

      {sel && (
        <AddInsumoModal obra={obra} op="baixa" item={sel} embalagens={embMap[sel.resource_id] || []}
          verbo="Retirar" onEmbSalva={carregarEmb} onAdd={addLinha} onClose={() => setSel(null)} />
      )}

      {cesta.length > 0 && (
        <div className="cesta-bar">
          <div className="cesta-info">{cesta.length} item(ns) na requisição{excede && <span style={{ color: 'var(--ruptura)' }}> · qtd acima do saldo</span>}</div>
          <button className="cta" disabled={!terceiro.trim()} onClick={() => { setErroGravar(''); setConfirmar(true) }}>
            {terceiro.trim() ? 'Gerar requisição' : 'Informe o terceiro'}</button>
        </div>
      )}

      {confirmar && (
        <div className="modal" onClick={() => !gravando && setConfirmar(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <h3>Confirmar retirada</h3>
            <p className="warn-txt">Retirada para <b style={{ color: 'var(--text)' }}>{terceiro}</b>. Dá baixa no estoque (Sienge) e gera a ficha.</p>
            <ul className="conf-list">
              {cesta.map(l => (
                <li key={l.key}>
                  <span>{l.item.descricao}{resumoLinha(l) && <em className="cesta-var"> · {resumoLinha(l)}</em>}</span>
                  <b>{num(l.baseQtd, 2)} {l.unidade} <button className="x" onClick={() => removeLinha(l.key)}>✕</button></b>
                </li>
              ))}
            </ul>
            {erroGravar && <div className="msg bad">{erroGravar}</div>}
            <div className="modal-acts">
              <button className="ghost" onClick={() => setConfirmar(false)} disabled={gravando}>Cancelar</button>
              <button className="cta" onClick={gravar} disabled={gravando}>{gravando ? 'Gravando…' : erroGravar ? 'Tentar de novo' : 'Confirmar e dar baixa'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function FichaView({ ficha, onNova }: { ficha: Ficha; onNova: () => void }) {
  return (
    <div className="dash">
      <div className="ficha-acoes no-print">
        <button className="cta" onClick={() => window.print()}>Imprimir / PDF</button>
        <button className="ghost" onClick={onNova}>Nova requisição</button>
      </div>
      <div className="ficha-print">
        <div className="ficha">
          <div className="ficha-head">
            <div>
              <div className="ficha-tt">FICHA DE RETIRADA DE MATERIAL</div>
              <div className="ficha-sub">BOX21 · Almoxarifado R21 Engenharia</div>
            </div>
            <div className="ficha-num">{ficha.numero}</div>
          </div>
          <div className="ficha-info">
            <div><span>Obra</span>{ficha.obraNome}</div>
            <div><span>Data</span>{ficha.data}</div>
            <div><span>Retirado por</span><b>{ficha.terceiro}</b></div>
            <div><span>Solicitante</span>{ficha.solicitante || '—'}</div>
            <div><span>Almoxarife</span>{ficha.operador}</div>
          </div>
          <table className="ficha-tbl">
            <thead><tr><th>#</th><th>Material</th><th>Código</th><th className="r">Qtd</th><th>Un.</th></tr></thead>
            <tbody>
              {ficha.itens.map((i, n) => (
                <tr key={i.resource_id + n}>
                  <td>{n + 1}</td>
                  <td>{i.descricao}{(i.variante || i.embalagem) && <div className="ficha-var">{[i.variante, i.embalagem].filter(Boolean).join(' · ')}</div>}</td>
                  <td>{i.resource_id}</td><td className="r">{num(i.qtd, 2)}</td><td>{i.unidade}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="ficha-ass">
            <div><span></span>Assinatura de quem retirou</div>
            <div><span></span>Assinatura do almoxarife</div>
          </div>
        </div>
      </div>
    </div>
  )
}
