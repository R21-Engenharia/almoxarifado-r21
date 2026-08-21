import { useEffect, useMemo, useState } from 'react'
import { api, num, familiaCurta, type Item, type EscritaItem } from './api'
import Loader from './Loader'

type Cesta = Record<string, { item: Item; qtd: number }>

interface Ficha {
  numero: string; terceiro: string; solicitante: string; obraNome: string
  data: string; operador: string
  itens: { descricao: string; qtd: number; unidade: string; resource_id: string }[]
}

export default function Requisicao({ obra, obraNome, operador }: { obra: string; obraNome: string; operador: string }) {
  const [itens, setItens] = useState<Item[]>([])
  const [macros, setMacros] = useState<string[]>([])
  const [macro, setMacro] = useState('')
  const [q, setQ] = useState('')
  const [cesta, setCesta] = useState<Cesta>({})
  const [terceiro, setTerceiro] = useState('')
  const [solicitante, setSolicitante] = useState('')
  const [recentes, setRecentes] = useState<string[]>([])
  const [confirmar, setConfirmar] = useState(false)
  const [gravando, setGravando] = useState(false)
  const [msg, setMsg] = useState('')
  const [ficha, setFicha] = useState<Ficha | null>(null)

  const carregar = () => api.catalogo(obra).then(r => { setItens(r.itens); setMacros(r.macro_ordem) })
  useEffect(() => { setCesta({}); setFicha(null); carregar() }, [obra])
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

  const setQtd = (i: Item, qtd: number) => setCesta(c => {
    const n = { ...c }; if (!qtd) delete n[i.resource_id]; else n[i.resource_id] = { item: i, qtd }; return n
  })
  const linhas = Object.values(cesta)
  const excede = linhas.some(l => l.qtd > l.item.saldo)

  const gravar = async () => {
    const payload: EscritaItem[] = linhas.map(l => ({
      resource_id: l.item.resource_id, quantidade: l.qtd, unidade: l.item.unidade, descricao: l.item.descricao,
    }))
    setGravando(true)
    try {
      const r = await api.baixa(obra, payload, { terceiro: terceiro.trim(), solicitante: solicitante.trim() || undefined })
      setFicha({
        numero: `REQ-${(r.auditoria_ids[0] ?? Date.now()).toString().padStart(5, '0')}`,
        terceiro: terceiro.trim(), solicitante: solicitante.trim(), obraNome,
        data: new Date().toLocaleString('pt-BR'), operador,
        itens: linhas.map(l => ({ descricao: l.item.descricao, qtd: l.qtd, unidade: l.item.unidade, resource_id: l.item.resource_id })),
      })
      setCesta({}); setConfirmar(false); carregar()
    } catch (e) { setMsg('✗ ' + (e instanceof Error ? e.message : String(e))); setConfirmar(false) }
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
          <thead><tr><th>Insumo</th><th className="r">Saldo</th><th className="r">Qtd a retirar</th></tr></thead>
          <tbody>
            {filtrados.map(i => {
              const q2 = cesta[i.resource_id]?.qtd
              const over = q2 !== undefined && q2 > i.saldo
              return (
                <tr key={i.resource_id} className={cesta[i.resource_id] ? 'sel' : ''}>
                  <td><div className="desc">{i.descricao}</div><div className="meta">{i.macro}{i.familia ? ` · ${familiaCurta(i.familia)}` : ''} · #{i.resource_id}</div></td>
                  <td className="r">{num(i.saldo, 2)} <span className="u">{i.unidade}</span></td>
                  <td className="r">
                    <input type="number" min={0} step="any" className="qtd" style={over ? { borderColor: 'var(--ruptura)' } : undefined}
                      value={q2 ?? ''} placeholder="0" onChange={e => setQtd(i, parseFloat(e.target.value) || 0)} />
                  </td>
                </tr>
              )
            })}
            {filtrados.length === 0 && <tr><td colSpan={3}>
              {itens.length === 0 ? <Loader label="os insumos da obra" dica="Carregando o catálogo do Sienge…" />
                : <div className="empty">Nenhum insumo com esse filtro.</div>}</td></tr>}
          </tbody>
        </table>
      </div>

      {linhas.length > 0 && (
        <div className="cesta-bar">
          <div className="cesta-info">{linhas.length} item(ns) na requisição{excede && <span style={{ color: 'var(--ruptura)' }}> · qtd acima do saldo</span>}</div>
          <button className="cta" disabled={!terceiro.trim()} onClick={() => setConfirmar(true)}>
            {terceiro.trim() ? 'Gerar requisição' : 'Informe o terceiro'}</button>
        </div>
      )}

      {confirmar && (
        <div className="modal" onClick={() => !gravando && setConfirmar(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <h3>Confirmar retirada</h3>
            <p className="warn-txt">Retirada para <b style={{ color: 'var(--text)' }}>{terceiro}</b>. Dá baixa no estoque (Sienge) e gera a ficha.</p>
            <ul className="conf-list">
              {linhas.map(l => <li key={l.item.resource_id}><span>{l.item.descricao}</span><b>{num(l.qtd, 2)} {l.item.unidade}</b></li>)}
            </ul>
            <div className="modal-acts">
              <button className="ghost" onClick={() => setConfirmar(false)} disabled={gravando}>Cancelar</button>
              <button className="cta" onClick={gravar} disabled={gravando}>{gravando ? 'Gravando…' : 'Confirmar e dar baixa'}</button>
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
                <tr key={i.resource_id}><td>{n + 1}</td><td>{i.descricao}</td><td>{i.resource_id}</td><td className="r">{num(i.qtd, 2)}</td><td>{i.unidade}</td></tr>
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
