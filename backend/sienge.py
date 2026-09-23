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


def _call(method: str, path_or_url: str, *, retries: int = 5, **kw):
    """HTTP com retry em 429 (rate limit) — respeita Retry-After, senão backoff.
    path começa com / => base v1; ou passe a URL completa."""
    import time
    url = path_or_url if path_or_url.startswith("http") else f"{_base_v1()}{path_or_url}"
    with httpx.Client(timeout=TIMEOUT, auth=_auth()) as c:
        r = None
        for i in range(retries):
            r = c.request(method, url, **kw)
            if r.status_code != 429:
                return r
            wait = r.headers.get("Retry-After")
            time.sleep(min(float(wait) if wait else 1.5 * (2 ** i), 20))
        return r


def get_json(path: str, params: dict | None = None) -> dict:
    """GET genérico autenticado (path começa com /). Retorna o JSON."""
    r = _call("GET", path, params=params or {})
    r.raise_for_status()
    return r.json()


def _base_bulk() -> str:
    sub, _, _ = _cfg()
    return f"https://api.sienge.com.br/{sub}/public/api/bulk-data/v1"


def _paginar(path: str, params: dict | None = None) -> list[dict]:
    """GET paginado (limit 200) com retry em 429 — todas as coletas passam por aqui,
    então um limite de taxa no meio não derruba a coleta inteira."""
    params = {**(params or {}), "limit": LIMIT, "offset": 0}
    out: list[dict] = []
    while True:
        r = _call("GET", path, params=params)
        r.raise_for_status()
        data = r.json()
        res = data.get("results", []) or []
        out.extend(res)
        total = (data.get("resultSetMetadata") or {}).get("count", len(out))
        params["offset"] += LIMIT
        if params["offset"] >= total or not res:
            break
    return out


def coletar_orcamento_wbs(building_id: int) -> dict:
    """Mapa das subetapas (WBS) do orçamento da obra, POR UNIDADE CONSTRUTIVA (sheet):
    {"ucs": {sheetId: nome}, "wbs": {sheetId: {wbsCode: {descricao, unidade, qtd_orcada, medido}}}}.

    IMPORTANTE: o mesmo wbsCode existe em UCs diferentes (ex.: Custos Diretos x
    Indiretos) com significados diferentes. Por isso a chave é (buildingUnitId, wbsCode)
    e a apropriação tem que ser resolvida pela UC (buildingUnitId), senão mostra a
    subetapa errada. (v1 evita o rate-limit da bulk-data.)"""
    import time
    ucs: dict[str, str] = {}
    wbs: dict[str, dict] = {}
    with httpx.Client(timeout=TIMEOUT, auth=_auth()) as c:
        sheets = c.get(f"{_base_v1()}/building-cost-estimations/{building_id}/sheets").json().get("results", [])
        for s in sheets:
            if (s.get("status") or "").upper() == "LOCKED":
                continue
            sid = str(s["id"])
            ucs[sid] = s.get("description")
            porcode = wbs.setdefault(sid, {})
            offset = 0
            while True:
                for _try in range(4):
                    r = c.get(f"{_base_v1()}/building-cost-estimations/{building_id}/sheets/{s['id']}/items",
                              params={"limit": 200, "offset": offset})
                    if r.status_code == 429:
                        time.sleep(8); continue
                    r.raise_for_status(); break
                data = r.json()
                res = data.get("results", [])
                for it in res:
                    code = it.get("wbsCode")
                    if code:
                        porcode[str(code)] = {
                            "descricao": it.get("description"),
                            "unidade": it.get("unitOfMeasure"),
                            "qtd_orcada": it.get("quantity"),
                            "medido": it.get("measuredQuantity"),
                        }
                total = (data.get("resultSetMetadata") or {}).get("count", 0)
                offset += 200
                if offset >= total or not res:
                    break
    return {"ucs": ucs, "wbs": wbs}


def coletar_movimentos(building_id: int, start_date: str | None = None,
                       end_date: str | None = None) -> list[dict]:
    """Histórico de inventory-movements da obra (paginado). Com start_date, só a partir
    dessa data (coleta incremental). ATENÇÃO: o Sienge ignora startDate se endDate não
    vier junto (validado na Holmes) — por isso o endDate padrão bem no futuro."""
    params: dict = {"buildingId": building_id}
    if start_date:
        params["startDate"] = start_date
        params["endDate"] = end_date or "2099-12-31"
    elif end_date:
        params["endDate"] = end_date
    return _paginar("/inventory-movements", params)


