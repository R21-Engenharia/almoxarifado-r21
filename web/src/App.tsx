import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  api, brl, num, STATUS_LABEL,
  type Item, type Material, type Movimento, type Obra, type Status, type EscritaItem,
} from './api'
import { supabase, authAtiva } from './supabase'

type Aba = 'painel' | 'operar' | 'historico'

export default function App() {
  const [obras, setObras] = useState<Obra[]>([])
  const [obra, setObra] = useState<string>('')
  const [modo, setModo] = useState<string>('')
  const [aba, setAba] = useState<Aba>('painel')
  // usuário: e-mail da sessão Supabase; em dev (sem auth) usa um rótulo fixo
  const [usuario, setUsuario] = useState<string | null>(authAtiva ? null : 'dev local')
  const [carregandoSessao, setCarregandoSessao] = useState<boolean>(authAtiva)

  useEffect(() => {
    if (!authAtiva || !supabase) return
    supabase.auth.getSession().then(({ data }) => {
      setUsuario(data.session?.user.email ?? null); setCarregandoSessao(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUsuario(session?.user.email ?? null)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!usuario) return
    api.health().then(h => setModo(h.modo)).catch(() => setModo('offline'))
    api.obras().then(os => { setObras(os); setObra(os[0]?.prevision_id || '') }).catch(() => {})
  }, [usuario])

  if (carregandoSessao) return <div className="loading">Carregando…</div>
  if (!usuario) return <Login />

  const sair = async () => { if (supabase) await supabase.auth.signOut(); setUsuario(null) }

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="logo">📦</span>
          <div>
            <div className="tt">Almoxarifado R21</div>
            <div className="sub">{modo === 'demo' ? 'MODO DEMONSTRAÇÃO' : 'Sienge · dados reais'}</div>
          </div>
        </div>
        <div className="topr">
          <select value={obra} onChange={e => setObra(e.target.value)} className="obra-sel">
            {obras.map(o => <option key={o.prevision_id} value={o.prevision_id}>{o.nome}</option>)}
          </select>
          <button className="who" onClick={sair} title="sair">{usuario} ⏻</button>
        </div>
      </header>

      {modo === 'demo' && (
        <div className="demo-banner">
          Dados de demonstração. Configure as credenciais do Sienge no backend para usar dados reais.
        </div>
      )}

      <nav className="tabs">
        <button className={aba === 'painel' ? 'on' : ''} onClick={() => setAba('painel')}>Painel</button>
        <button className={aba === 'operar' ? 'on' : ''} onClick={() => setAba('operar')}>Operar almoxarifado</button>
        <button className={aba === 'historico' ? 'on' : ''} onClick={() => setAba('historico')}>Histórico</button>
      </nav>

      <main>
        {obra && aba === 'painel' && <Painel obra={obra} />}
        {obra && aba === 'operar' && <Operar obra={obra} />}
        {obra && aba === 'historico' && <Historico obra={obra} />}
      </main>
    </div>
  )
}

function Login() {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')
  const [carregando, setCarregando] = useState(false)

  const entrar = async () => {
    if (!supabase) return
    setErro(''); setCarregando(true)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: senha })
    if (error) setErro('E-mail ou senha inválidos.')
    setCarregando(false)
  }

  return (
    <div className="ident">
      <div className="ident-card">
        <div className="logo big">📦</div>
        <h1>Almoxarifado R21</h1>
        <p>Entre com seu e-mail e senha autorizados.</p>
        <input type="email" placeholder="e-mail" value={email} autoFocus
          onChange={e => setEmail(e.target.value)} />
        <input type="password" placeholder="senha" value={senha}
          onChange={e => setSenha(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && entrar()} />
        {erro && <div className="msg bad" style={{ marginBottom: 12 }}>{erro}</div>}
        <button disabled={!email.trim() || !senha || carregando} onClick={entrar}>
          {carregando ? 'Entrando…' : 'Entrar'}</button>
      </div>
    </div>
  )
}

const STATUS_ORDER: Status[] = ['ruptura', 'critico', 'baixo', 'ok', 'parado']

