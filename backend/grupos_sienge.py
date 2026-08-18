"""Mapa insumo -> grupo/família REAL do Sienge.

Fonte: GET /cost-databases/{id}/resources (base 3 = 'Tabela Padrão R21 Obras',
isDefault/isReference). Cada insumo traz resourceGroup e resourceFamily.
O mapa é coletado uma vez e salvo em data/grupos_resources.json (é grande).
"""
from __future__ import annotations
import os
import json
import httpx

COST_DB = int(os.environ.get("SIENGE_COST_DB", "3"))
_PATH = os.path.join(os.path.dirname(__file__), "data", "grupos_resources.json")
_CACHE: dict[str, dict] | None = None


def _txt(v) -> str:
    """resourceGroup/resourceFamily podem vir como string ou objeto {description}."""
    if v is None:
        return ""
    if isinstance(v, dict):
        return v.get("description") or v.get("name") or str(v.get("id") or "")
    return str(v)


def carregar() -> dict[str, dict]:
    global _CACHE
    if _CACHE is None:
        try:
            with open(_PATH, encoding="utf-8") as f:
                _CACHE = json.load(f)
        except Exception:
            _CACHE = {}
    return _CACHE


def grupo_de(resource_id) -> tuple[str, str, str]:
    """Retorna (familia, grupo, categoria) do insumo. Vazio se não mapeado."""
    m = carregar().get(str(resource_id))
    if not m:
        return ("", "", "")
    return (_txt(m.get("familia")), _txt(m.get("grupo")), _txt(m.get("cat")))


def coletar(sienge_get) -> int:
    """(Re)coleta o mapa do Sienge e salva em disco. `sienge_get(path, params)`
    é injetado (usa o cliente já autenticado). Retorna quantos insumos mapeou."""
    global _CACHE
    mapa: dict[str, dict] = {}
    off = 0
    while True:
        data = sienge_get(f"/cost-databases/{COST_DB}/resources", {"limit": 200, "offset": off})
        res = data.get("results", []) or []
        for x in res:
            mapa[str(x["id"])] = {
                "grupo": x.get("resourceGroup"), "familia": x.get("resourceFamily"),
                "cat": x.get("category"), "desc": x.get("description"),
            }
        total = (data.get("resultSetMetadata") or {}).get("count", 0)
        off += 200
        if off >= total or not res:
            break
    os.makedirs(os.path.dirname(_PATH), exist_ok=True)
    with open(_PATH, "w", encoding="utf-8") as f:
        json.dump(mapa, f, ensure_ascii=False)
    _CACHE = mapa
    return len(mapa)
