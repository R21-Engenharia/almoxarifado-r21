import { useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import { authAtiva } from './supabase'
import {
  listar, criar, movimentar, historico, uploadFotoEquip, buscarPorId,
  STATUS_EQUIP, CONSERVACAO_LABEL,
  type Equipamento, type EquipStatus, type Conservacao, type EquipMov,
} from './equipamentos'

const STATUS_TONE: Record<EquipStatus, string> = {
  almoxarifado: 'ok', campo: 'baixo', manutencao: 'critico', emprestado: 'parado', inativo: '',
}
const CONS_TONE: Record<Conservacao, string> = { bom: 'ok', regular: 'baixo', ruim: 'ruptura' }
const hoje = () => new Date().toISOString().slice(0, 10)
const vencida = (d: string | null) => !!d && d < hoje()

export default function Equipamentos({ obra, operador, abrirId }: { obra: string; operador: string; abrirId?: string }) {
  const [lista, setLista] = useState<Equipamento[]>([])
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  const [filtro, setFiltro] = useState<'' | EquipStatus>('')
  const [novo, setNovo] = useState(false)
  const [movEq, setMovEq] = useState<Equipamento | null>(null)
  const [histEq, setHistEq] = useState<Equipamento | null>(null)
  const [qrEq, setQrEq] = useState<Equipamento | null>(null)

  const carregar = () => listar(obra).then(setLista).catch(e => setErr(e instanceof Error ? e.message : String(e)))
  useEffect(() => { setErr(''); carregar() }, [obra])

  // deep-link do QR: ?eq=<id> abre direto a movimentação daquele equipamento
  useEffect(() => {
    if (abrirId) buscarPorId(abrirId).then(e => { if (e) setMovEq(e) }).catch(() => {})
  }, [abrirId])

  const filtrados = useMemo(() => {
    const ql = q.toLowerCase().trim()
    return lista.filter(e => (!filtro || e.status === filtro) &&
      (!ql || e.codigo.toLowerCase().includes(ql) || e.nome.toLowerCase().includes(ql) ||
       (e.responsavel || '').toLowerCase().includes(ql)))
  }, [lista, q, filtro])

  const k = useMemo(() => ({
    total: lista.length,
    campo: lista.filter(e => e.status === 'campo').length,
    almox: lista.filter(e => e.status === 'almoxarifado').length,
    manut: lista.filter(e => e.status === 'manutencao').length,
    venc: lista.filter(e => vencida(e.prox_manutencao) && e.status !== 'inativo').length,
  }), [lista])

  if (!authAtiva) return <div className="empty">Os equipamentos exigem login (Supabase). Rode o app em produção.</div>

  return (
    <div className="dash">
      <div className="kpi-row eq-kpis">
        <Kpi rot="Equipamentos" v={k.total} />
        <Kpi rot="Em campo" v={k.campo} tone="baixo" />
        <Kpi rot="No almoxarifado" v={k.almox} tone="ok" />
        <Kpi rot="Em manutenção" v={k.manut} tone="critico" />
        <Kpi rot="Manutenção vencida" v={k.venc} tone={k.venc ? 'ruptura' : ''} />
      </div>

      {err && <div className="msg bad" onClick={() => setErr('')}>{err}</div>}

      <div className="chart-card">
        <div className="chart-head">
          <div><h3>Frota de equipamentos</h3><span className="chart-sub">Onde está, com quem, conservação e manutenção · controle BOX21</span></div>
          <div className="chart-ctrls">
            <input className="busca" placeholder="buscar código, nome, responsável…" value={q} onChange={e => setQ(e.target.value)} style={{ minWidth: 200 }} />
            <button className="cta" onClick={() => setNovo(true)}>+ Novo equipamento</button>
          </div>
        </div>

        <div className="chips">
          <button className={!filtro ? 'on' : ''} onClick={() => setFiltro('')}>Todos</button>
          {(Object.keys(STATUS_EQUIP) as EquipStatus[]).map(s =>
            <button key={s} className={filtro === s ? 'on' : ''} onClick={() => setFiltro(s)}>{STATUS_EQUIP[s]}</button>)}
        </div>

        <div className="tbl-wrap">
          <table className="tbl eq-tbl">
            <thead><tr>
              <th></th><th>Código / Nome</th><th>Tipo</th><th>Status</th><th>Conservação</th>
              <th>Localização</th><th>Responsável</th><th>Próx. manut.</th><th></th>
            </tr></thead>
            <tbody>
              {filtrados.map(e => (
                <tr key={e.id}>
                  <td>{e.foto_url ? <img className="eq-foto" src={e.foto_url} alt="" /> : <span className="eq-foto ph">🔧</span>}</td>
                  <td><div className="desc">{e.codigo}</div><div className="meta">{e.nome}{e.marca_modelo ? ` · ${e.marca_modelo}` : ''}</div></td>
                  <td>{e.tipo || '—'}</td>
                  <td><span className={`pill ${STATUS_TONE[e.status]}`}>{STATUS_EQUIP[e.status]}</span></td>
                  <td><span className={`pill ${CONS_TONE[e.conservacao]}`}>{CONSERVACAO_LABEL[e.conservacao]}</span></td>
                  <td>{e.localizacao || '—'}</td>
                  <td>{e.responsavel || '—'}</td>
                  <td>{e.prox_manutencao ? <span style={vencida(e.prox_manutencao) ? { color: 'var(--ruptura)', fontWeight: 700 } : undefined}>{new Date(e.prox_manutencao + 'T00:00').toLocaleDateString('pt-BR')}</span> : '—'}</td>
                  <td className="r nowrap">
                    <button className="mini" onClick={() => setMovEq(e)}>Movimentar</button>
                    <button className="mini" style={{ marginLeft: 6 }} onClick={() => setQrEq(e)}>QR</button>
                    <button className="mini" style={{ marginLeft: 6 }} onClick={() => setHistEq(e)}>Histórico</button>
                  </td>
                </tr>
              ))}
              {filtrados.length === 0 && <tr><td colSpan={9}><div className="empty">Nenhum equipamento. Cadastre o primeiro em "+ Novo equipamento".</div></td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {novo && <CadastroModal obra={obra} operador={operador} onSalvo={() => { setNovo(false); carregar() }} onFechar={() => setNovo(false)} />}
      {movEq && <MovimentarModal eq={movEq} onSalvo={() => { setMovEq(null); carregar() }} onFechar={() => setMovEq(null)} />}
      {histEq && <HistoricoModal eq={histEq} onFechar={() => setHistEq(null)} />}
      {qrEq && <QrModal eq={qrEq} onFechar={() => setQrEq(null)} />}
    </div>
  )
}

function Kpi({ rot, v, tone }: { rot: string; v: number; tone?: string }) {
  return <div className="kpi-card"><div className="kpi-rot">{rot}</div><div className="kpi-big" style={tone === 'ruptura' && v > 0 ? { color: 'var(--ruptura)' } : undefined}>{v}</div></div>
}

function CadastroModal({ obra, operador, onSalvo, onFechar }: { obra: string; operador: string; onSalvo: () => void; onFechar: () => void }) {
  const [f, setF] = useState({ codigo: '', nome: '', tipo: '', marca_modelo: '', localizacao: 'Almoxarifado', responsavel: operador, prox_manutencao: '' })
  const [foto, setFoto] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const set = (k: string, v: string) => setF(s => ({ ...s, [k]: v }))

  const subirFoto = async (file?: File) => {
    if (!file) return
    setEnviando(true); setErro('')
    try { setFoto(await uploadFotoEquip(file)) } catch (e) { setErro(String(e)) } finally { setEnviando(false) }
  }
  const salvar = async () => {
    if (!f.codigo.trim() || !f.nome.trim()) { setErro('Código e nome são obrigatórios.'); return }
    setSalvando(true); setErro('')
    try {
      await criar({ obra, codigo: f.codigo.trim(), nome: f.nome.trim(), tipo: f.tipo.trim() || null,
        marca_modelo: f.marca_modelo.trim() || null, localizacao: f.localizacao.trim() || null,
        responsavel: f.responsavel.trim() || null, prox_manutencao: f.prox_manutencao || null,
        foto_url: foto, status: 'almoxarifado', conservacao: 'bom' })
      onSalvo()
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)) } finally { setSalvando(false) }
  }
  return (
    <div className="modal" onClick={() => !salvando && onFechar()}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <h3>Novo equipamento</h3>
        <div className="perfil-foto">
          {foto ? <img className="eq-foto big" src={foto} alt="" /> : <span className="eq-foto big ph">🔧</span>}
          <label className="ghost" style={{ cursor: 'pointer' }}>{enviando ? 'Enviando…' : 'Adicionar foto'}
            <input type="file" accept="image/*" hidden onChange={e => subirFoto(e.target.files?.[0])} /></label>
        </div>
        <div className="req-topo"><Campo l="Código *" v={f.codigo} on={v => set('codigo', v)} ph="EP026" />
          <Campo l="Tipo" v={f.tipo} on={v => set('tipo', v)} ph="Betoneira, Furadeira…" /></div>
        <Campo l="Nome *" v={f.nome} on={v => set('nome', v)} ph="nome do equipamento" />
        <div className="req-topo"><Campo l="Marca / Modelo" v={f.marca_modelo} on={v => set('marca_modelo', v)} />
          <Campo l="Próxima manutenção" v={f.prox_manutencao} on={v => set('prox_manutencao', v)} type="date" /></div>
        <div className="req-topo"><Campo l="Localização" v={f.localizacao} on={v => set('localizacao', v)} />
          <Campo l="Responsável" v={f.responsavel} on={v => set('responsavel', v)} /></div>
        {erro && <div className="msg bad">{erro}</div>}
        <div className="modal-acts"><button className="ghost" onClick={onFechar} disabled={salvando}>Cancelar</button>
          <button className="cta" onClick={salvar} disabled={salvando || enviando}>{salvando ? 'Salvando…' : 'Cadastrar'}</button></div>
      </div>
    </div>
  )
}

