import { useEffect, useMemo, useState, lazy, Suspense, type ReactNode } from 'react'
import {
  api, brl, num, familiaCurta, STATUS_LABEL,
  type Item, type Material, type Movimento, type Obra, type Status, type EscritaItem,
} from './api'
import { supabase, authAtiva } from './supabase'
import { Avatar, PerfilModal } from './PerfilCard'
import { carregarPerfil, dadosDaSessao, type Perfil, type DadosGoogle } from './perfil'
import Loader from './Loader'
import { podeVer } from './modulos'
// módulos carregados sob demanda (code-splitting): abrir uma tela não baixa as outras
const Financeiro = lazy(() => import('./Financeiro'))
const Posicao = lazy(() => import('./Posicao'))
const Consumo = lazy(() => import('./Consumo'))
const Requisicao = lazy(() => import('./Requisicao'))
const Fornecedores = lazy(() => import('./Fornecedores'))
const Recebimentos = lazy(() => import('./Recebimentos'))
const Suprimentos = lazy(() => import('./Suprimentos'))
const Equipamentos = lazy(() => import('./EquipamentosView'))
const Aprovacoes = lazy(() => import('./AprovacaoView'))
const Usuarios = lazy(() => import('./UsuariosView'))
import { type Conta } from './api'
import iconFinanceiro from './assets/menu-icons/financeiro.webp'
import iconPosicao from './assets/menu-icons/posicao.webp'
import iconRecebimentos from './assets/menu-icons/recebimentos.webp'
import iconConsumo from './assets/menu-icons/consumo.webp'
import iconSuprimentos from './assets/menu-icons/suprimentos.webp'
import iconFornecedores from './assets/menu-icons/fornecedores.webp'
import iconEquipamentos from './assets/menu-icons/equipamentos.webp'
import iconAprovacao from './assets/menu-icons/aprovacao.webp'
import iconRequisicao from './assets/menu-icons/requisicao.webp'
import iconEstoque from './assets/menu-icons/estoque.webp'
import iconOperar from './assets/menu-icons/operar.webp'
import iconHistorico from './assets/menu-icons/historico.webp'

type Secao = 'financeiro' | 'posicao' | 'recebimentos' | 'consumo' | 'suprimentos' | 'fornecedores'
  | 'equipamentos' | 'estoque' | 'requisicao' | 'aprovacao' | 'operar' | 'historico' | 'usuarios'

// ícone gráfico único por seção (arte BOX21) — reutilizado no render do menu, sem duplicar componente
const ICON_SRC: Partial<Record<Secao, string>> = {
  financeiro: iconFinanceiro, posicao: iconPosicao, recebimentos: iconRecebimentos, consumo: iconConsumo,
  suprimentos: iconSuprimentos, fornecedores: iconFornecedores, equipamentos: iconEquipamentos,
  aprovacao: iconAprovacao, requisicao: iconRequisicao, estoque: iconEstoque, operar: iconOperar, historico: iconHistorico,
}

const NAV: { grupo: string; itens: { id: Secao; nome: string }[] }[] = [
  {
    grupo: 'Dashboards', itens: [
      { id: 'financeiro', nome: 'Financeiro' },
      { id: 'posicao', nome: 'Posição por grupo' },
      { id: 'recebimentos', nome: 'Recebimentos' },
      { id: 'consumo', nome: 'Consumo' },
      { id: 'suprimentos', nome: 'Suprimentos' },
      { id: 'fornecedores', nome: 'Fornecedores' },
      { id: 'equipamentos', nome: 'Equipamentos' },
    ],
  },
  {
    grupo: 'Almoxarifado', itens: [
      { id: 'aprovacao', nome: 'Aprovações' },
      { id: 'requisicao', nome: 'Requisição' },
      { id: 'estoque', nome: 'Estoque' },
      { id: 'operar', nome: 'Operar' },
      { id: 'historico', nome: 'Histórico' },
    ],
  },
]
const TITULOS: Record<Secao, { t: string; s: string }> = {
  financeiro: { t: 'Financeiro', s: 'Capital em estoque, capital ocioso e fluxo de materiais' },
  posicao: { t: 'Posição por grupo', s: 'Estoque atual consolidado pela classificação de insumos do Sienge' },
  recebimentos: { t: 'Recebimentos', s: 'Entregas, pedidos e notas fiscais' },
  consumo: { t: 'Consumo de materiais', s: 'Onde, com quem e em quê o material é gasto' },
  suprimentos: { t: 'Suprimentos (MRP)', s: 'Antecipe a ruptura antes de a frente parar' },
  fornecedores: { t: 'Fornecedores', s: 'Quem entrega no prazo e com qualidade' },
  equipamentos: { t: 'Equipamentos', s: 'Locação, ociosidade e custo' },
  aprovacao: { t: 'Aprovações', s: 'Solicitações com dupla aprovação: Engenharia → Planejamento → Compras' },
  requisicao: { t: 'Requisição de material', s: 'Retirada guiada com baixa no estoque e ficha para assinatura' },
  estoque: { t: 'Estoque', s: 'Risco de ruptura e capital parado' },
  operar: { t: 'Operar almoxarifado', s: 'Baixa, entrada e ajustes no Sienge' },
  historico: { t: 'Histórico', s: 'Movimentações registradas pelo app' },
  usuarios: { t: 'Usuários', s: 'Contas com acesso ao BOX21 e permissões de cada uma' },
}

