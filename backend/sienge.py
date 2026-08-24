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


def get_json(path: str, params: dict | None = None) -> dict:
    """GET genérico autenticado (path começa com /). Retorna o JSON."""
    with httpx.Client(timeout=TIMEOUT, auth=_auth()) as c:
        r = c.get(f"{_base_v1()}{path}", params=params or {})
        r.raise_for_status()
        return r.json()


def _base_bulk() -> str:
    sub, _, _ = _cfg()
    return f"https://api.sienge.com.br/{sub}/public/api/bulk-data/v1"


def coletar_orcamento_wbs(building_id: int) -> dict[str, dict]:
    """Mapa das subetapas (WBS) do orçamento da obra, via v1 (planilhas/itens):
    wbsCode -> {descricao, unidade, qtd_orcada, medido}. Percorre as planilhas
    ativas e pagina os itens. (v1 evita o rate-limit da bulk-data.)"""
    import time
    mapa: dict[str, dict] = {}
    with httpx.Client(timeout=TIMEOUT, auth=_auth()) as c:
        sheets = c.get(f"{_base_v1()}/building-cost-estimations/{building_id}/sheets").json().get("results", [])
        for s in sheets:
            if (s.get("status") or "").upper() == "LOCKED":
                continue
            sid = s["id"]
            offset = 0
            while True:
                for _try in range(4):
                    r = c.get(f"{_base_v1()}/building-cost-estimations/{building_id}/sheets/{sid}/items",
                              params={"limit": 200, "offset": offset})
                    if r.status_code == 429:
                        time.sleep(8); continue
                    r.raise_for_status(); break
                data = r.json()
                res = data.get("results", [])
                for it in res:
                    code = it.get("wbsCode")
                    if code:
                        mapa[str(code)] = {
                            "descricao": it.get("description"),
                            "unidade": it.get("unitOfMeasure"),
                            "qtd_orcada": it.get("quantity"),
                            "medido": it.get("measuredQuantity"),
                        }
                total = (data.get("resultSetMetadata") or {}).get("count", 0)
                offset += 200
                if offset >= total or not res:
                    break
    return mapa


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


def coletar_pedidos(building_id: int) -> list[dict]:
    """Puxa os cabeçalhos de purchase-orders da obra (paginado). Campos:
    supplierId, date, totalAmount, deliveryLate, status, authorized, etc."""
    url = f"{_base_v1()}/purchase-orders"
    params = {"buildingId": building_id, "limit": LIMIT, "offset": 0}
    out: list[dict] = []
    with httpx.Client(timeout=TIMEOUT, auth=_auth()) as c:
        while True:
            r = c.get(url, params=params)
            r.raise_for_status()
            data = r.json()
            results = data.get("results", [])
            out.extend(results)
            total = (data.get("resultSetMetadata") or {}).get("count", len(out))
            params["offset"] += LIMIT
            if params["offset"] >= total or not results:
                break
    return out


def solic_pendentes() -> list[dict]:
    """Itens de solicitação de compra AGUARDANDO autorização (todas as obras)."""
    url = f"{_base_v1()}/purchase-requests/all/items"
    params = {"authorized": "false", "disapproved": "false", "limit": 200, "offset": 0}
    out: list[dict] = []
    with httpx.Client(timeout=TIMEOUT, auth=_auth()) as c:
        while True:
            r = c.get(url, params=params)
            r.raise_for_status()
            data = r.json()
            res = data.get("results", [])
            out.extend(res)
            total = (data.get("resultSetMetadata") or {}).get("count", len(out))
            params["offset"] += 200
            if params["offset"] >= total or not res:
                break
    return out


def solic_header(pr_id: int) -> dict:
    """Cabeçalho da solicitação: buildingId, requesterUser, requestDate, notes, status."""
    return get_json(f"/purchase-requests/{pr_id}")


def pedido_itens(pedido_id: int) -> list[dict]:
    """Itens de um pedido de compra (purchase-order): insumo, qtd, unidade, preço."""
    with httpx.Client(timeout=TIMEOUT, auth=_auth()) as c:
        r = c.get(f"{_base_v1()}/purchase-orders/{pedido_id}/items")
        if r.status_code != 200:
            return []
        return r.json().get("results", []) or []


def solic_item_apropriacao(pr_id: int, item_number: int) -> list[dict]:
    """Subetapas (WBS) que o item da solicitação está pedindo: [{costEstimationItemReference, percentage}]."""
    with httpx.Client(timeout=TIMEOUT, auth=_auth()) as c:
        r = c.get(f"{_base_v1()}/purchase-requests/{pr_id}/items/{item_number}/buildings-appropriations")
        if r.status_code != 200:
            return []
        return r.json().get("results", []) or []


def solic_autorizar(pr_id: int) -> int:
    """PATCH autoriza todos os itens da solicitação (após dupla aprovação no BOX21)."""
    with httpx.Client(timeout=TIMEOUT, auth=_auth()) as c:
        r = c.patch(f"{_base_v1()}/purchase-requests/{pr_id}/authorize")
        if r.status_code >= 400:
            raise SiengeError(_msg_erro(r), r.status_code)
        return r.status_code


def solic_reprovar(pr_id: int, motivo: str) -> int:
    """PATCH reprova todos os itens da solicitação."""
    with httpx.Client(timeout=TIMEOUT, auth=_auth()) as c:
        r = c.patch(f"{_base_v1()}/purchase-requests/{pr_id}/disapproval",
                    json={"disapprovalReason": motivo or "Reprovada via BOX21"})
        if r.status_code >= 400:
            raise SiengeError(_msg_erro(r), r.status_code)
        return r.status_code


def _msg_erro(r) -> str:
    try:
        j = r.json()
        return j.get("clientMessage") or j.get("developerMessage") or j.get("message") or f"Sienge {r.status_code}"
    except Exception:
        return (r.text or f"Sienge {r.status_code}")[:200]


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
