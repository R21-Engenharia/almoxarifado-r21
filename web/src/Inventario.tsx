import { useEffect, useState } from 'react'
import { api, brl, num, type PlanoInventario, type Contagem, type ContagemStatus } from './api'
import Loader from './Loader'

// Inventário cíclico: A todo mês, B a cada 3 meses, C a cada 6. A contagem é CEGA (quem
// conta não vê o saldo do sistema); a divergência é calculada no envio contra o saldo do
// Sienge naquele momento. Ajuste = entrada/saída avulsa com motivo; acima da tolerância,
// só administrador.

const ST: Record<ContagemStatus, string> = {
  aberta: 'a contar', contada: 'com divergência', conferida: 'sem divergência', ajustando: 'ajuste sem confirmação',
  ajustada: 'ajustada', encerrada: 'encerrada sem ajuste',
}

export default function Inventario({ obra }: { obra: string }) {
  const [plano, setPlano] = useState<PlanoInventario | null>(null)
  const [cs, setCs] = useState<Contagem[] | null>(null)
  const [papel, setPapel] = useState('')
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [classe, setClasse] = useState<'A' | 'B' | 'C' | ''>('A')
  const [maxItens, setMaxItens] = useState(20)
  const [gerando, setGerando] = useState(false)
  const [aberta, setAberta] = useState<Contagem | null>(null)
  const [filtro, setFiltro] = useState<'A' | 'B' | 'C' | ''>('')

  const carregar = () => {
    setErr('')
    Promise.all([api.invPlano(obra), api.contagens(obra)])
      .then(([p, c]) => { setPlano(p); setCs(c.contagens); setPapel(c.papel) })
      .catch(e => setErr(e instanceof Error ? e.message : String(e)))
  }
  useEffect(() => { setPlano(null); setCs(null); setAberta(null); carregar() }, [obra]) // eslint-disable-line react-hooks/exhaustive-deps

  const gerar = async () => {
    setGerando(true); setMsg('')
    try {
      const r = await api.contagemCriar(obra, { classe: classe || null, max_itens: maxItens })
      setAberta(r.contagem); carregar()
    } catch (e) { setMsg('✗ ' + (e instanceof Error ? e.message : String(e))) }
    finally { setGerando(false) }
  }

  if (err) return <div className="err">Falha ao carregar: {err}</div>
  if (!plano || !cs) return <Loader label="o inventário" dica="Montando o plano de contagem pela curva ABC…" />
  if (aberta) return <ContagemView obra={obra} c={aberta} admin={papel === 'admin'} tol={plano.tolerancia}
    onVoltar={() => { setAberta(null); carregar() }} />

  const r = plano.resumo
  const itens = plano.itens.filter(i => !filtro || i.abc === filtro)
  return (
    <div className="dash">
      <div className="kpi-row">
        {(['A', 'B', 'C'] as const).map(k => (
          <div key={k} className="kpi-card">
            <div className="kpi-top"><span className="kpi-rot">Classe {k} · a cada {r[k].periodicidade_dias} dias</span>
              {r[k].n_vencidos > 0 && <span className={`kpi-tag ${k === 'A' ? 'critico' : 'baixo'}`}>{r[k].n_vencidos} vencido(s)</span>}</div>
            <div className="kpi-big">{num(r[k].n_itens - r[k].n_vencidos)}/{num(r[k].n_itens)}</div>
            <div className="kpi-hint">em dia · {r[k].n_nunca} nunca contado(s)</div>
          </div>
        ))}
        <div className="kpi-card"><div className="kpi-rot">Acuracidade (90 dias)</div>
          <div className="kpi-big">{plano.acuracidade.pct_exatos == null ? '—' : `${num(plano.acuracidade.pct_exatos, 1)}%`}</div>
          <div className="kpi-hint">{plano.acuracidade.n_itens} linha(s) contada(s) sem divergência</div></div>
      </div>

      {msg && <div className="msg bad" onClick={() => setMsg('')}>{msg}</div>}

      <div className="chart-card">
        <div className="chart-head"><div><h3>Gerar contagem</h3>
          <span className="chart-sub">Pega os itens vencidos (mais atrasados e de maior valor primeiro). Uma linha por variação.</span></div></div>
        <div className="inv-gerar">
          <div className="seg sm">
            {(['A', 'B', 'C', ''] as const).map(k => <button key={k || 't'} className={classe === k ? 'on' : ''} onClick={() => setClasse(k)}>{k || 'Todas'}</button>)}
          </div>
          <label>até <input type="number" className="qtd" min={1} max={200} value={maxItens} onChange={e => setMaxItens(parseInt(e.target.value) || 20)} /> insumos</label>
          <button className="cta" disabled={gerando} onClick={gerar}>{gerando ? 'Gerando…' : 'Gerar contagem'}</button>
        </div>
      </div>

      <h3 className="sec-tt">Contagens</h3>
      {cs.length === 0 ? <div className="empty">Nenhuma contagem ainda.</div> : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>#</th><th>Criada</th><th>Classe</th><th className="r">Linhas</th><th>Situação</th><th></th></tr></thead>
            <tbody>
              {cs.map(c => (
                <tr key={c.id}>
                  <td>{c.id}</td>
                  <td>{new Date(c.criado_em).toLocaleDateString('pt-BR')}<div className="meta">{c.criado_por}</div></td>
                  <td>{c.classe || '—'}</td>
                  <td className="r">{c.itens.length}</td>
                  <td><span className={`st-pill st-${c.status}`}>{ST[c.status]}</span>{c.erro && <div className="meta">{c.erro}</div>}</td>
                  <td className="r"><button className="mini" onClick={() => setAberta(c)}>
                    {c.status === 'aberta' ? 'Contar' : c.status === 'contada' ? 'Revisar' : c.status === 'ajustando' ? 'Retomar' : 'Ver'}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 className="sec-tt">Plano por item</h3>
      <div className="chips">
        {(['', 'A', 'B', 'C'] as const).map(k => <button key={k || 't'} className={filtro === k ? 'on' : ''} onClick={() => setFiltro(k)}>{k ? `Classe ${k}` : 'Todos'}</button>)}
      </div>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>Insumo</th><th>ABC</th><th className="r">Capital</th><th>Última contagem</th><th>Próxima</th></tr></thead>
          <tbody>
            {itens.slice(0, 300).map(i => (
              <tr key={i.resource_id}>
                <td><div className="desc">{i.descricao}</div><div className="meta">#{i.resource_id}</div></td>
                <td><span className={`abc-badge abc-${i.abc}`}>{i.abc}</span></td>
                <td className="r">{brl(i.valor_saldo)}</td>
                <td>{i.ultima_contagem ? new Date(i.ultima_contagem + 'T12:00').toLocaleDateString('pt-BR') : <span className="nunca">nunca</span>}</td>
                <td>{i.vencido ? <span className="pill critico">{i.ultima_contagem ? `vencida há ${i.dias_atraso} d` : 'contar'}</span>
                  : new Date(i.proxima + 'T12:00').toLocaleDateString('pt-BR')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ContagemView({ obra, c: inicial, admin, tol, onVoltar }: {
  obra: string; c: Contagem; admin: boolean; tol: { valor: number; pct: number }; onVoltar: () => void
}) {
  const [c, setC] = useState(inicial)
  const [qtds, setQtds] = useState<string[]>(inicial.itens.map(l => l.qtd_contada == null ? '' : String(l.qtd_contada)))
  const [sel, setSel] = useState<Set<number>>(new Set(inicial.itens.map((l, n) => [l, n] as const)
    .filter(([l]) => Math.abs(l.divergencia || 0) > 1e-9 && (admin || !l.precisa_aprovacao)).map(([, n]) => n)))
  const [motivo, setMotivo] = useState(inicial.motivo || '')
  const [gravando, setGravando] = useState(false)
  const [erro, setErro] = useState('')

  const rodar = async (fn: () => Promise<{ contagem: Contagem }>) => {
    setGravando(true); setErro('')
    try {
      const r = await fn()
      setC(r.contagem)
      setSel(new Set(r.contagem.itens.map((l, n) => [l, n] as const)
        .filter(([l]) => Math.abs(l.divergencia || 0) > 1e-9 && (admin || !l.precisa_aprovacao)).map(([, n]) => n)))
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)) }
    finally { setGravando(false) }
  }
  const faltam = qtds.filter(q => q.trim() === '').length

  return (
    <div className="dash">
      <div className="painel-topo">
        <h3 style={{ margin: 0 }}>Contagem #{c.id} · <span className={`st-pill st-${c.status}`}>{ST[c.status]}</span></h3>
        <button className="ghost" onClick={onVoltar}>Voltar</button>
      </div>

      {c.status === 'aberta' && <>
        <p className="nota-eap">Conte o que está <b>fisicamente</b> no almoxarifado, na unidade indicada. O saldo do sistema não aparece de propósito
          (contagem cega). Se alguma retirada estiver acontecendo, registre-a antes de enviar.</p>
        <div className="inv-lista">
          {c.itens.map((l, n) => (
            <div key={n} className="inv-linha">
              <div><div className="desc">{l.descricao}</div>
                <div className="meta">#{l.resource_id}{l.variante ? ` · ${l.variante}` : ''} · classe {l.abc}</div></div>
              <label><input type="number" inputMode="decimal" min={0} step="any" className="qtd big" placeholder="—"
                value={qtds[n]} onChange={e => setQtds(q => q.map((v, i) => i === n ? e.target.value : v))} /> {l.unidade}</label>
            </div>
          ))}
        </div>
        {erro && <div className="msg bad">{erro}</div>}
        <div className="modal-acts">
          <button className="ghost" disabled={gravando} onClick={() => { if (confirm('Encerrar esta contagem sem enviar?')) rodar(() => api.contagemEncerrar(obra, c.id)) }}>Descartar</button>
          <button className="cta" disabled={gravando || faltam > 0}
            onClick={() => rodar(() => api.contagemEnviar(obra, c.id, qtds.map((q, idx) => ({ idx, qtd: parseFloat(q) }))))}>
            {gravando ? 'Enviando…' : faltam ? `Faltam ${faltam} linha(s)` : 'Enviar contagem'}</button>
        </div>
      </>}

      {c.status !== 'aberta' && <>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr>{c.status === 'contada' && <th></th>}<th>Insumo</th><th className="r">Sistema</th><th className="r">Contado</th><th className="r">Divergência</th><th className="r">Valor</th></tr></thead>
            <tbody>
              {c.itens.map((l, n) => {
                const div = l.divergencia || 0
                const bloqueado = !!l.precisa_aprovacao && !admin
                return (
                  <tr key={n} className={Math.abs(div) > 1e-9 ? 'inv-div' : ''}>
                    {c.status === 'contada' && <td>{Math.abs(div) > 1e-9 &&
                      <input type="checkbox" checked={sel.has(n)} disabled={bloqueado}
                        onChange={e => setSel(s => { const x = new Set(s); if (e.target.checked) x.add(n); else x.delete(n); return x })} />}</td>}
                    <td><div className="desc">{l.descricao}</div>
                      <div className="meta">#{l.resource_id}{l.variante ? ` · ${l.variante}` : ''}
                        {l.precisa_aprovacao && <span className="pill critico" style={{ marginLeft: 6 }}>acima da tolerância</span>}
                        {l.ajustar && <span className="badge" style={{ marginLeft: 6 }}>ajustado</span>}</div></td>
                    <td className="r">{num(l.saldo_sistema ?? null, 2)} {l.unidade}</td>
                    <td className="r">{num(l.qtd_contada, 2)}</td>
                    <td className="r" style={{ color: div < 0 ? 'var(--ruptura)' : div > 0 ? 'var(--entrada)' : undefined }}>{div > 0 ? '+' : ''}{num(div, 2)}</td>
                    <td className="r">{brl(l.valor_divergencia || 0)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {c.motivo && <p className="conf-eap">Motivo do ajuste: <b>{c.motivo}</b></p>}
        {(c.status === 'contada' || c.status === 'ajustando') && <>
          {c.status === 'contada' && <p className="nota-eap">Tolerância: até {brl(tol.valor)} e {num(tol.pct)}% do saldo. Acima disso, o ajuste só é feito por um administrador.
            Sobra vira entrada avulsa, falta vira saída avulsa — ambas com o motivo e ligadas a esta contagem.</p>}
          <div className="campo"><span>Motivo do ajuste *</span>
            <input value={motivo} disabled={c.status === 'ajustando'} onChange={e => setMotivo(e.target.value)} placeholder="ex.: quebra não registrada, erro de lançamento…" /></div>
          {erro && <div className="msg bad">{erro}</div>}
          <div className="modal-acts">
            {c.status === 'contada' && <button className="ghost" disabled={gravando} onClick={() => rodar(() => api.contagemEncerrar(obra, c.id))}>Encerrar sem ajustar</button>}
            <button className="cta" disabled={gravando || !motivo.trim() || (c.status === 'contada' && sel.size === 0)}
              onClick={() => rodar(() => api.contagemAjustar(obra, c.id, motivo.trim(), c.status === 'contada' ? Array.from(sel) : undefined))}>
              {gravando ? 'Gravando no Sienge…' : c.status === 'ajustando' ? 'Retomar ajuste' : `Ajustar ${sel.size} linha(s) no Sienge`}</button>
          </div>
        </>}
      </>}
    </div>
  )
}