function StatusPill({ s }: { s: Status }) {
  return <span className={`pill ${s}`}>{STATUS_LABEL[s]}</span>
}

/* ----------------------------------------------------------- Painel */
function Painel({ obra }: { obra: string }) {
  const [d, setD] = useState<Material | null>(null)
  const [err, setErr] = useState('')
  const [atualizando, setAtualizando] = useState(false)
  const carregar = () => { setErr(''); api.material(obra).then(setD).catch(e => setErr(e instanceof Error ? e.message : String(e))) }
  useEffect(() => { setD(null); carregar() }, [obra])
  const atualizar = async () => {
    setAtualizando(true)
    try { await api.atualizar(obra); await api.material(obra).then(setD) }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
    finally { setAtualizando(false) }
  }
  if (err) return <div className="err">Falha ao carregar: {err}</div>
  if (!d) return <div className="loading">Carregando…</div>
  const k = d.kpis
  return (
    <div className="painel">
      <div className="painel-topo">
        <button className="mini" onClick={atualizar} disabled={atualizando}>
          {atualizando ? 'Atualizando do Sienge… (~1 min)' : '↻ Atualizar do Sienge'}
        </button>
      </div>
      <div className="kpis">
        <Kpi label="Insumos" v={num(k.n_insumos)} />
        <Kpi label="Capital em estoque" v={brl(k.valor_em_estoque)} />
        <Kpi label="Capital parado" v={brl(k.valor_parado)} tone="warn" />
        <Kpi label="Alertas" v={num((k.resumo_status.ruptura || 0) + (k.resumo_status.critico || 0) + (k.resumo_status.baixo || 0))} tone="bad" />
      </div>

      <div className="status-strip">
        {STATUS_ORDER.map(s => (
          <div key={s} className={`ss ${s}`}>
            <b>{k.resumo_status[s] || 0}</b><span>{STATUS_LABEL[s]}</span>
          </div>
        ))}
      </div>

      <Section title={`Risco de ruptura (${d.alertas.length})`}>
        {d.alertas.length === 0 ? <Empty>Nenhum alerta de ruptura.</Empty> :
          <ItemTable itens={d.alertas} cols={['cobertura', 'saldo', 'impacto']} />}
      </Section>

      <Section title={`Capital parado (${d.parados.length})`}>
        {d.parados.length === 0 ? <Empty>Nada parado.</Empty> :
          <ItemTable itens={d.parados} cols={['saldo', 'valor', 'ultimo']} />}
      </Section>
    </div>
  )
}

function Kpi({ label, v, tone }: { label: string; v: string; tone?: string }) {
  return <div className={`kpi ${tone || ''}`}><div className="kv">{v}</div><div className="kl">{label}</div></div>
}
function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="sec"><h2>{title}</h2>{children}</section>
}
function Empty({ children }: { children: ReactNode }) { return <div className="empty">{children}</div> }

