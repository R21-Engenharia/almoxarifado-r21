import { useEffect, useState } from 'react'
import { api, num, type Item, type Variante, type Embalagem, type EscritaItem } from './api'

// Uma linha da cesta: insumo + variação (detalhe/cor/bitola) + unidade de movimento.
export type CestaLinha = {
  key: string; item: Item
  detailId: number | null; trademarkId: number | null; varianteLabel: string
  embalagemNome: string; fator: number; qtdEmb: number; baseQtd: number
  unidade: string; saldoVariante: number
}

export function linhaParaEscrita(l: CestaLinha): EscritaItem {
  return {
    resource_id: l.item.resource_id, quantidade: l.baseQtd, unidade: l.unidade, descricao: l.item.descricao,
    detail_id: l.detailId, trademark_id: l.trademarkId, variante: l.varianteLabel || undefined,
    embalagem: l.embalagemNome || undefined, fator_embalagem: l.embalagemNome ? l.fator : undefined,
  }
}

// Rótulo curto p/ exibir a linha (variação + embalagem) em cestas/fichas.
export function resumoLinha(l: CestaLinha): string {
  const p: string[] = []
  if (l.varianteLabel) p.push(l.varianteLabel)
  if (l.embalagemNome) p.push(`${num(l.qtdEmb, 2)} ${l.embalagemNome} × ${num(l.fator, 2)}`)
  return p.join(' · ')
}