function MovimentarModal({ eq, onSalvo, onFechar }: { eq: Equipamento; onSalvo: () => void; onFechar: () => void }) {
  const [status, setStatus] = useState<EquipStatus>(eq.status)
  const [conservacao, setConservacao] = useState<Conservacao>(eq.conservacao)
  const [localizacao, setLocalizacao] = useState(eq.localizacao || '')
  const [responsavel, setResponsavel] = useState(eq.responsavel || '')
  const [prox, setProx] = useState(eq.prox_manutencao || '')
  const [obs, setObs] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  const salvar = async () => {
    setSalvando(true); setErro('')
    try {
      const tipo = status !== eq.status
        ? (status === 'manutencao' ? 'manutencao' : status === 'campo' || status === 'emprestado' ? 'saida' : status === 'almoxarifado' ? 'retorno' : 'transferencia')
        : 'transferencia'
      await movimentar(eq.id, { status, conservacao, localizacao: localizacao.trim() || null,
        responsavel: responsavel.trim() || null, prox_manutencao: prox || null }, { tipo, obs: obs.trim() || undefined })
      onSalvo()
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)) } finally { setSalvando(false) }
  }
  return (
    <div className="modal" onClick={() => !salvando && onFechar()}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <h3>Movimentar · {eq.codigo}</h3>
        <p className="warn-txt" style={{ color: 'var(--muted)' }}>{eq.nome}</p>
        <label className="campo"><span>Status</span>
          <select value={status} onChange={e => setStatus(e.target.value as EquipStatus)}>
            {(Object.keys(STATUS_EQUIP) as EquipStatus[]).map(s => <option key={s} value={s}>{STATUS_EQUIP[s]}</option>)}</select></label>
        <div className="req-topo">
          <label className="campo"><span>Conservação</span>
            <select value={conservacao} onChange={e => setConservacao(e.target.value as Conservacao)}>
              {(Object.keys(CONSERVACAO_LABEL) as Conservacao[]).map(c => <option key={c} value={c}>{CONSERVACAO_LABEL[c]}</option>)}</select></label>
          <Campo l="Próxima manutenção" v={prox} on={setProx} type="date" />
        </div>
        <div className="req-topo"><Campo l="Localização" v={localizacao} on={setLocalizacao} />
          <Campo l="Responsável" v={responsavel} on={setResponsavel} /></div>
        <Campo l="Observação" v={obs} on={setObs} ph="ex.: levado para a frente de escavação" />
        {erro && <div className="msg bad">{erro}</div>}
        <div className="modal-acts"><button className="ghost" onClick={onFechar} disabled={salvando}>Cancelar</button>
          <button className="cta" onClick={salvar} disabled={salvando}>{salvando ? 'Salvando…' : 'Registrar movimentação'}</button></div>
      </div>
    </div>
  )
}