def coletar_pedidos(building_id: int) -> list[dict]:
    """Cabeçalhos de purchase-orders da obra (paginado). Campos:
    supplierId, date, totalAmount, deliveryLate, status, authorized, etc."""
    return _paginar("/purchase-orders", {"buildingId": building_id})


def pedidos_abertos(building_id: int) -> list[dict]:
    """Pedidos AUTORIZADOS ainda não totalmente entregues (PENDING / PARTIALLY_DELIVERED),
    lidos ao vivo — base do "a caminho" (material comprado e não recebido)."""
    out: list[dict] = []
    for st in ("PENDING", "PARTIALLY_DELIVERED"):
        out += _paginar("/purchase-orders", {"buildingId": building_id, "status": st})
    return [p for p in out if p.get("authorized") and not p.get("disapproved")]


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
    """Itens de um pedido de compra (purchase-order): insumo, detalhe, qtd (na unidade
    de COMPRA), unidade, preço. Não traz quantidade entregue."""
    r = _call("GET", f"/purchase-orders/{pedido_id}/items")
    if r.status_code != 200:
        return []
    return r.json().get("results", []) or []


def solic_item_apropriacao(pr_id: int, item_number: int) -> list[dict]:
    """Subetapas (WBS) que o item da solicitação está pedindo: [{costEstimationItemReference, percentage}]."""
    r = _call("GET", f"/purchase-requests/{pr_id}/items/{item_number}/buildings-appropriations")
    if r.status_code != 200:
        return []
    return r.json().get("results", []) or []


def solic_autorizar(pr_id: int) -> int:
    """PATCH autoriza todos os itens da solicitação (após dupla aprovação no BOX21)."""
    r = _call("PATCH", f"/purchase-requests/{pr_id}/authorize")
    if r.status_code >= 400:
        raise SiengeError(_msg_erro(r), r.status_code)
    return r.status_code


def solic_reprovar(pr_id: int, motivo: str) -> int:
    """PATCH reprova todos os itens da solicitação."""
    r = _call("PATCH", f"/purchase-requests/{pr_id}/disapproval",
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


def buscar_apropriacao(cost_center_id: int, resource_id,
                       detail_id=None, trademark_id=None) -> list[dict]:
    """GET /stock-inventories/{cc}/items/{rid}/building-appropriation.
    Retorna os itens de orçamento (WBS) aos quais o insumo pode ser apropriado —
    necessário para movimentos de entrada/saída avulsa (o Sienge exige 100%).
    A apropriação é indexada por detalhe/marca: sem passar detailId/trademarkId,
    itens com variação voltam vazios. Ordena pelo maior saldo (candidato provável)."""
    params = {}
    if detail_id is not None:
        params["detailId"] = detail_id
    if trademark_id is not None:
        params["trademarkId"] = trademark_id
    r = _call("GET", f"/stock-inventories/{cost_center_id}/items/{resource_id}/building-appropriation",
              params=params or None)
    if r.status_code == 404:
        return []
    r.raise_for_status()
    res = r.json().get("results", []) or []
    return sorted(res, key=lambda a: -(a.get("quantity") or 0))


_COST_DB = 3  # tabela de custos de referência (onde ficam detalhes/marcas dos insumos)


def resource_variacoes(resource_id) -> dict:
    """Detalhes (cor/bitola/spec) e marcas CADASTRADOS de um insumo — usado na
    ENTRADA, onde a variação pode ainda não ter saldo. Vazio se 404."""
    r = _call("GET", f"/cost-databases/{_COST_DB}/resources/{resource_id}")
    if r.status_code == 404:
        return {"details": [], "trademarks": [], "unit": None}
    r.raise_for_status()
    j = r.json()
    ativos = lambda xs: [x for x in (xs or []) if (x.get("status") or "ACTIVE") == "ACTIVE"]
    return {"details": ativos(j.get("details")), "trademarks": ativos(j.get("trademarks")),
            "unit": j.get("unitOfMeasure")}


def estoque_inventario(cost_center_id: int) -> list[dict]:
    """GET /stock-inventories/{cc}/items — saldo atual por (resourceId, detailId,
    trademarkId). Base do seletor de cor/variação na baixa/entrada."""
    return _paginar(f"/stock-inventories/{cost_center_id}/items")


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
