import { useEffect, useMemo, useState } from 'react'
import { api, type Conta, type Obra } from './api'
import { authAtiva } from './supabase'
import { Avatar } from './PerfilCard'
import { MODULOS, PERFIS } from './modulos'
import Loader from './Loader'

type Tab = 'info' | 'perms'

const ROLE_INFO: Record<string, { l: string; bg: string; c: string }> = {
  admin: { l: 'Admin', bg: '#e2231a22', c: 'var(--accent)' },
  planejamento: { l: 'Planejamento', bg: '#ff7a1a22', c: 'var(--critico)' },
  engenheiro: { l: 'Engenheiro', bg: '#2dd4bf22', c: 'var(--entrada)' },
  user: { l: 'Operacional', bg: '#ffffff10', c: 'var(--muted)' },
}
const roleInfo = (r: string) => ROLE_INFO[r] || ROLE_INFO.user
const ROLES = [
  { v: 'user', l: 'Operacional (sem papel na aprovação)' },
  { v: 'engenheiro', l: 'Engenheiro — 1ª aprovação' },
  { v: 'planejamento', l: 'Planejamento — 2ª aprovação' },
  { v: 'admin', l: 'Admin' },
]

export default function Usuarios({ obras }: { obras: Obra[] }) {
  const [lista, setLista] = useState<Conta[]>([])
  const [erro, setErro] = useState('')
  const [carregando, setCarregando] = useState(true)
  const [q, setQ] = useState('')
  const [soAtivos, setSoAtivos] = useState(true)
  const [sel, setSel] = useState<Conta | null>(null)
  const [novo, setNovo] = useState(false)

  const carregar = () => {
    setCarregando(true); setErro('')
    api.usuarios().then(r => setLista(r.usuarios))
      .catch(e => setErro(e instanceof Error ? e.message : String(e)))
      .finally(() => setCarregando(false))
  }
  useEffect(() => { carregar() }, [])

  const filtrada = useMemo(() => {
    const ql = q.toLowerCase().trim()
    return lista.filter(u =>
      (!soAtivos || u.ativo) &&
      (!ql || (u.nome || '').toLowerCase().includes(ql) || u.email.toLowerCase().includes(ql) || (u.cargo || '').toLowerCase().includes(ql)))
  }, [lista, q, soAtivos])

  if (!authAtiva && !import.meta.env.DEV) return <div className="empty">A gestão de usuários exige login (Supabase). Rode o app em produção.</div>
  if (carregando) return <Loader label="os usuários" dica="Carregando contas e permissões…" />
  if (sel || novo) return <Detalhe conta={sel} obras={obras}
    onSalvo={() => { setSel(null); setNovo(false); carregar() }}
    onVoltar={() => { setSel(null); setNovo(false) }} />

  const nAtivos = lista.filter(u => u.ativo).length
  return (
    <div className="dash usr">
      <div className="usr-topbar">
        <div className="usr-busca">
          <input placeholder="Buscar por nome, e-mail ou cargo…" value={q} onChange={e => setQ(e.target.value)} />
          <button className={`usr-flt ${soAtivos ? 'on' : ''}`} onClick={() => setSoAtivos(v => !v)}>{soAtivos ? 'Só ativos' : 'Todos'}</button>
        </div>
        <button className="cta" onClick={() => setNovo(true)}>+ Novo usuário</button>
      </div>
      <div className="usr-count">{nAtivos} {nAtivos === 1 ? 'usuário ativo' : 'usuários ativos'}{lista.length > nAtivos ? ` · ${lista.length - nAtivos} inativos` : ''}</div>
      {erro && <div className="msg bad">{erro}</div>}

      <div className="usr-list">
        {filtrada.map(u => {
          const ri = roleInfo(u.role)
          return (
            <button key={u.email} className="usr-row" onClick={() => setSel(u)}>
              <Avatar url={null} nome={u.nome || u.email} size={42} />
              <div className="usr-id">
                <div className="usr-nome">{u.nome || u.email.split('@')[0]}</div>
                <div className="usr-cargo">{u.cargo || 'Sem cargo definido'}</div>
              </div>
              <div className="usr-email">{u.email}</div>
              <span className="role-pill" style={{ background: ri.bg, color: ri.c }}>{ri.l}</span>
              <span className={`status-dot ${u.ativo ? '' : 'off'}`}><i />{u.ativo ? 'Ativo' : 'Inativo'}</span>
            </button>
          )
        })}
        {filtrada.length === 0 && <div className="empty">Nenhum usuário encontrado.</div>}
      </div>
    </div>
  )
}

