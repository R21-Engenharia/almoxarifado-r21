"""Dataset de demonstração — usado quando o Sienge não está configurado.

Gera movimentos no MESMO formato do inventory-movements, para o Stock Engine
produzir estados variados (ruptura, crítico, baixo, ok, parado). Assim o app roda
de ponta a ponta sem credenciais. Marcado claramente como DERIVADO/DEMO.
"""
from __future__ import annotations
from datetime import date, timedelta

# obra demo -> costCenterId/buildingId
OBRAS_DEMO = {
    "10223": {"nome": "Cape Town Residence (DEMO)", "building_id": 23},
    "18992": {"nome": "Holmes Residence (DEMO)", "building_id": 13},
}


def _mov(mid, rid, desc, io, tipo_id, tipo_desc, qtd, valor, dt, unid, forn):
    return {
        "id": mid,
        "resourceId": rid,
        "resourceDescription": desc,
        "inputOutput": io,
        "movementTypeId": tipo_id,
        "movementTypeDescription": tipo_desc,
        "movementQuantity": qtd,
        "movementValue": valor,
        "movementDate": dt.isoformat(),
        "baseUnitOfMeasureSymbol": unid,
        "unitOfMeasureSymbol": unid,
        "supplierName": forn,
    }


# (resourceId, descrição, unidade, custo_unit, fornecedor,
#  entrada_total, consumo_mensal(últimos 3 meses), dias_desde_ultimo_consumo)
_INSUMOS = [
    (2912, "Argamassa colante AC-III cinza 20kg", "kg", 1.85, "Votomassa",
     8000, [1200, 1400, 1100], 2),
    (3301, "Cimento CP-II-E-32 saco 50kg", "kg", 0.72, "Votorantim",
     20000, [3000, 3200, 3000], 1),      # -> ruptura (esvazia)
    (4102, "Vergalhão aço CA-50 10.0mm", "kg", 6.10, "Gerdau",
     12000, [400, 500, 450], 5),
    (5201, "Porcelanato acetinado 80x80 polido", "m2", 92.0, "Portobello",
     1800, [0, 0, 0], 210),              # -> parado (capital empatado)
    (6110, "Tubo PVC soldável 25mm", "m", 3.40, "Tigre",
     3000, [120, 140, 130], 6),
    (6820, "Cabo flexível 2.5mm² 750V", "m", 2.10, "Prysmian",
     2210, [600, 700, 650], 3),      # -> baixo (~12 dias)
    (7050, "Tinta acrílica premium branco 18L", "l", 21.5, "Suvinil",
     900, [0, 0, 0], 160),               # -> parado
    (8010, "Areia média lavada", "m3", 110.0, "Mineração SP",
     400, [18, 20, 22], 4),
    (8420, "Bloco cerâmico vedação 14x19x39", "un", 1.35, "Cerâmica Selecta",
     7600, [2200, 2600, 2400], 2),      # -> crítico (~5 dias)
    (9110, "Fita crepe 48mm rolo", "un", 6.9, "3M",
     200, [0, 0, 0], 240),               # -> parado (consumível fim de obra)
]


def _gerar_para_obra(seed_qtd_multip: float) -> list[dict]:
    hoje = date.today()
    movs: list[dict] = []
    mid = 1
    for rid, desc, unid, custo, forn, entrada_total, consumo_mensal, dias_ult in _INSUMOS:
        entrada_total = entrada_total * seed_qtd_multip
        # entrada (compra) ~4 meses atrás
        movs.append(_mov(mid, rid, desc, "INPUT", 1, "Compra",
                         entrada_total, custo, hoje - timedelta(days=120), unid, forn))
        mid += 1
        # consumo dos últimos 3 meses (tipo 2 = Consumo)
        consumo_total = 0.0
        for i, q in enumerate(consumo_mensal):
            q = q * seed_qtd_multip
            if q <= 0:
                continue
            dt = hoje - timedelta(days=dias_ult + i * 30)
            movs.append(_mov(mid, rid, desc, "OUTPUT", 2, "Consumo",
                             q, custo, dt, unid, forn))
            mid += 1
            consumo_total += q
        # ajuste de ruptura: cimento consome quase todo o saldo
        if rid == 3301:
            movs.append(_mov(mid, rid, desc, "OUTPUT", 2, "Consumo",
                             entrada_total - consumo_total, custo,
                             hoje - timedelta(days=1), unid, forn))
            mid += 1
    return movs


_CACHE: dict[str, list[dict]] = {}


def coletar_movimentos_demo(prevision_id: str) -> list[dict]:
    if prevision_id not in _CACHE:
        mult = 1.0 if prevision_id == "10223" else 0.6
        _CACHE[prevision_id] = _gerar_para_obra(mult)
    return _CACHE[prevision_id]
