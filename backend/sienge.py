"""Cliente Sienge — leitura de inventory-movements e escrita de stock-movements.

Credenciais vêm SEMPRE do ambiente (nunca hardcoded):
  SIENGE_SUBDOMAIN, SIENGE_API_USER, SIENGE_API_PASSWORD

Se as credenciais não estiverem presentes, `configurado()` retorna False e a API
cai no modo demonstração (demo_data). Contrato descoberto no handoff (arquivo 01).
"""
from __future__ import annotations
import os
import httpx

TIMEOUT = 60.0
LIMIT = 200  # máximo por página no inventory-movements


class SiengeError(Exception):
    """Erro de negócio/validação vindo do Sienge (com a mensagem legível)."""
    def __init__(self, mensagem: str, status: int = 422):
        super().__init__(mensagem)
        self.mensagem = mensagem
        self.status = status


def _cfg():
    return (
        os.environ.get("SIENGE_SUBDOMAIN"),
        os.environ.get("SIENGE_API_USER"),
        os.environ.get("SIENGE_API_PASSWORD"),
    )


def configurado() -> bool:
    return all(_cfg())


def _base_v1() -> str:
    sub, _, _ = _cfg()
    return f"https://api.sienge.com.br/{sub}/public/api/v1"


def _auth():
    _, user, pwd = _cfg()
    return (user, pwd)


def coletar_movimentos(building_id: int, start_date: str | None = None,
                       end_date: str | None = None) -> list[dict]:
    """Puxa TODO o histórico de inventory-movements da obra (paginado)."""
    url = f"{_base_v1()}/inventory-movements"
    params = {"buildingId": building_id, "limit": LIMIT, "offset": 0}
    if start_date:
        params["startDate"] = start_date
    if end_date:
        params["endDate"] = end_date
    out: list[dict] = []
    with httpx.Client(timeout=TIMEOUT, auth=_auth()) as c:
        while True:
            r = c.get(url, params=params)
            r.raise_for_status()
            data = r.json()
            results = data.get("results", [])
            out.extend(results)
            meta = data.get("resultSetMetadata", {}) or {}
            total = meta.get("count", len(out))
            params["offset"] += LIMIT
            if params["offset"] >= total or not results:
                break
    return out


def buscar_movimento(movement_id: int) -> dict | None:
    """GET /inventory-movements/{id}. Retorna None se 404 (apagado no Sienge).
    Base para a reconciliação antes de estornar (handoff pendência #1)."""
    url = f"{_base_v1()}/inventory-movements/{movement_id}"
    with httpx.Client(timeout=TIMEOUT, auth=_auth()) as c:
        r = c.get(url)
        if r.status_code == 404:
            return None
        r.raise_for_status()
        return r.json()


def buscar_apropriacao(cost_center_id: int, resource_id) -> list[dict]:
    """GET /stock-inventories/{cc}/items/{rid}/building-appropriation.
    Retorna os itens de orçamento (WBS) aos quais o insumo pode ser apropriado —
    necessário para movimentos de entrada/saída avulsa (o Sienge exige 100%).
    Ordena por maior quantidade orçada (candidato mais provável primeiro)."""
    url = f"{_base_v1()}/stock-inventories/{cost_center_id}/items/{resource_id}/building-appropriation"
    with httpx.Client(timeout=TIMEOUT, auth=_auth()) as c:
        r = c.get(url)
        if r.status_code == 404:
            return []
        r.raise_for_status()
        res = r.json().get("results", []) or []
    return sorted(res, key=lambda a: -(a.get("quantity") or 0))


def criar_movimento(cost_center_id: int, movement_type_id: int, document_id: str,
                    movement_date: str, itens: list[dict], notes: str | None = None) -> dict:
    """POST /stock-movements. itens: [{resourceId, quantity, unitOfMeasure}].
    Um POST = um movimento com N linhas. Retorna dict com id/resposta."""
    url = f"{_base_v1()}/stock-movements"
    body = {
        "costCenterId": cost_center_id,
        "movementTypeId": movement_type_id,
        "documentId": document_id,
        "movementDate": movement_date,
        "items": itens,
    }
    if notes:
        body["notes"] = notes
    with httpx.Client(timeout=TIMEOUT, auth=_auth()) as c:
        r = c.post(url, json=body)
        if r.status_code >= 400:
            # captura a mensagem de validação do Sienge em vez de engolir o erro
            msg = f"Sienge {r.status_code}"
            try:
                err = r.json()
                msg = err.get("clientMessage") or err.get("developerMessage") or err.get("message") or msg
            except Exception:
                if r.text:
                    msg = r.text[:300]
            raise SiengeError(msg, r.status_code)
        mid = None
        loc = r.headers.get("Location")
        if loc:
            mid = loc.rstrip("/").split("/")[-1]
        corpo = {}
        try:
            corpo = r.json()
        except Exception:
            pass
        mid = mid or corpo.get("id") or corpo.get("movementId") or corpo.get("movementNumber")
        return {"status": r.status_code, "movement_id": mid, "resposta": corpo}