function Detalhe({ conta, obras, onSalvo, onVoltar }: {
  conta: Conta | null; obras: Obra[]; onSalvo: () => void; onVoltar: () => void
}) {
  const [tab, setTab] = useState<Tab>('info')
  const [f, setF] = useState<Conta>(conta || {
    email: '', nome: '', cargo: '', tipo: 'Geral', ativo: true, role: 'user',
    modulos: [], obras: [], gerenciar_usuarios: false, operar: false, gerar_plano: false,
  })
  const [proc, setProc] = useState(false)
  const [erro, setErro] = useState('')
  const [msg, setMsg] = useState('')
  const set = <K extends keyof Conta>(k: K, v: Conta[K]) => setF(p => ({ ...p, [k]: v }))
  const toggleArr = (k: 'modulos' | 'obras', id: string) =>
    setF(p => ({ ...p, [k]: p[k].includes(id) ? p[k].filter(x => x !== id) : [...p[k], id] }))
  const perfilAtivo = useMemo(() => PERFIS.find(p =>
    p.role === f.role && p.operar === f.operar && p.gerar_plano === f.gerar_plano &&
    p.gerenciar_usuarios === f.gerenciar_usuarios &&
    JSON.stringify([...p.modulos].sort()) === JSON.stringify([...f.modulos].sort()))?.id, [f])
  const aplicarPerfil = (id: string) => {
    const p = PERFIS.find(x => x.id === id); if (!p) return
    setF(prev => ({ ...prev, role: p.role, tipo: p.tipo, modulos: [...p.modulos],
      operar: p.operar, gerar_plano: p.gerar_plano, gerenciar_usuarios: p.gerenciar_usuarios }))
  }
  const salvar = async () => {
    if (!f.email.trim() || !f.email.includes('@')) { setErro('Informe um e-mail válido.'); return }
    setProc(true); setErro('')
    try { await api.salvarUsuario(f); setMsg('✓ Salvo.'); setTimeout(onSalvo, 800) }
    catch (e) { setErro(e instanceof Error ? e.message : String(e)); setProc(false) }
  }
  const ri = roleInfo(f.role)

  return (
    <div className="dash usr">
      <button className="usr-back" onClick={onVoltar}>← Usuários</button>

      <div className="usr-hero">
        <Avatar url={null} nome={f.nome || f.email || '?'} size={64} />
        <div className="usr-hero-id">
          <h2>{f.nome || (conta ? f.email : 'Novo usuário')}</h2>
          <div className="usr-hero-sub">{f.cargo || 'Sem cargo definido'}{conta ? ` · ${f.email}` : ''}</div>
          <div className="usr-hero-badges">
            <span className="role-pill" style={{ background: ri.bg, color: ri.c }}>{ri.l}</span>
            <span className={`status-dot ${f.ativo ? '' : 'off'}`}><i />{f.ativo ? 'Ativo' : 'Inativo'}</span>
          </div>
        </div>
        <button className={`usr-inativar ${f.ativo ? '' : 'reativar'}`} onClick={() => set('ativo', !f.ativo)}>
          {f.ativo ? 'Inativar' : 'Reativar'}</button>
      </div>

      <div className="usr-tabs">
        <button className={tab === 'info' ? 'on' : ''} onClick={() => setTab('info')}>Informações</button>
        <button className={tab === 'perms' ? 'on' : ''} onClick={() => setTab('perms')}>Permissões</button>
      </div>

      <div className="usr-card">
        {tab === 'info' ? (
          <div className="usr-form">
            <label className="campo"><span>Nome</span>
              <input value={f.nome || ''} onChange={e => set('nome', e.target.value)} placeholder="Nome completo" /></label>
            <label className="campo"><span>E-mail</span>
              <input value={f.email} onChange={e => set('email', e.target.value.toLowerCase())} disabled={!!conta} placeholder="email@empresa.com" /></label>
            <label className="campo"><span>Cargo / Função</span>
              <input value={f.cargo || ''} onChange={e => set('cargo', e.target.value)} placeholder="ex.: Analista de Planejamento" /></label>
            <label className="campo"><span>Tipo</span>
              <select value={f.tipo} onChange={e => set('tipo', e.target.value)}>
                <option>Geral</option><option>Administrador</option><option>Terceiro</option></select></label>
            <label className="campo" style={{ gridColumn: '1 / -1' }}><span>Papel na aprovação</span>
              <select value={f.role} onChange={e => set('role', e.target.value)}>
                {ROLES.map(r => <option key={r.v} value={r.v}>{r.l}</option>)}</select></label>
          </div>
        ) : (
          <>
            <div className="usr-sec">Perfil pronto</div>
            <div className="perfil-cards">
              {PERFIS.map(p => (
                <button key={p.id} className={`perfil-card ${perfilAtivo === p.id ? 'on' : ''}`} onClick={() => aplicarPerfil(p.id)}>
                  <b>{p.nome}</b><span>{p.descricao}</span></button>
              ))}
            </div>

            <div className="usr-sec">Módulos <span className="usr-sec-hint">nenhum marcado = acesso a todos</span></div>
            {(['Dashboards', 'Almoxarifado'] as const).map(g => (
              <div key={g} style={{ marginBottom: 12 }}>
                <div className="usr-grp">{g}</div>
                <div className="toggle-chips">
                  {MODULOS.filter(m => m.grupo === g).map(m => (
                    <button key={m.id} className={`tchip ${f.modulos.includes(m.id) ? 'on' : ''}`} onClick={() => toggleArr('modulos', m.id)}>{m.nome}</button>
                  ))}
                </div>
              </div>
            ))}

            <div className="usr-sec">Ações sensíveis</div>
            {([
              ['gerenciar_usuarios', 'Gerenciar usuários', 'Acessar e editar este módulo de usuários'],
              ['operar', 'Operar almoxarifado', 'Registrar baixa e entrada direto no Sienge'],
              ['gerar_plano', 'Gerar plano de compra', 'Consolidar a cesta do MRP em plano por fornecedor'],
            ] as const).map(([k, t, d]) => (
              <div key={k} className={`act-row ${f[k] ? 'on' : ''}`}>
                <div className="act-txt"><b>{t}</b><span>{d}</span></div>
                <button className={`sw ${f[k] ? 'on' : ''}`} onClick={() => set(k, !f[k])} aria-label={t}><i /></button>
              </div>
            ))}

            <div className="usr-sec">Obras <span className="usr-sec-hint">nenhuma marcada = todas</span></div>
            <div className="toggle-chips">
              {obras.map(o => (
                <button key={o.prevision_id} className={`tchip ${f.obras.includes(o.prevision_id) ? 'on' : ''}`} onClick={() => toggleArr('obras', o.prevision_id)}>{o.nome}</button>
              ))}
            </div>
          </>
        )}

        {erro && <div className="msg bad" style={{ marginTop: 14 }}>{erro}</div>}
        {msg && <div className="msg ok" style={{ marginTop: 14 }}>{msg}</div>}
        <div className="usr-acts">
          <button className="ghost" onClick={onVoltar} disabled={proc}>Cancelar</button>
          <button className="cta" onClick={salvar} disabled={proc}>{proc ? 'Salvando…' : 'Salvar alterações'}</button>
        </div>
      </div>
    </div>
  )
}