export function AddInsumoModal({ obra, op, item, embalagens, onEmbSalva, onAdd, onClose, verbo }: {
  obra: string; op: 'baixa' | 'entrada'; item: Item; embalagens: Embalagem[]
  onEmbSalva: () => void
  onAdd: (l: CestaLinha) => void; onClose: () => void; verbo?: string
}) {
  const [vars, setVars] = useState<Variante[] | null>(null)
  const [vi, setVi] = useState(0)
  const [embId, setEmbId] = useState<string>('')
  const [fator, setFator] = useState(1)
  const [qtd, setQtd] = useState('')
  const [novaEmb, setNovaEmb] = useState(false)
  const [nomeEmb, setNomeEmb] = useState(''); const [fatorEmb, setFatorEmb] = useState('')
  const [erro, setErro] = useState('')

  useEffect(() => {
    api.insumoVariantes(obra, item.resource_id, op === 'entrada')
      .then(r => setVars(r.variantes))
      .catch(() => setVars([]))
  }, [obra, item.resource_id, op])

  const emb = embalagens.find(e => e.id === embId)
  useEffect(() => { setFator(emb ? emb.fator : 1) }, [embId]) // eslint-disable-line
  const variante = vars && vars.length ? vars[Math.min(vi, vars.length - 1)] : null
  const unidade = variante?.unidade || item.unidade
  const temVar = !!vars && vars.some(v => v.detail_id != null || v.trademark_id != null)
  const qNum = parseFloat(qtd) || 0
  const baseQtd = qNum * (fator || 1)
  const saldoVar = variante?.saldo ?? item.saldo
  const excede = op === 'baixa' && baseQtd > saldoVar + 1e-6

  const salvarNovaEmb = async () => {
    const f = parseFloat(fatorEmb) || 0
    if (!nomeEmb.trim() || f <= 0) { setErro('Informe nome e fator (> 0).'); return }
    try {
      const e = await api.salvarEmbalagem({ resource_id: item.resource_id, nome: nomeEmb.trim(), fator: f, unidade })
      onEmbSalva(); setNovaEmb(false); setNomeEmb(''); setFatorEmb(''); setEmbId(e.id)
    } catch (ex) { setErro(ex instanceof Error ? ex.message : String(ex)) }
  }

  const adicionar = () => {
    if (baseQtd <= 0) { setErro('Informe a quantidade.'); return }
    if (op === 'baixa' && !variante && temVar) { setErro('Escolha a variação.'); return }
    const label = variante ? [variante.detail_desc, variante.trademark_desc].filter(Boolean).join(' / ') : ''
    onAdd({
      key: `${item.resource_id}|${variante?.detail_id ?? ''}|${variante?.trademark_id ?? ''}|${emb?.nome ?? ''}`,
      item, detailId: variante?.detail_id ?? null, trademarkId: variante?.trademark_id ?? null,
      varianteLabel: label, embalagemNome: emb?.nome ?? '', fator: fator || 1,
      qtdEmb: qNum, baseQtd, unidade, saldoVariante: saldoVar,
    })
    onClose()
  }

  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-card add-card" onClick={e => e.stopPropagation()}>
        <h3>{verbo || (op === 'baixa' ? 'Baixar' : 'Dar entrada em')}: {item.descricao}</h3>
        <div className="add-sub">#{item.resource_id} · saldo total {num(item.saldo, 2)} {item.unidade}</div>

        {vars === null ? <div className="add-load">carregando variações…</div> : temVar && (
          <div className="add-blk">
            <label>Variação / especificação {op === 'baixa' ? '(saldo por variação)' : ''}</label>
            <div className="var-chips">
              {vars.map((v, idx) => (
                <button key={idx} className={idx === vi ? 'on' : ''} onClick={() => setVi(idx)}>
                  {[v.detail_desc, v.trademark_desc].filter(Boolean).join(' / ') || '—'}
                  <em>{num(v.saldo, 0)} {v.unidade}</em>
                </button>
              ))}
              {vars.length === 0 && <span className="add-vazio">Sem saldo por variação nesta obra.</span>}
            </div>
          </div>
        )}

        <div className="add-blk">
          <label>Unidade de movimento {op === 'entrada' ? '(como o produto entra)' : '(como sai)'}</label>
          <div className="var-chips">
            <button className={!embId ? 'on' : ''} onClick={() => setEmbId('')}>{unidade} <em>base</em></button>
            {embalagens.map(e => (
              <button key={e.id} className={embId === e.id ? 'on' : ''} onClick={() => setEmbId(e.id)}>
                {e.nome} <em>{num(e.fator, 0)} {e.unidade || unidade}</em>
              </button>
            ))}
            <button className="add-nova" onClick={() => setNovaEmb(v => !v)}>+ embalagem</button>
          </div>
          {embId && (
            <div className="add-fator">
              1 {emb?.nome} = <input type="number" min={0} step="any" value={fator}
                onChange={e => setFator(parseFloat(e.target.value) || 0)} /> {unidade} <span className="add-hint">(ajuste se este lote for diferente)</span>
            </div>
          )}
          {novaEmb && (
            <div className="add-nova-form">
              <input placeholder="nome (ex.: Rolo, Balde, Caixa)" value={nomeEmb} onChange={e => setNomeEmb(e.target.value)} />
              <input type="number" min={0} step="any" placeholder={`quantos ${unidade} tem`} value={fatorEmb} onChange={e => setFatorEmb(e.target.value)} />
              <button className="mini forte" onClick={salvarNovaEmb}>Salvar</button>
            </div>
          )}
        </div>

        <div className="add-blk">
          <label>Quantidade {embId ? `(em ${emb?.nome})` : `(em ${unidade})`}</label>
          <input type="number" min={0} step="any" className="qtd big" autoFocus placeholder="0"
            value={qtd} onChange={e => setQtd(e.target.value)} />
          <div className={`add-calc ${excede ? 'bad' : ''}`}>
            = <b>{num(baseQtd, 2)} {unidade}</b>
            {op === 'baixa' && <> · saldo {variante ? 'da variação' : ''}: {num(saldoVar, 2)} {unidade}{excede && ' · excede o saldo!'}</>}
          </div>
        </div>

        {erro && <div className="msg bad">{erro}</div>}
        <div className="modal-acts">
          <button className="ghost" onClick={onClose}>Cancelar</button>
          <button className="cta" onClick={adicionar} disabled={baseQtd <= 0}>Adicionar</button>
        </div>
      </div>
    </div>
  )
}