function ItemTable({ itens, cols }: { itens: Item[]; cols: string[] }) {
  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead><tr>
          <th>Insumo</th><th></th>
          {cols.includes('cobertura') && <th className="r">Cobertura</th>}
          {cols.includes('saldo') && <th className="r">Saldo</th>}
          {cols.includes('impacto') && <th className="r">R$/dia</th>}
          {cols.includes('valor') && <th className="r">Capital</th>}
          {cols.includes('ultimo') && <th className="r">Últ. consumo</th>}
        </tr></thead>
        <tbody>
          {itens.map(i => (
            <tr key={i.resource_id}>
              <td><div className="desc">{i.descricao}</div><div className="meta">{i.macro} · #{i.resource_id}</div></td>
              <td><StatusPill s={i.status} /></td>
              {cols.includes('cobertura') && <td className="r">{i.cobertura_dias === null ? '—' : `${num(i.cobertura_dias, 1)} d`}</td>}
              {cols.includes('saldo') && <td className="r">{num(i.saldo, 2)} {i.unidade}</td>}
              {cols.includes('impacto') && <td className="r">{brl(i.impacto_dia)}</td>}
              {cols.includes('valor') && <td className="r">{brl(i.valor_saldo)}</td>}
              {cols.includes('ultimo') && <td className="r">{i.ultimo_consumo || 'nunca'}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ----------------------------------------------------------- Operar */
type Cesta = Record<string, { item: Item; qtd: number }>

function Operar({ obra }: { obra: string }) {
  const [itens, setItens] = useState<Item[]>([])
  const [macros, setMacros] = useState<string[]>([])
  const [macro, setMacro] = useState<string>('')
  const [q, setQ] = useState('')
  const [op, setOp] = useState<'baixa' | 'entrada'>('baixa')
  const [cesta, setCesta] = useState<Cesta>({})
  const [msg, setMsg] = useState('')
  const [confirmar, setConfirmar] = useState(false)
  const [gravando, setGravando] = useState(false)

  const carregar = () => api.catalogo(obra).then(r => { setItens(r.itens); setMacros(r.macro_ordem) })
  useEffect(() => { setCesta({}); carregar() }, [obra])

  const filtrados = useMemo(() => {
    const ql = q.toLowerCase().trim()
    return itens.filter(i =>
      (!macro || i.macro === macro) &&
      (!ql || i.descricao.toLowerCase().includes(ql) || i.resource_id === ql))
      .slice(0, 200)
  }, [itens, macro, q])

  const setQtd = (i: Item, qtd: number) => setCesta(c => {
    const n = { ...c }
    if (!qtd) delete n[i.resource_id]; else n[i.resource_id] = { item: i, qtd }
    return n
  })

  const linhas = Object.values(cesta)
  const gravar = async () => {
    const payload: EscritaItem[] = linhas.map(l => ({
      resource_id: l.item.resource_id, quantidade: l.qtd, unidade: l.item.unidade, descricao: l.item.descricao,
    }))
    setGravando(true)
    try {
      const r = op === 'baixa' ? await api.baixa(obra, payload) : await api.entrada(obra, payload)
      setMsg(`✓ ${op === 'baixa' ? 'Baixa' : 'Entrada'} registrada (${r.auditoria_ids.length} item(ns)).`)
      setCesta({}); setConfirmar(false); carregar()
    } catch (e) { setMsg('✗ ' + (e instanceof Error ? e.message : String(e))) }
    finally { setGravando(false) }
  }

  return (
    <div className="operar">
      <div className="op-toolbar">
        <div className="seg">
          <button className={op === 'baixa' ? 'on' : ''} onClick={() => setOp('baixa')}>Baixa (consumo)</button>
          <button className={op === 'entrada' ? 'on' : ''} onClick={() => setOp('entrada')}>Entrada</button>
        </div>
        <input className="busca" placeholder="buscar insumo ou código…" value={q} onChange={e => setQ(e.target.value)} />
      </div>

      <div className="chips">
        <button className={!macro ? 'on' : ''} onClick={() => setMacro('')}>Todos</button>
        {macros.map(m => <button key={m} className={macro === m ? 'on' : ''} onClick={() => setMacro(m)}>{m}</button>)}
      </div>

      {msg && <div className={`msg ${msg.startsWith('✓') ? 'ok' : 'bad'}`} onClick={() => setMsg('')}>{msg}</div>}

      <div className="tbl-wrap">
        <table className="tbl operar-tbl">
          <thead><tr><th>Insumo</th><th className="r">Saldo</th><th className="r">Qtd {op === 'baixa' ? 'a baixar' : 'a entrar'}</th></tr></thead>
          <tbody>
            {filtrados.map(i => (
              <tr key={i.resource_id} className={cesta[i.resource_id] ? 'sel' : ''}>
                <td>
                  <div className="desc">{i.descricao}</div>
                  <div className="meta"><StatusPill s={i.status} /> {i.macro} · #{i.resource_id}</div>
                </td>
                <td className="r">{num(i.saldo, 2)} <span className="u">{i.unidade}</span></td>
                <td className="r">
                  <input type="number" min={0} step="any" className="qtd"
                    value={cesta[i.resource_id]?.qtd ?? ''} placeholder="0"
                    onChange={e => setQtd(i, parseFloat(e.target.value) || 0)} />
                </td>
              </tr>
            ))}
            {filtrados.length === 0 && <tr><td colSpan={3}><Empty>Nenhum insumo com esse filtro.</Empty></td></tr>}
          </tbody>
        </table>
      </div>

      {linhas.length > 0 && (
        <div className="cesta-bar">
          <div className="cesta-info">{linhas.length} item(ns) · {op === 'baixa' ? 'baixa' : 'entrada'}</div>
          <button className="cta" onClick={() => setConfirmar(true)}>Revisar e gravar</button>
        </div>
      )}

      {confirmar && (
        <div className="modal" onClick={() => !gravando && setConfirmar(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <h3>Confirmar {op === 'baixa' ? 'baixa (consumo)' : 'entrada'}</h3>
            <p className="warn-txt">Isto grava no Sienge e é registrado na auditoria. Estorno depois é possível, mas gera um novo movimento.</p>
            <ul className="conf-list">
              {linhas.map(l => <li key={l.item.resource_id}><span>{l.item.descricao}</span><b>{num(l.qtd, 2)} {l.item.unidade}</b></li>)}
            </ul>
            <div className="modal-acts">
              <button className="ghost" onClick={() => setConfirmar(false)} disabled={gravando}>Cancelar</button>
              <button className="cta" onClick={gravar} disabled={gravando}>{gravando ? 'Gravando no Sienge…' : 'Confirmar e gravar'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ----------------------------------------------------------- Histórico */
function Historico({ obra }: { obra: string }) {
  const [movs, setMovs] = useState<Movimento[]>([])
  const [msg, setMsg] = useState('')
  const [estornandoId, setEstornandoId] = useState<number | null>(null)
  const carregar = () => api.movimentos(obra).then(r => setMovs(r.itens))
  useEffect(() => { carregar() }, [obra])

  const estornar = async (m: Movimento) => {
    if (!confirm(`Estornar ${m.operacao} de ${num(m.quantidade, 2)} ${m.unidade || ''}?\n\nIsto cria um movimento compensatório no Sienge (pode levar até 1 min).`)) return
    setMsg(''); setEstornandoId(m.id)
    try { await api.estorno(m.id); setMsg('✓ Estorno registrado.'); carregar() }
    catch (e) { setMsg('✗ ' + (e instanceof Error ? e.message : String(e))) }
    finally { setEstornandoId(null) }
  }

  return (
    <div className="historico">
      {msg && <div className={`msg ${msg.startsWith('✓') ? 'ok' : 'bad'}`} onClick={() => setMsg('')}>{msg}</div>}
      {movs.length === 0 && <Empty>Nenhuma movimentação registrada por este app ainda.</Empty>}
      <div className="tbl-wrap">
        {movs.length > 0 && (
          <table className="tbl">
            <thead><tr><th>Quando</th><th>Op.</th><th>Insumo</th><th className="r">Qtd</th><th>Por</th><th></th></tr></thead>
            <tbody>
              {movs.map(m => (
                <tr key={m.id} className={m.estornado ? 'estornado' : ''}>
                  <td>{new Date(m.criado_em).toLocaleString('pt-BR')}</td>
                  <td><span className={`op ${m.operacao}`}>{m.operacao}</span></td>
                  <td><div className="desc">{m.descricao || '#' + m.resource_id}</div><div className="meta">#{m.resource_id} · {m.document_id}</div></td>
                  <td className="r">{num(m.quantidade, 2)} {m.unidade}</td>
                  <td className="who-cell">{m.usuario}</td>
                  <td className="r">
                    {m.operacao !== 'estorno' && !m.estornado &&
                      <button className="mini" onClick={() => estornar(m)} disabled={estornandoId !== null}>
                        {estornandoId === m.id ? 'Estornando…' : 'Estornar'}</button>}
                    {m.estornado ? <span className="badge">estornado</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
