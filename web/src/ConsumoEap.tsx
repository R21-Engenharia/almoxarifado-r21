import { useEffect, useState } from 'react'
import { api, brl, num, type ConsumoOrcado, type ConsumoOrcadoItem } from './api'
import Loader from './Loader'

// Consumo registrado pelo BOX21 × quantidade orçada, por subetapa (EAP) e insumo.
const ST: Record<ConsumoOrcadoItem['status'], string> = {
  ok: 'dentro', atencao: '≥ 80%', acima: 'acima do orçado', sem_orcamento: 'não orçado aqui',
}

export default function ConsumoEap({ obra }: { obra: string }) {
  const [d, setD] = useState<ConsumoOrcado | null>(null)
  const [err, setErr] = useState('')
  const [aberta, setAberta] = useState<string | null>(null)
  const [soAcima, setSoAcima] = useState(false)
  useEffect(() => {
    setD(null); setErr('')
    api.consumoOrcado(obra).then(setD).catch(e => setErr(e instanceof Error ? e.message : String(e)))
  }, [obra])

  if (err) return <div className="err">Falha ao carregar: {err}</div>
  if (!d) return <Loader label="o consumo por subetapa" dica="Cruzando as baixas com o orçamento do Sienge…" />
  const k = d.kpis
  const subs = soAcima ? d.subetapas.filter(s => s.n_acima > 0) : d.subetapas

  return (
    <div className="dash">
      <div className="kpi-row">
        <div className="kpi-card"><div className="kpi-rot">Consumo apropriado</div><div className="kpi-big">{brl(k.valor_consumido)}</div><div className="kpi-hint">{num(k.n_baixas_com_eap)} baixas com subetapa</div></div>
        <div className="kpi-card"><div className="kpi-top"><span className="kpi-rot">Baixas com EAP</span>
          {k.n_baixas_sem_eap > 0 && <span className="kpi-tag baixo">{num(k.n_baixas_sem_eap)} sem</span>}</div>
          <div className="kpi-big">{num(k.pct_com_eap, 1)}%</div><div className="kpi-hint">desde {d.desde ? new Date(d.desde + 'T12:00').toLocaleDateString('pt-BR') : '—'}</div></div>
        <div className="kpi-card"><div className="kpi-rot">Subetapas</div><div className="kpi-big">{num(k.n_subetapas)}</div><div className="kpi-hint">com consumo registrado</div></div>
        <div className="kpi-card"><div className="kpi-top"><span className="kpi-rot">Acima do orçado</span>
          {k.n_itens_acima > 0 && <span className="kpi-tag critico">atenção</span>}</div>
          <div className="kpi-big">{num(k.n_itens_acima)}</div><div className="kpi-hint">insumo × subetapa</div></div>
      </div>

      <p className="nota-eap">Conta só as baixas feitas pelo BOX21 com subetapa — o que foi lançado direto no Sienge não entra.
        O orçado é a quantidade do insumo apropriada àquela subetapa no Sienge (a obra inteira), então o % mostra quanto do orçado já saiu do almoxarifado.</p>

      {d.subetapas.length === 0 ? <div className="empty">Ainda não há baixas com subetapa nesta obra. Elas aparecem aqui assim que o almoxarifado começar a registrar a EAP na retirada.</div> : <>
        <div className="chips">
          <button className={!soAcima ? 'on' : ''} onClick={() => setSoAcima(false)}>Todas as subetapas</button>
          <button className={soAcima ? 'on' : ''} onClick={() => setSoAcima(true)}>Só com item acima do orçado</button>
        </div>
        <div className="eap-rel">
          {subs.map(s => {
            const key = `${s.uc_id}|${s.codigo}`
            const on = aberta === key
            return (
              <div key={key} className={`eap-rel-sub ${s.n_acima ? 'acima' : ''}`}>
                <button className="eap-rel-head" onClick={() => setAberta(on ? null : key)}>
                  <span className="eap-cod">{s.codigo}</span>
                  <span className="eap-txt">{s.descricao}<em>{s.uc_nome}</em></span>
                  <span className="eap-rel-v">{brl(s.valor_consumido)}
                    <em>{s.itens.length} insumo(s){s.n_acima ? ` · ${s.n_acima} acima` : ''}</em></span>
                </button>
                {on && (
                  <div className="tbl-wrap">
                    <table className="tbl">
                      <thead><tr><th>Insumo</th><th className="r">Consumido</th><th className="r">Orçado</th><th>% do orçado</th><th className="r">Valor</th></tr></thead>
                      <tbody>
                        {s.itens.map(i => (
                          <tr key={`${i.resource_id}|${i.detail_id}`}>
                            <td><div className="desc">{i.descricao}</div><div className="meta">#{i.resource_id} · {i.n_baixas} baixa(s)</div></td>
                            <td className="r">{num(i.qtd_consumida, 2)} {i.unidade}</td>
                            <td className="r">{i.qtd_orcada == null ? '—' : `${num(i.qtd_orcada, 2)} ${i.unidade || ''}`}</td>
                            <td>
                              {i.pct != null && <div className="barra-eap"><div className={`st-${i.status}`} style={{ width: `${Math.min(100, i.pct)}%` }} /></div>}
                              <span className={`eap-st st-${i.status}`}>{i.pct != null ? `${num(i.pct, 1)}% · ` : ''}{ST[i.status]}</span>
                            </td>
                            <td className="r">{brl(i.valor)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </>}
    </div>
  )
}
