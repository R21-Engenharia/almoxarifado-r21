// Loader com a identidade do BOX21 (preto + vermelho): "caixas" enchendo a
// prateleira, como um almoxarifado sendo carregado. Fica na tela até os dados
// da aba/módulo estarem prontos.
export default function Loader({ label, dica, full }: { label?: string; dica?: string; full?: boolean }) {
  return (
    <div className={`bx-loader ${full ? 'full' : ''}`}>
      <div className="bx-crate" aria-hidden>
        {Array.from({ length: 9 }).map((_, i) => <span key={i} style={{ animationDelay: `${(i % 3 + Math.floor(i / 3)) * 0.12}s` }} />)}
      </div>
      <div className="bx-load-tt">Carregando{label ? ` ${label}` : ''}<b className="bx-dots"><i>.</i><i>.</i><i>.</i></b></div>
      <div className="bx-sub">{dica || 'Buscando os dados no Sienge — só um instante.'}</div>
      <div className="bx-bar"><i /></div>
    </div>
  )
}