function HistoricoModal({ eq, onFechar }: { eq: Equipamento; onFechar: () => void }) {
  const [movs, setMovs] = useState<EquipMov[]>([])
  useEffect(() => { historico(eq.id).then(setMovs) }, [eq.id])
  return (
    <div className="modal" onClick={onFechar}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <h3>Histórico · {eq.codigo}</h3>
        <ul className="conf-list" style={{ maxHeight: '50vh' }}>
          {movs.map(m => (
            <li key={m.id} style={{ display: 'block' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <b>{m.tipo}</b><span className="meta">{new Date(m.quando).toLocaleString('pt-BR')}</span>
              </div>
              <div className="meta">{[m.status, m.localizacao, m.responsavel].filter(Boolean).join(' · ')}{m.obs ? ` — ${m.obs}` : ''} · {m.usuario}</div>
            </li>
          ))}
          {movs.length === 0 && <div className="empty">Sem movimentações.</div>}
        </ul>
        <div className="modal-acts"><button className="cta" onClick={onFechar}>Fechar</button></div>
      </div>
    </div>
  )
}

function QrModal({ eq, onFechar }: { eq: Equipamento; onFechar: () => void }) {
  const [url, setUrl] = useState('')
  const link = `${window.location.origin}/?eq=${eq.id}`
  useEffect(() => {
    QRCode.toDataURL(link, { width: 320, margin: 1 }).then(setUrl).catch(() => {})
  }, [link])
  return (
    <div className="modal" onClick={onFechar}>
      <div className="modal-card" onClick={e => e.stopPropagation()} style={{ maxWidth: 380 }}>
        <div className="ficha-print">
          <div className="qr-etiqueta">
            <div className="qr-marca">BOX21</div>
            {url && <img src={url} alt="QR" className="qr-img" />}
            <div className="qr-cod">{eq.codigo}</div>
            <div className="qr-nome">{eq.nome}</div>
          </div>
        </div>
        <p className="chart-sub no-print" style={{ textAlign: 'center', margin: '10px 0' }}>
          Escaneie para abrir e movimentar este equipamento.
        </p>
        <div className="modal-acts no-print">
          <button className="ghost" onClick={onFechar}>Fechar</button>
          <button className="cta" onClick={() => window.print()}>Imprimir etiqueta</button>
        </div>
      </div>
    </div>
  )
}

function Campo({ l, v, on, ph, type }: { l: string; v: string; on: (v: string) => void; ph?: string; type?: string }) {
  return <label className="campo"><span>{l}</span><input type={type || 'text'} value={v} placeholder={ph} onChange={e => on(e.target.value)} /></label>
}
