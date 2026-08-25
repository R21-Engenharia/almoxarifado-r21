import { useEffect, useMemo, useState } from 'react'
import { api, type Conta, type Obra } from './api'
import { authAtiva } from './supabase'
import { MODULOS } from './modulos'
import Loader from './Loader'

type Tab = 'info' | 'perms'
const ROLES = [
  { v: 'user', l: 'Sem papel na aprovação' },
  { v: 'engenheiro', l: 'Engenheiro (1ª aprovação)' },
  { v: 'planejamento', l: 'Planejamento (2ª aprovação)' },
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

  if (sel || novo) {
    return <Detalhe conta={sel} obras={obras}
      onSalvo={() => { setSel(null); setNovo(false); carregar() }}
      onVoltar={() => { setSel(null); setNovo(false) }} />
  }

  return (
    <div className="dash">
      <div className="chart-card">
        <div className="chart-head">
          <div><h3>Usuários</h3><span className="chart-sub">Contas com acesso ao BOX21 e o que cada uma pode fazer</span></div>
          <button className="cta" onClick={() => setNovo(true)}>+ Novo usuário</button>
        </div>
        {erro && <div className="msg bad">{erro}</div>}
        <div className="req-topo" style={{ marginBottom: 12 }}>
          <input className="busca" placeholder="Buscar por nome, e-mail ou cargo…" value={q} onChange={e => setQ(e.target.value)} />
          <label className="campo" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={soAtivos} onChange={e => setSoAtivos(e.target.checked)} style={{ width: 16, height: 16 }} />
            <span style={{ margin: 0 }}>Só ativos</span></label>
        </div>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Nome · Cargo/Função</th><th>E-mail</th><th>Tipo</th><th>Papel</th><th>Status</th></tr></thead>
            <tbody>
              {filtrada.map(u => (
                <tr key={u.email} style={{ cursor: 'pointer' }} onClick={() => setSel(u)}>
                  <td><div className="desc">{u.nome || u.email}</div><div className="meta">{u.cargo || '—'}</div></td>
                  <td><div className="desc" style={{ fontSize: 13 }}>{u.email}</div></td>
                  <td>{u.tipo}</td>
                  <td><span className="meta">{ROLES.find(r => r.v === u.role)?.l.split(' (')[0] || u.role}</span></td>
                  <td><span className={`pill ${u.ativo ? 'ok' : ''}`}>{u.ativo ? 'Ativo' : 'Inativo'}</span></td>
                </tr>
              ))}
              {filtrada.length === 0 && <tr><td colSpan={5}><div className="empty">Nenhum usuário.</div></td></tr>}
            </tbody>
          </table>
        </div>
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

  const salvar = async () => {
    if (!f.email.trim() || !f.email.includes('@')) { setErro('Informe um e-mail válido.'); return }
    setProc(true); setErro('')
    try { await api.salvarUsuario(f); setMsg('✓ Salvo.'); setTimeout(onSalvo, 900) }
    catch (e) { setErro(e instanceof Error ? e.message : String(e)); setProc(false) }
  }

  return (
    <div className="dash">
      <div className="chart-card" style={{ maxWidth: 760 }}>
        <div className="chart-head">
          <div>
            <button className="mini" onClick={onVoltar}>← Usuários</button>
            <h3 style={{ marginTop: 8 }}>{f.nome || (conta ? f.email : 'Novo usuário')}</h3>
          </div>
          <button className="ghost" onClick={() => set('ativo', !f.ativo)} style={{ color: f.ativo ? 'var(--ruptura)' : 'var(--ok)' }}>
            {f.ativo ? 'Inativar usuário' : 'Reativar usuário'}</button>
        </div>

        <div className="chips">
          <button className={tab === 'info' ? 'on' : ''} onClick={() => setTab('info')}>Informações</button>
          <button className={tab === 'perms' ? 'on' : ''} onClick={() => setTab('perms')}>Permissões</button>
        </div>

        {tab === 'info' ? (
          <div style={{ maxWidth: 460 }}>
            <label className="campo"><span>Nome *</span>
              <input value={f.nome || ''} onChange={e => set('nome', e.target.value)} placeholder="Nome e cargo" /></label>
            <label className="campo"><span>E-mail *</span>
              <input value={f.email} onChange={e => set('email', e.target.value.toLowerCase())} disabled={!!conta} placeholder="email@empresa.com" /></label>
            <label className="campo"><span>Cargo / Função</span>
              <input value={f.cargo || ''} onChange={e => set('cargo', e.target.value)} placeholder="ex.: Analista de Planejamento" /></label>
            <div className="req-topo">
              <label className="campo"><span>Tipo</span>
                <select value={f.tipo} onChange={e => set('tipo', e.target.value)}>
                  <option>Geral</option><option>Administrador</option><option>Terceiro</option></select></label>
              <label className="campo"><span>Papel na aprovação</span>
                <select value={f.role} onChange={e => set('role', e.target.value)}>
                  {ROLES.map(r => <option key={r.v} value={r.v}>{r.l}</option>)}</select></label>
            </div>
          </div>
        ) : (
          <div>
            <div className="meta" style={{ marginBottom: 12 }}>Marque os módulos que este usuário pode acessar. <b>Nenhum marcado = acesso a todos.</b></div>
            {(['Dashboards', 'Almoxarifado'] as const).map(g => (
              <div key={g} style={{ marginBottom: 12 }}>
                <div className="side-grupo-tt" style={{ padding: '0 0 6px' }}>{g}</div>
                <div className="perm-grid">
                  {MODULOS.filter(m => m.grupo === g).map(m => (
                    <label key={m.id} className="perm-item">
                      <input type="checkbox" checked={f.modulos.includes(m.id)} onChange={() => toggleArr('modulos', m.id)} />
                      <span>{m.nome}</span></label>
                  ))}
                </div>
              </div>
            ))}

            <div className="side-grupo-tt" style={{ padding: '8px 0 6px' }}>Ações sensíveis</div>
            <div className="perm-grid">
              <label className="perm-item"><input type="checkbox" checked={f.gerenciar_usuarios} onChange={e => set('gerenciar_usuarios', e.target.checked)} /><span>Gerenciar usuários</span></label>
              <label className="perm-item"><input type="checkbox" checked={f.operar} onChange={e => set('operar', e.target.checked)} /><span>Operar (baixa/entrada no Sienge)</span></label>
              <label className="perm-item"><input type="checkbox" checked={f.gerar_plano} onChange={e => set('gerar_plano', e.target.checked)} /><span>Gerar plano de compra</span></label>
            </div>

            <div className="side-grupo-tt" style={{ padding: '14px 0 6px' }}>Obras que pode acessar <span className="meta">(nenhuma = todas)</span></div>
            <div className="perm-grid">
              {obras.map(o => (
                <label key={o.prevision_id} className="perm-item">
                  <input type="checkbox" checked={f.obras.includes(o.prevision_id)} onChange={() => toggleArr('obras', o.prevision_id)} />
                  <span>{o.nome}</span></label>
              ))}
            </div>
          </div>
        )}

        {erro && <div className="msg bad">{erro}</div>}
        {msg && <div className="msg ok">{msg}</div>}
        <div className="modal-acts">
          <button className="ghost" onClick={onVoltar} disabled={proc}>Cancelar</button>
          <button className="cta" onClick={salvar} disabled={proc}>{proc ? 'Salvando…' : 'Salvar'}</button>
        </div>
      </div>
    </div>
  )
}
