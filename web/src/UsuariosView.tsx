import { useEffect, useMemo, useState } from 'react'
import { api, type Conta, type Obra, type UsuarioLista, type StatusConta, type EventoUsuario } from './api'
import { authAtiva } from './supabase'
import { Avatar } from './PerfilCard'
import { MODULOS, PERFIS, PAPEIS, TODOS_MODULOS, type PerfilPreset } from './modulos'
import Loader from './Loader'

// Gestão de usuários: a conta parte de um PERFIL de acesso (almoxarife, engenheiro…),
// escolhe as obras e, se preciso, recebe ajustes finos — sempre com o resumo, em
// português, do que a pessoa vai ver e fazer. O acesso é entregue por um LINK (convite
// ou "defina sua senha") que o gestor manda por WhatsApp ou e-mail.

const ST: Record<StatusConta, { l: string; cls: string }> = {
  ativo: { l: 'Ativo', cls: 'ok' },
  convidado: { l: 'Link enviado · nunca entrou', cls: 'pend' },
  sem_acesso: { l: 'Nunca entrou', cls: 'pend' },
  inativo: { l: 'Inativo', cls: 'off' },
}
type Filtro = 'todos' | 'ativo' | 'pendente' | 'inativo'

const nomeModulo = (id: string) => MODULOS.find(m => m.id === id)?.nome || id
const nomePerfil = (id?: string | null) => PERFIS.find(p => p.id === id)?.nome || null
const mesmos = (a: string[], b: string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort())

// perfil que bate EXATAMENTE com as permissões (para contas antigas sem perfil gravado)
function perfilExato(c: Conta): PerfilPreset | undefined {
  return PERFIS.find(p => p.role === c.role && p.operar === c.operar && p.gerar_plano === c.gerar_plano &&
    p.gerenciar_usuarios === c.gerenciar_usuarios && mesmos(p.modulos, c.modulos))
}
// diferenças da conta em relação ao perfil de origem
function ajustes(c: Conta, p: PerfilPreset | undefined): string[] {
  if (!p) return []
  const out: string[] = []
  if (p.role !== 'admin') {
    c.modulos.filter(m => !p.modulos.includes(m)).forEach(m => out.push(`+ ${nomeModulo(m)}`))
    p.modulos.filter(m => !c.modulos.includes(m)).forEach(m => out.push(`− ${nomeModulo(m)}`))
  }
  if (c.role !== p.role) out.push(`aprovação: ${PAPEIS.find(x => x.v === c.role)?.l}`)
  if (c.operar !== p.operar) out.push(c.operar ? '+ grava no Sienge' : '− grava no Sienge')
  if (c.gerar_plano !== p.gerar_plano) out.push(c.gerar_plano ? '+ plano de compra' : '− plano de compra')
  if (c.gerenciar_usuarios !== p.gerenciar_usuarios) out.push(c.gerenciar_usuarios ? '+ gerencia usuários' : '− gerencia usuários')
  return out
}

function quando(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  const dias = Math.floor((Date.now() - d.getTime()) / 86400000)
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  if (dias <= 0 && new Date().toDateString() === d.toDateString()) return `hoje, ${hora}`
  if (dias <= 1) return `ontem, ${hora}`
  if (dias < 30) return `há ${dias} dias`
  return d.toLocaleDateString('pt-BR')
}

