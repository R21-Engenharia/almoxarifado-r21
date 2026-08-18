import { useRef, useState } from 'react'
import { salvarPerfil, uploadFoto, type Perfil, type DadosGoogle } from './perfil'

const FUNCOES = ['Almoxarife', 'Comprador', 'Engenheiro(a)', 'Mestre de obras', 'Gestor(a)', 'Estagiário(a)']

export function Avatar({ url, nome, size = 32 }: { url?: string | null; nome?: string | null; size?: number }) {
  const inicial = (nome || '?').trim().charAt(0).toUpperCase()
  if (url) return <img className="avatar" src={url} alt={nome || ''} style={{ width: size, height: size }} />
  return <span className="avatar avatar-ph" style={{ width: size, height: size, fontSize: size * 0.42 }}>{inicial}</span>
}

export function PerfilModal({ perfil, google, obrigatorio, onSalvo, onFechar }: {
  perfil: Perfil | null
  google: DadosGoogle
  obrigatorio: boolean
  onSalvo: (p: Perfil) => void
  onFechar: () => void
}) {
  const [nome, setNome] = useState(perfil?.nome || google.nome || '')
  const [funcao, setFuncao] = useState(perfil?.funcao || '')
  const [foto, setFoto] = useState<string | null>(perfil?.foto_url || google.foto || null)
  const [salvando, setSalvando] = useState(false)
  const [enviandoFoto, setEnviandoFoto] = useState(false)
  const [erro, setErro] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const escolherFoto = async (f: File | undefined) => {
    if (!f) return
    setErro(''); setEnviandoFoto(true)
    try { setFoto(await uploadFoto(f)) }
    catch (e) { setErro('Falha ao enviar a foto: ' + (e instanceof Error ? e.message : String(e))) }
    finally { setEnviandoFoto(false) }
  }

  const salvar = async () => {
    if (!nome.trim()) { setErro('Informe seu nome.'); return }
    setErro(''); setSalvando(true)
    try {
      await salvarPerfil({ nome: nome.trim(), funcao: funcao.trim(), foto_url: foto })
      onSalvo({ id: perfil?.id || '', email: google.email, nome: nome.trim(), funcao: funcao.trim(), foto_url: foto })
    } catch (e) { setErro('Falha ao salvar: ' + (e instanceof Error ? e.message : String(e))) }
    finally { setSalvando(false) }
  }

  return (
    <div className="modal" onClick={() => !obrigatorio && onFechar()}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <h3>{obrigatorio ? 'Complete seu perfil' : 'Meu perfil'}</h3>
        {obrigatorio && <p className="warn-txt">Confirme seus dados para começar a usar o app.</p>}

        <div className="perfil-foto">
          <Avatar url={foto} nome={nome} size={84} />
          <input ref={fileRef} type="file" accept="image/*" hidden
            onChange={e => escolherFoto(e.target.files?.[0])} />
          <button className="ghost" onClick={() => fileRef.current?.click()} disabled={enviandoFoto}>
            {enviandoFoto ? 'Enviando…' : (foto ? 'Trocar foto' : 'Adicionar foto')}
          </button>
        </div>

        <label className="campo">
          <span>Nome</span>
          <input value={nome} onChange={e => setNome(e.target.value)} placeholder="seu nome" autoFocus />
        </label>

        <label className="campo">
          <span>Função</span>
          <input value={funcao} onChange={e => setFuncao(e.target.value)} placeholder="ex.: Almoxarife" list="funcoes" />
          <datalist id="funcoes">{FUNCOES.map(f => <option key={f} value={f} />)}</datalist>
        </label>

        <div className="campo-email">{google.email}</div>
        {erro && <div className="msg bad">{erro}</div>}

        <div className="modal-acts">
          {!obrigatorio && <button className="ghost" onClick={onFechar} disabled={salvando}>Fechar</button>}
          <button className="cta" onClick={salvar} disabled={salvando || enviandoFoto}>
            {salvando ? 'Salvando…' : 'Salvar'}</button>
        </div>
      </div>
    </div>
  )
}
