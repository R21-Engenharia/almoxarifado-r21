import { useEffect, useMemo, useState } from 'react'
import { api, num, type EapLista, type EapRef, type EapOrcada } from './api'
import { useEapLista } from './eapDados'

// Subetapa (EAP) do consumo: em que parte do orçamento o material vai ser aplicado.
// A lista vem uma vez por obra (cache em memória); as sugestões vêm de onde os itens
// da cesta estão orçados no Sienge.

const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const chaveEap = (e: { uc_id: number | null; codigo: string }) => `${e.uc_id ?? ''}|${e.codigo}`

export type ItemSugestao = { resource_id: string; detail_id?: number | null; trademark_id?: number | null }

export function EapCampo({ obra, valor, onChange, sugerirDe = [], rotulo }: {
  obra: string; valor: EapRef | null; onChange: (e: EapRef | null) => void
  sugerirDe?: ItemSugestao[]; rotulo?: string
}) {
  const lista = useEapLista(obra)
  const [aberto, setAberto] = useState(false)
  if (!lista) return <div className="campo eap-campo"><span>{rotulo || 'Subetapa (EAP)'}</span><div className="eap-vazio">carregando subetapas…</div></div>
  if (!lista.tem_mapa) return null
  return (
    <div className="campo eap-campo">
      <span>{rotulo || 'Subetapa (EAP) onde o material vai ser aplicado *'}</span>
      <button type="button" className={`eap-btn ${valor ? 'on' : ''}`} onClick={() => setAberto(true)}>
        {valor ? <><b>{valor.codigo}</b> {valor.descricao}</> : 'Escolher subetapa…'}
      </button>
      {aberto && <EapModal obra={obra} lista={lista} sugerirDe={sugerirDe}
        onEscolher={e => { onChange(e); setAberto(false) }} onClose={() => setAberto(false)} />}
    </div>
  )
}

function EapModal({ obra, lista, sugerirDe, onEscolher, onClose }: {
  obra: string; lista: EapLista; sugerirDe: ItemSugestao[]
  onEscolher: (e: EapRef) => void; onClose: () => void
}) {
  const [q, setQ] = useState('')
  const [orcadas, setOrcadas] = useState<(EapOrcada & { n: number })[] | null>(null)

  // onde os itens da cesta estão orçados (uma consulta por insumo/variação, no máx. 8)
  const alvo = useMemo(() => {
    const m = new Map<string, ItemSugestao>()
    sugerirDe.forEach(i => m.set(`${i.resource_id}|${i.detail_id ?? ''}|${i.trademark_id ?? ''}`, i))
    return Array.from(m.values()).slice(0, 8)
  }, [sugerirDe])
  useEffect(() => {
    if (!alvo.length) { setOrcadas([]); return }
    Promise.all(alvo.map(i => api.eapInsumo(obra, i.resource_id, i.detail_id, i.trademark_id)
      .then(r => r.orcadas).catch(() => [] as EapOrcada[])))
      .then(listas => {
        const m = new Map<string, EapOrcada & { n: number }>()
        listas.forEach(l => {
          const vistas = new Set<string>()
          l.forEach(o => {
            const k = chaveEap(o)
            if (vistas.has(k)) return
            vistas.add(k)
            const cur = m.get(k)
            m.set(k, cur ? { ...cur, n: cur.n + 1 } : { ...o, n: 1 })
          })
        })
        setOrcadas(Array.from(m.values()).sort((a, b) => b.n - a.n).slice(0, 12))
      })
  }, [obra, alvo])

  const indice = useMemo(() => lista.subetapas.map(s => ({
    s, txt: norm(`${s.codigo} ${s.descricao} ${s.pai || ''} ${s.grupo || ''}`),
  })), [lista])
  const achados = useMemo(() => {
    const ts = norm(q).split(/\s+/).filter(Boolean)
    if (!ts.length) return []
    return indice.filter(x => ts.every(t => x.txt.includes(t))).slice(0, 60).map(x => x.s)
  }, [indice, q])
  const porChave = useMemo(() => new Map(lista.subetapas.map(s => [chaveEap(s), s])), [lista])

  const linha = (e: EapRef, extra?: string, pre = '') => {
    const s = porChave.get(chaveEap(e))
    return (
      <button key={pre + chaveEap(e)} className="eap-linha" onClick={() => onEscolher({ uc_id: e.uc_id, codigo: e.codigo, descricao: s?.descricao || e.descricao })}>
        <span className="eap-cod">{e.codigo}</span>
        <span className="eap-txt">{s?.descricao || e.descricao}
          <em>{[s?.pai, s?.uc_nome, extra].filter(Boolean).join(' · ')}</em></span>
      </button>
    )
  }

  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-card eap-card" onClick={e => e.stopPropagation()}>
        <h3>Subetapa do consumo</h3>
        <input className="busca" autoFocus placeholder="buscar por código ou descrição (ex.: alvenaria 2º pav)…"
          value={q} onChange={e => setQ(e.target.value)} />
        <div className="eap-scroll">
          {q.trim() ? (
            <>
              {achados.map(s => linha(s))}
              {achados.length === 0 && <div className="eap-vazio">Nenhuma subetapa com esse texto.</div>}
            </>
          ) : (
            <>
              <div className="eap-sec">Onde estes itens estão orçados</div>
              {orcadas === null && <div className="eap-vazio">consultando o orçamento…</div>}
              {orcadas && orcadas.length === 0 && <div className="eap-vazio">Nenhum item da cesta tem orçamento apropriado — busque a subetapa acima.</div>}
              {orcadas?.map(o => linha(o, [o.qtd_orcada != null ? `orçado ${num(o.qtd_orcada, 2)}` : '',
                alvo.length > 1 ? `${o.n} de ${alvo.length} itens` : ''].filter(Boolean).join(' · ')))}
              {lista.recentes.length > 0 && <div className="eap-sec">Últimas usadas nesta obra</div>}
              {lista.recentes.map(r => linha(r, undefined, 'r'))}
            </>
          )}
        </div>
        <div className="modal-acts"><button className="ghost" onClick={onClose}>Fechar</button></div>
      </div>
    </div>
  )
}