export default function Usuarios({ obras }: { obras: Obra[] }) {
  const [lista, setLista] = useState<UsuarioLista[]>([])
  const [erro, setErro] = useState('')
  const [carregando, setCarregando] = useState(true)
  const [q, setQ] = useState('')
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [fPerfil, setFPerfil] = useState('')
  const [sel, setSel] = useState<UsuarioLista | null>(null)
  const [novo, setNovo] = useState(false)

  const carregar = () => {
    setCarregando(true); setErro('')
    api.usuarios().then(r => setLista(r.usuarios))
      .catch(e => setErro(e instanceof Error ? e.message : String(e)))
      .finally(() => setCarregando(false))
  }
  useEffect(() => { carregar() }, [])

  const cont = useMemo(() => ({
    todos: lista.length,
    ativo: lista.filter(u => u.status === 'ativo').length,
    pendente: lista.filter(u => u.status === 'convidado' || u.status === 'sem_acesso').length,
    inativo: lista.filter(u => u.status === 'inativo').length,
  }), [lista])
  const filtrada = useMemo(() => {
    const ql = q.toLowerCase().trim()
    return lista.filter(u =>
      (filtro === 'todos' ? u.status !== 'inativo' || false : filtro === 'pendente' ? (u.status === 'convidado' || u.status === 'sem_acesso') : u.status === filtro) &&
      (!fPerfil || (u.perfil || perfilExato(u)?.id || '') === fPerfil) &&
      (!ql || (u.nome || '').toLowerCase().includes(ql) || u.email.toLowerCase().includes(ql) || (u.cargo || '').toLowerCase().includes(ql)))
      .sort((a, b) => (a.nome || a.email).localeCompare(b.nome || b.email, 'pt-BR'))
  }, [lista, q, filtro, fPerfil])

  if (!authAtiva && !import.meta.env.DEV) return <div className="empty">A gestão de usuários exige login (Supabase). Rode o app em produção.</div>
  if (carregando && !lista.length) return <Loader label="os usuários" dica="Carregando contas, acessos e permissões…" />
  if (sel || novo) return <Editor conta={sel} obras={obras}
    onFechar={mudou => { setSel(null); setNovo(false); if (mudou) carregar() }} />

  const nomeObras = (u: Conta) => u.obras.length === 0 ? 'Todas as obras'
    : u.obras.map(o => obras.find(x => x.prevision_id === o)?.nome || o).join(', ')

  return (
    <div className="dash u2">
      <div className="u2-top">
        <input className="u2-busca" placeholder="Buscar por nome, e-mail ou cargo…" value={q} onChange={e => setQ(e.target.value)} />
        <select className="u2-sel" value={fPerfil} onChange={e => setFPerfil(e.target.value)}>
          <option value="">Todos os perfis</option>
          {PERFIS.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
        </select>
        <button className="cta" onClick={() => setNovo(true)}>+ Novo usuário</button>
      </div>
      <div className="chips u2-chips">
        {([['todos', 'Em uso', cont.todos - cont.inativo], ['ativo', 'Ativos', cont.ativo],
          ['pendente', 'Nunca entraram', cont.pendente], ['inativo', 'Inativos', cont.inativo]] as const).map(([k, l, n]) => (
          <button key={k} className={filtro === k ? 'on' : ''} onClick={() => setFiltro(k)}>{l} <em>{n}</em></button>
        ))}
      </div>
      {erro && <div className="msg bad">{erro}</div>}

      <div className="u2-lista">
        {filtrada.map(u => {
          const p = PERFIS.find(x => x.id === u.perfil) || perfilExato(u)
          const aj = ajustes(u, p)
          return (
            <button key={u.email} className={`u2-row ${u.status === 'inativo' ? 'off' : ''}`} onClick={() => setSel(u)}>
              <Avatar url={u.foto_url} nome={u.nome || u.email} size={40} />
              <div className="u2-id">
                <b>{u.nome || u.email.split('@')[0]}</b>
                <span>{u.email}{u.cargo ? ` · ${u.cargo}` : ''}</span>
              </div>
              <div className="u2-perfil">
                <span className={`u2-pp p-${p?.id || 'custom'}`}>{p?.nome || 'Personalizado'}</span>
                {aj.length > 0 && <em title={aj.join(' · ')}>ajustado</em>}
              </div>
              <div className="u2-obras" title={nomeObras(u)}>{nomeObras(u)}</div>
              <div className="u2-st">
                <span className={`u2-dot ${ST[u.status].cls}`}><i />{ST[u.status].l}</span>
                <em>{u.status === 'ativo' ? `último acesso ${quando(u.ultimo_acesso)}`
                  : u.status === 'convidado' ? `link gerado ${quando(u.convidado_em)}` : u.status === 'sem_acesso' ? 'gere o link de acesso' : ''}</em>
              </div>
            </button>
          )
        })}
        {filtrada.length === 0 && <div className="empty">Ninguém com esse filtro.</div>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- edição / cadastro
function Editor({ conta, obras, onFechar }: { conta: UsuarioLista | null; obras: Obra[]; onFechar: (mudou: boolean) => void }) {
  const inicial = useMemo<Conta>(() => {
    if (!conta) {
      const p = PERFIS[0]
      return { email: '', nome: '', cargo: '', tipo: p.tipo, ativo: true, role: p.role, perfil: p.id, modulos: [...p.modulos],
        obras: [], gerenciar_usuarios: p.gerenciar_usuarios, operar: p.operar, gerar_plano: p.gerar_plano }
    }
    // contas antigas: "nenhum módulo" queria dizer "todos" -> lista explícita
    const mods = conta.role !== 'admin' && conta.modulos.length === 0 ? [...TODOS_MODULOS] : conta.modulos
    const c = { ...conta, modulos: mods }
    return { ...c, perfil: conta.perfil || perfilExato(c)?.id || null }
  }, [conta])
  const [f, setF] = useState<Conta>(inicial)
  const [soObras, setSoObras] = useState(inicial.obras.length > 0)
  const [ajAberto, setAjAberto] = useState(false)
  const [proc, setProc] = useState(false)
  const [erro, setErro] = useState('')
  const [link, setLink] = useState<{ link: string; tipo: 'invite' | 'recovery' } | null>(null)
  const [gerando, setGerando] = useState(false)
  const [eventos, setEventos] = useState<EventoUsuario[] | null>(null)
  const [mudou, setMudou] = useState(false)
  useEffect(() => { if (conta) api.eventosUsuario(conta.email).then(r => setEventos(r.eventos)).catch(() => setEventos([])) }, [conta])

  const set = <K extends keyof Conta>(k: K, v: Conta[K]) => setF(p => ({ ...p, [k]: v }))
  const preset = PERFIS.find(p => p.id === f.perfil)
  const aj = ajustes(f, preset)
  const admin = f.role === 'admin'
  const aplicarPerfil = (p: PerfilPreset) => setF(prev => ({ ...prev, perfil: p.id, role: p.role, tipo: p.tipo,
    modulos: [...p.modulos], operar: p.operar, gerar_plano: p.gerar_plano, gerenciar_usuarios: p.gerenciar_usuarios }))
  const toggleMod = (id: string) => setF(p => ({ ...p, modulos: p.modulos.includes(id) ? p.modulos.filter(x => x !== id) : [...p.modulos, id] }))
  const toggleObra = (id: string) => setF(p => ({ ...p, obras: p.obras.includes(id) ? p.obras.filter(x => x !== id) : [...p.obras, id] }))
  const alterado = JSON.stringify({ ...f, obras: soObras ? f.obras : [] }) !== JSON.stringify(inicial)

  // o que a pessoa vai ver e fazer, em português — e o que está incoerente
  const visiveis = admin ? MODULOS : MODULOS.filter(m => f.modulos.includes(m.id))
  const avisos: string[] = []
  if (!admin && f.modulos.includes('operar') && !f.operar)
    avisos.push('Vê a tela Operar, mas NÃO consegue gravar no Sienge: ligue "Grava no Sienge" em Ajustes finos ou tire a tela Operar.')
  if ((f.role === 'engenheiro' || f.role === 'planejamento') && !admin && !f.modulos.includes('aprovacao'))
    avisos.push('Tem papel na aprovação de compras, mas não vê a tela Aprovações.')
  if (soObras && f.obras.length === 0) avisos.push('Marque pelo menos uma obra (ou escolha "Todas as obras").')
  if (!admin && f.modulos.length === 0) avisos.push('Marque pelo menos um módulo.')

  const salvar = async (gerarLink: boolean) => {
    const email = f.email.trim().toLowerCase()
    if (!email || !email.includes('@')) { setErro('Informe um e-mail válido.'); return }
    if (!f.nome?.trim()) { setErro('Informe o nome.'); return }
    if (soObras && f.obras.length === 0) { setErro('Marque pelo menos uma obra.'); return }
    if (!admin && f.modulos.length === 0) { setErro('Marque pelo menos um módulo.'); return }
    setProc(true); setErro('')
    try {
      await api.salvarUsuario({ ...f, email, obras: soObras ? f.obras : [], perfil: preset?.id || null })
      setMudou(true)
      if (gerarLink) setLink(await api.linkAcesso(email))
      else onFechar(true)
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)) }
    finally { setProc(false) }
  }
  const gerarLink = async () => {
    setGerando(true); setErro('')
    try { setLink(await api.linkAcesso(f.email)); setMudou(true) }
    catch (e) { setErro(e instanceof Error ? e.message : String(e)) }
    finally { setGerando(false) }
  }
  const alternarAtivo = async () => {
    if (!conta) return
    if (f.ativo && !confirm(`Inativar ${f.nome || f.email}? A pessoa perde o acesso na hora (o histórico fica).`)) return
    setProc(true); setErro('')
    try {
      await api.salvarUsuario({ ...inicial, ativo: !f.ativo, obras: inicial.obras, perfil: inicial.perfil ?? null })
      onFechar(true)
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); setProc(false) }
  }

  if (link) return <LinkView nome={f.nome || f.email} email={f.email} link={link} onFechar={() => onFechar(true)} />

  const st = conta ? ST[conta.status] : null
  return (
    <div className="dash u2">
      <button className="usr-back" onClick={() => onFechar(mudou)}>← Usuários</button>

      <div className="u2-hero">
        <Avatar url={conta?.foto_url} nome={f.nome || f.email || '?'} size={56} />
        <div className="u2-hero-id">
          <h2>{conta ? (f.nome || f.email) : 'Novo usuário'}</h2>
          {conta && <div className="u2-hero-sub">{f.email}</div>}
          {conta && st && <div className="u2-hero-st"><span className={`u2-dot ${st.cls}`}><i />{st.l}</span>
            {conta.ultimo_acesso && <em>último acesso {quando(conta.ultimo_acesso)}</em>}
            {conta.provedores.includes('google') && <em>entra com Google</em>}</div>}
        </div>
        {conta && <div className="u2-hero-acts">
          {f.ativo && <button className="ghost" disabled={gerando} onClick={gerarLink}>{gerando ? 'Gerando…' : conta.status === 'ativo' ? 'Link para redefinir senha' : 'Gerar link de acesso'}</button>}
          <button className={`usr-inativar ${f.ativo ? '' : 'reativar'}`} disabled={proc} onClick={alternarAtivo}>{f.ativo ? 'Inativar' : 'Reativar'}</button>
        </div>}
      </div>

      <div className="u2-grid">
        <div className="u2-col">
          <section className="u2-card">
            <div className="u2-tt">1 · Quem é</div>
            <div className="u2-form">
              <label className="campo"><span>Nome *</span><input value={f.nome || ''} onChange={e => set('nome', e.target.value)} placeholder="Nome completo" /></label>
              <label className="campo"><span>E-mail *</span><input value={f.email} disabled={!!conta} onChange={e => set('email', e.target.value.toLowerCase().trim())} placeholder="nome@r21engenharia.com.br" /></label>
              <label className="campo"><span>Cargo</span><input value={f.cargo || ''} onChange={e => set('cargo', e.target.value)} placeholder="ex.: Almoxarife da Cape Town" /></label>
            </div>
          </section>

          <section className="u2-card">
            <div className="u2-tt">2 · Perfil de acesso</div>
            <div className="u2-perfis">
              {PERFIS.map(p => (
                <button key={p.id} className={`u2-pcard ${f.perfil === p.id ? 'on' : ''}`} onClick={() => aplicarPerfil(p)}>
                  <b>{p.nome}</b><span>{p.descricao}</span>
                </button>
              ))}
            </div>
            {!preset && <div className="op-hint">Conta personalizada (não bate com nenhum perfil). Escolha um perfil para padronizar.</div>}
          </section>

          <section className="u2-card">
            <div className="u2-tt">3 · Obras</div>
            <div className="u2-radio">
              <label><input type="radio" checked={!soObras} onChange={() => setSoObras(false)} /> Todas as obras <em>(inclusive as que entrarem depois)</em></label>
              <label><input type="radio" checked={soObras} onChange={() => setSoObras(true)} /> Só as obras marcadas</label>
            </div>
            {soObras && <div className="toggle-chips" style={{ marginTop: 10 }}>
              {obras.map(o => <button key={o.prevision_id} className={`tchip ${f.obras.includes(o.prevision_id) ? 'on' : ''}`} onClick={() => toggleObra(o.prevision_id)}>{o.nome}</button>)}
            </div>}
          </section>

          <section className="u2-card">
            <button className="u2-tt u2-exp" onClick={() => setAjAberto(v => !v)}>
              4 · Ajustes finos {aj.length > 0 && <em>{aj.length} diferença(s) do perfil</em>} <i>{ajAberto ? '▴' : '▾'}</i>
            </button>
            {aj.length > 0 && <div className="u2-difs">{aj.map(a => <span key={a}>{a}</span>)}</div>}
            {ajAberto && <>
              <div className="usr-sec">Telas</div>
              {admin ? <div className="op-hint">Administrador vê todas as telas.</div> : (['Dashboards', 'Almoxarifado'] as const).map(g => (
                <div key={g} style={{ marginBottom: 10 }}>
                  <div className="usr-grp">{g}</div>
                  <div className="toggle-chips">
                    {MODULOS.filter(m => m.grupo === g).map(m => (
                      <button key={m.id} className={`tchip ${f.modulos.includes(m.id) ? 'on' : ''}`} onClick={() => toggleMod(m.id)}>{m.nome}</button>
                    ))}
                  </div>
                </div>
              ))}
              <div className="usr-sec">Aprovação de compras</div>
              <select className="u2-sel" value={f.role} onChange={e => set('role', e.target.value)}>
                {PAPEIS.map(r => <option key={r.v} value={r.v}>{r.l} — {r.desc}</option>)}
              </select>
              <div className="usr-sec">Ações</div>
              {([
                ['operar', 'Grava no Sienge', 'Baixa, entrada, devolução, transferência, entrega de pedido e ajuste de inventário'],
                ['gerar_plano', 'Gera plano de compra', 'Consolida a cesta do MRP em plano por fornecedor'],
                ['gerenciar_usuarios', 'Gerencia usuários', 'Acessa esta tela e muda o acesso das pessoas'],
              ] as const).map(([k, t, d]) => (
                <div key={k} className={`act-row ${f[k] ? 'on' : ''}`}>
                  <div className="act-txt"><b>{t}</b><span>{d}</span></div>
                  <button className={`sw ${f[k] ? 'on' : ''}`} disabled={admin} onClick={() => set(k, !f[k])} aria-label={t}><i /></button>
                </div>
              ))}
            </>}
          </section>
        </div>

        <aside className="u2-col u2-lado">
          <section className="u2-card u2-resumo">
            <div className="u2-tt">O que {f.nome?.split(' ')[0] || 'esta pessoa'} vai ver e fazer</div>
            <ul>
              <li><b>Obras:</b> {!soObras ? 'todas' : f.obras.length ? f.obras.map(o => obras.find(x => x.prevision_id === o)?.nome || o).join(', ') : '—'}</li>
              {visiveis.map(m => <li key={m.id}><b>{m.nome}</b> — {m.desc}{m.semGravar && !(f.operar || admin) ? ` (${m.semGravar})` : ''}</li>)}
              <li><b>Grava no Sienge:</b> {f.operar || admin ? 'sim' : 'não'}</li>
              <li><b>Aprovação:</b> {PAPEIS.find(r => r.v === f.role)?.desc}</li>
              {(f.gerenciar_usuarios || admin) && <li><b>Gerencia usuários</b></li>}
            </ul>
            {avisos.map(a => <div key={a} className="msg bad u2-aviso">{a}</div>)}
          </section>

          {conta && <section className="u2-card">
            <div className="u2-tt">Histórico</div>
            {eventos === null ? <div className="op-hint">carregando…</div> : eventos.length === 0 ? <div className="op-hint">Sem alterações registradas.</div> :
              <ul className="u2-ev">{eventos.map(e => <li key={e.id}><em>{quando(e.quando)} · {e.por}</em>{descreverEvento(e, obras)}</li>)}</ul>}
          </section>}
        </aside>
      </div>

      {erro && <div className="msg bad">{erro}</div>}
      <div className="u2-salvar">
        <button className="ghost" onClick={() => onFechar(mudou)} disabled={proc}>Cancelar</button>
        {conta
          ? <button className="cta" onClick={() => salvar(false)} disabled={proc || !alterado}>{proc ? 'Salvando…' : alterado ? 'Salvar alterações' : 'Nada alterado'}</button>
          : <button className="cta" onClick={() => salvar(true)} disabled={proc}>{proc ? 'Criando…' : 'Criar e gerar link de acesso'}</button>}
      </div>
    </div>
  )
}

const CAMPO: Record<string, string> = {
  modulos: 'telas', obras: 'obras', role: 'aprovação', perfil: 'perfil', ativo: 'situação', operar: 'grava no Sienge',
  gerar_plano: 'plano de compra', gerenciar_usuarios: 'gerencia usuários', nome: 'nome', cargo: 'cargo', tipo: 'tipo',
}
function descreverEvento(e: EventoUsuario, obras: Obra[]): string {
  if (e.acao === 'criado') return `criou a conta (${nomePerfil(e.depois?.perfil as string) || 'personalizado'})`
  if (e.acao === 'link_gerado') return (e.depois?.tipo === 'invite' ? 'gerou o link de primeiro acesso' : 'gerou link para definir senha')
  if (e.acao === 'inativado') return 'inativou a conta'
  if (e.acao === 'reativado') return 'reativou a conta'
  const partes: string[] = []
  const nomeObra = (id: string) => obras.find(o => o.prevision_id === id)?.nome || id
  for (const k of Object.keys(e.depois || {})) {
    const a = e.antes?.[k], d = e.depois?.[k]
    if (Array.isArray(a) || Array.isArray(d)) {
      const aa = (a as string[]) || [], dd = (d as string[]) || []
      const nm = k === 'obras' ? nomeObra : nomeModulo
      const mais = dd.filter(x => !aa.includes(x)).map(nm), menos = aa.filter(x => !dd.includes(x)).map(nm)
      if (k === 'obras' && !dd.length) partes.push('obras: todas')
      else partes.push(`${CAMPO[k] || k}: ${[...mais.map(x => '+' + x), ...menos.map(x => '−' + x)].join(' ')}`)
    } else if (typeof d === 'boolean') partes.push(`${d ? '+' : '−'} ${CAMPO[k] || k}`)
    else if (k === 'perfil') partes.push(`perfil: ${nomePerfil(d as string) || 'personalizado'}`)
    else partes.push(`${CAMPO[k] || k}: ${d ?? '—'}`)
  }
  return 'alterou ' + partes.join('; ')
}

// ---------------------------------------------------------------- link de acesso
function LinkView({ nome, email, link, onFechar }: {
  nome: string; email: string; link: { link: string; tipo: 'invite' | 'recovery' }; onFechar: () => void
}) {
  const [copiado, setCopiado] = useState(false)
  const primeiro = nome.split(' ')[0]
  const texto = `Olá, ${primeiro}! Seu acesso ao BOX21 (almoxarifado R21) está liberado.\n\n` +
    `1) Abra este link e crie sua senha (vale por 24 horas, uso único):\n${link.link}\n\n` +
    `2) Depois, entre em ${window.location.origin} com o e-mail ${email} e a senha criada` +
    ` — ou use "Entrar com Google" se ${email} for uma conta Google.`
  const copiar = async () => {
    try { await navigator.clipboard.writeText(texto); setCopiado(true); setTimeout(() => setCopiado(false), 2500) }
    catch { window.prompt('Copie a mensagem:', texto) }
  }
  return (
    <div className="dash u2">
      <div className="u2-card u2-link">
        <h2>{link.tipo === 'invite' ? `Acesso de ${nome} pronto` : `Link para ${nome} definir a senha`}</h2>
        <p className="op-hint">Mande a mensagem abaixo para {primeiro}. O link vale por <b>24 horas</b> e só funciona <b>uma vez</b>; se vencer, gere outro na ficha da pessoa.</p>
        <textarea readOnly value={texto} rows={8} onFocus={e => e.target.select()} />
        <div className="u2-link-acts">
          <button className="cta" onClick={copiar}>{copiado ? '✓ Copiado' : 'Copiar mensagem'}</button>
          <a className="ghost u2-btn" href={`https://wa.me/?text=${encodeURIComponent(texto)}`} target="_blank" rel="noreferrer">Enviar pelo WhatsApp</a>
          <a className="ghost u2-btn" href={`mailto:${email}?subject=${encodeURIComponent('Seu acesso ao BOX21')}&body=${encodeURIComponent(texto)}`}>Enviar por e-mail</a>
        </div>
        <div className="modal-acts"><button className="ghost" onClick={onFechar}>Concluir</button></div>
      </div>
    </div>
  )
}