export default function App() {
  const [obras, setObras] = useState<Obra[]>([])
  const [obra, setObra] = useState<string>('')
  const [modo, setModo] = useState<string>('')
  const eqParam = new URLSearchParams(window.location.search).get('eq') || undefined
  const [secao, setSecao] = useState<Secao>(eqParam ? 'equipamentos' : 'financeiro')
  const [menuAberto, setMenuAberto] = useState(false)
  const [erroAcesso, setErroAcesso] = useState<string>('')
  // usuário: e-mail da sessão Supabase; em dev (sem auth) usa um rótulo fixo
  const [usuario, setUsuario] = useState<string | null>(authAtiva ? null : 'dev local')
  const [carregandoSessao, setCarregandoSessao] = useState<boolean>(authAtiva)
  const [conta, setConta] = useState<Conta | null>(null)  // permissões do usuário logado
  // perfil
  const [perfil, setPerfil] = useState<Perfil | null>(null)
  const [google, setGoogle] = useState<DadosGoogle>({ nome: '', foto: '', email: '' })
  const [mostrarPerfil, setMostrarPerfil] = useState(false)
  const [perfilObrigatorio, setPerfilObrigatorio] = useState(false)

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
    api.obras().then(os => { setObras(os); setObra(os[0]?.prevision_id || ''); setErroAcesso('') })
      .catch(e => setErroAcesso(e instanceof Error ? e.message : String(e)))
    api.eu().then(setConta).catch(() => setConta(null))
    if (authAtiva) {
      Promise.all([carregarPerfil(), dadosDaSessao()]).then(([p, g]) => {
        setPerfil(p); setGoogle(g)
        if (!p || !p.nome) { setPerfilObrigatorio(true); setMostrarPerfil(true) }
      })
    }
  }, [usuario])

  // se a seção atual não for permitida ao usuário, cai na primeira permitida
  useEffect(() => {
    if (!conta) return
    const mods = conta.modulos || []
    const permitido = (s: Secao) => s === 'usuarios' ? conta.gerenciar_usuarios : podeVer(mods, s)
    if (!permitido(secao)) {
      const primeira = NAV.flatMap(g => g.itens).find(it => podeVer(mods, it.id))?.id
      if (primeira) setSecao(primeira)
    }
  }, [conta]) // eslint-disable-line react-hooks/exhaustive-deps

  if (carregandoSessao) return <Loader full label="o BOX21" dica="Verificando seu acesso…" />
  if (!usuario) return <Login />

  const sair = async () => { if (supabase) await supabase.auth.signOut(); setUsuario(null); setPerfil(null) }
  const nomeExibicao = perfil?.nome || google.nome || usuario
  const fotoExibicao = perfil?.foto_url || google.foto || null

  const irPara = (s: Secao) => { setSecao(s); setMenuAberto(false) }

  // menu filtrado pelas permissões do usuário (módulos vazios = todos) + grupo Administração
  const mods = conta?.modulos || []
  const navVisivel = NAV.map(g => ({ grupo: g.grupo, itens: g.itens.filter(it => podeVer(mods, it.id)) })).filter(g => g.itens.length > 0)
  if (conta?.gerenciar_usuarios) navVisivel.push({ grupo: 'Administração', itens: [{ id: 'usuarios' as Secao, nome: 'Usuários' }] })

  return (
    <div className={`plataforma ${menuAberto ? 'menu-aberto' : ''}`}>
      <aside className="side">
        <div className="side-logo"><img src="/box21.png" alt="BOX21" className="side-brand" /></div>
        <nav className="side-nav">
          {navVisivel.map(g => (
            <div className="side-grupo" key={g.grupo}>
              <div className="side-grupo-tt">{g.grupo}</div>
              {g.itens.map(it => (
                <button key={it.id} className={`side-item ${secao === it.id ? 'on' : ''}`} onClick={() => irPara(it.id)}>
                  {ICON_SRC[it.id]
                    ? <img className="side-ic" src={ICON_SRC[it.id]} alt="" />
                    : <span className="side-ic side-ic-svg" aria-hidden><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg></span>}
                  <span className="side-nome">{it.nome}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>
        <button className="side-perfil" onClick={() => { setPerfilObrigatorio(false); setMostrarPerfil(true) }}>
          <Avatar url={fotoExibicao} nome={nomeExibicao} size={30} />
          <span className="side-nome">{nomeExibicao}</span>
        </button>
        <div className="side-r21">
          <img src="/r21.png" alt="R21 Engenharia" />
        </div>
      </aside>

      {menuAberto && <div className="side-overlay" onClick={() => setMenuAberto(false)} />}

      <div className="conteudo">
        <header className="topbar">
          <div className="topbar-l">
            <button className="hamburguer" onClick={() => setMenuAberto(true)} aria-label="menu">☰</button>
            <div>
              <div className="topbar-tt">{TITULOS[secao].t}</div>
              <div className="topbar-sub">{TITULOS[secao].s}</div>
            </div>
          </div>
          <div className="topbar-r">
            <span className={`selo ${modo === 'demo' ? 'demo' : 'ok'}`}>{modo === 'demo' ? 'Demonstração' : 'Sienge · ao vivo'}</span>
            <select value={obra} onChange={e => setObra(e.target.value)} className="obra-sel">
              {obras.map(o => <option key={o.prevision_id} value={o.prevision_id}>{o.nome}</option>)}
            </select>
            <button className="sair-btn" onClick={sair} title="sair">⏻</button>
          </div>
        </header>

        {erroAcesso && (
          <div className="demo-banner" style={{ borderColor: '#ef444455', color: '#fca5a5', background: '#ef44441a', margin: '0 20px' }}>
            Não foi possível carregar os dados: {erroAcesso}
          </div>
        )}

        {mostrarPerfil && authAtiva && (
          <PerfilModal
            perfil={perfil} google={google} obrigatorio={perfilObrigatorio}
            onSalvo={p => { setPerfil(p); setMostrarPerfil(false); setPerfilObrigatorio(false) }}
            onFechar={() => setMostrarPerfil(false)}
          />
        )}

        <main className="area">
          {!obra && !erroAcesso && <Loader label={TITULOS[secao].t.toLowerCase()} dica="Conectando ao Sienge e listando as obras…" />}
          <Suspense fallback={<Loader label={TITULOS[secao].t.toLowerCase()} />}>
            {obra && secao === 'financeiro' && <Financeiro obra={obra} />}
            {obra && secao === 'recebimentos' && <Recebimentos obra={obra} />}
            {obra && secao === 'suprimentos' && <Suprimentos obra={obra} />}
            {secao === 'usuarios' && <Usuarios obras={obras} />}
            {obra && secao === 'posicao' && <Posicao obra={obra} />}
            {obra && secao === 'consumo' && <Consumo obra={obra} />}
            {obra && secao === 'fornecedores' && <Fornecedores obra={obra} />}
            {obra && secao === 'equipamentos' && <Equipamentos obra={obra} operador={nomeExibicao} abrirId={eqParam} />}
            {obra && secao === 'aprovacao' && <Aprovacoes obra={obra} obraNome={obras.find(o => o.prevision_id === obra)?.nome || obra} />}
            {obra && secao === 'requisicao' && <Requisicao obra={obra} obraNome={obras.find(o => o.prevision_id === obra)?.nome || obra} operador={nomeExibicao} />}
          </Suspense>
          {obra && secao === 'estoque' && <Painel obra={obra} />}
          {obra && secao === 'operar' && <Operar obra={obra} />}
          {obra && secao === 'historico' && <Historico obra={obra} />}
        </main>
      </div>
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

  const google = async () => {
    if (!supabase) return
    setErro('')
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
    if (error) setErro('Não foi possível entrar com o Google.')
  }

  return (
    <div className="ident">
      <div className="ident-card">
        <img src="/box21.png" alt="BOX21" className="ident-logo" />
        <p className="ident-tag">Inteligência de estoque · R21 Engenharia</p>
        <p>Entre com seu e-mail e senha autorizados.</p>
        <input type="email" placeholder="e-mail" value={email} autoFocus
          onChange={e => setEmail(e.target.value)} />
        <input type="password" placeholder="senha" value={senha}
          onChange={e => setSenha(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && entrar()} />
        {erro && <div className="msg bad" style={{ marginBottom: 12 }}>{erro}</div>}
        <button disabled={!email.trim() || !senha || carregando} onClick={entrar}>
          {carregando ? 'Entrando…' : 'Entrar'}</button>
        <div className="ou"><span>ou</span></div>
        <button className="google" onClick={google}>
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.9 2.4 30.4 0 24 0 14.6 0 6.4 5.4 2.5 13.2l7.9 6.1C12.3 13.2 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.1 5.3-4.6 7l7.1 5.5c4.1-3.8 6.5-9.4 6.5-16z"/><path fill="#FBBC05" d="M10.4 28.3c-.5-1.5-.8-3-.8-4.6s.3-3.1.8-4.6l-7.9-6.1C.9 16.1 0 19.9 0 24s.9 7.9 2.5 11.1l7.9-6.8z"/><path fill="#34A853" d="M24 48c6.4 0 11.9-2.1 15.9-5.8l-7.1-5.5c-2 1.3-4.6 2.1-8.8 2.1-6.3 0-11.7-3.7-13.6-9.3l-7.9 6.8C6.4 42.6 14.6 48 24 48z"/></svg>
          Entrar com Google
        </button>
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
  if (!d) return <Loader label="o estoque" />
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
              <td><div className="desc">{i.descricao}</div><div className="meta">{i.macro}{i.familia ? ` · ${familiaCurta(i.familia)}` : ''} · #{i.resource_id}</div></td>
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
                  <div className="meta"><StatusPill s={i.status} /> {i.macro}{i.familia ? ` · ${familiaCurta(i.familia)}` : ''} · #{i.resource_id}</div>
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
