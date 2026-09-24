import { useEffect, useState } from 'react'
import { api, type EapLista } from './api'

// Lista de subetapas (EAP) por obra, com cache em memória — separada do componente
// para o Fast Refresh (arquivo de componente só exporta componentes).

const cache = new Map<string, Promise<EapLista>>()
const VAZIA: EapLista = { tem_mapa: false, subetapas: [], recentes: [] }

export function useEapLista(obra: string): EapLista | null {
  const [lista, setLista] = useState<EapLista | null>(null)
  useEffect(() => {
    setLista(null)
    let p = cache.get(obra)
    if (!p) {
      p = api.eapLista(obra)
      cache.set(obra, p)
      p.catch(() => cache.delete(obra))
    }
    let vivo = true
    p.then(l => { if (vivo) setLista(l) }).catch(() => { if (vivo) setLista(VAZIA) })
    return () => { vivo = false }
  }, [obra])
  return lista
}

// depois de gravar com EAP: a próxima abertura traz as "últimas usadas" atualizadas
export function renovarEap(obra: string) { cache.delete(obra) }

export function eapTexto(e: { eap_codigo?: string | null; eap_descricao?: string | null } | null | undefined): string {
  if (!e?.eap_codigo) return ''
  return `${e.eap_codigo}${e.eap_descricao ? ' · ' + e.eap_descricao : ''}`
}
