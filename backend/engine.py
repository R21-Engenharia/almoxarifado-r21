"""Stock Engine — determinístico (Python puro, verificável).

Recebe a lista bruta de movimentos do Sienge (inventory-movements) e produz:
agregação por insumo (saldo, consumo, consumo mensal) e análise de estado
(cobertura, data de ruptura, capital parado) + alertas priorizados por impacto.

A IA nunca calcula nada disto. Espelha as fórmulas do handoff (arquivo 02).
"""
from __future__ import annotations
from datetime import date, datetime, timedelta
from collections import defaultdict
from taxonomia import grupo_de, macro_de

# limiares
JANELA_PADRAO = 90          # dias para taxa de consumo
CRITICO_DIAS = 7
BAIXO_DIAS = 15
PARADO_DIAS = 120           # sem consumo há >= isto -> capital parado

ORDEM_STATUS = {"ruptura": 0, "critico": 1, "baixo": 2, "ok": 3, "parado": 4}


def _parse_data(v) -> date | None:
    if not v:
        return None
    if isinstance(v, date) and not isinstance(v, datetime):
        return v
    s = str(v)[:10]
    try:
        return datetime.strptime(s, "%Y-%m-%d").date()
    except ValueError:
        return None


def _is_consumo(desc: str) -> bool:
    return "consumo" in (desc or "").lower()


def agregar(movimentos: list[dict]) -> dict[str, dict]:
    """Agrega os movimentos brutos por resourceId. movementQuantity já vem na
    unidade base (somar é seguro). Consumo = SÓ o tipo 'Consumo'."""
    ag: dict[str, dict] = {}
    for m in movimentos:
        rid = str(m.get("resourceId"))
        if rid == "None":
            continue
        qtd = float(m.get("movementQuantity") or 0)
        valor = float(m.get("movementValue") or 0)
        io = (m.get("inputOutput") or "").upper()
        desc = m.get("resourceDescription") or ""
        dt = _parse_data(m.get("movementDate"))
        unid = m.get("baseUnitOfMeasureSymbol") or m.get("unitOfMeasureSymbol") or ""

        a = ag.get(rid)
        if a is None:
            a = ag[rid] = {
                "resource_id": rid,
                "descricao": desc,
                "entrada_qtd": 0.0,
                "saida_qtd": 0.0,
                "consumo_qtd": 0.0,
                "valor_entrada": 0.0,
                "consumo_mensal": defaultdict(float),
                "unidades": set(),
                "fornecedores": set(),
                "primeiro_mov": dt,
                "ultimo_mov": dt,
                "ultimo_consumo": None,
                "n_movs": 0,
            }
        if desc and not a["descricao"]:
            a["descricao"] = desc
        a["n_movs"] += 1
        if unid:
            a["unidades"].add(unid)
        forn = m.get("supplierName")
        if forn:
            a["fornecedores"].add(forn)
        if dt:
            if not a["primeiro_mov"] or dt < a["primeiro_mov"]:
                a["primeiro_mov"] = dt
            if not a["ultimo_mov"] or dt > a["ultimo_mov"]:
                a["ultimo_mov"] = dt

        if io == "INPUT":
            a["entrada_qtd"] += qtd
            a["valor_entrada"] += qtd * valor
        else:
            a["saida_qtd"] += qtd

        if _is_consumo(m.get("movementTypeDescription", "")):
            a["consumo_qtd"] += qtd
            if dt:
                a["consumo_mensal"][dt.strftime("%Y-%m")] += qtd
                if not a["ultimo_consumo"] or dt > a["ultimo_consumo"]:
                    a["ultimo_consumo"] = dt
    return ag


def _consumo_dia(agregado: dict, hoje: date, janela_dias: int) -> float:
    """Consumo médio/dia na janela (só tipo Consumo)."""
    ini = hoje - timedelta(days=janela_dias)
    total = 0.0
    for mes, q in agregado["consumo_mensal"].items():
        # aproxima pelo mês; para precisão diária usaríamos os movimentos, mas
        # o consumo_mensal já é derivado só de Consumo. Filtra meses na janela.
        try:
            y, mo = mes.split("-")
            ref = date(int(y), int(mo), 15)
        except ValueError:
            continue
        if ref >= ini:
            total += q
    return total / janela_dias if janela_dias else 0.0


def _status(saldo: float, consumo_dia: float, cobertura, ultimo_consumo, hoje) -> str:
    if consumo_dia > 0 and saldo <= 0:
        return "ruptura"
    if consumo_dia > 0:
        if cobertura is not None and cobertura < CRITICO_DIAS:
            return "critico"
        if cobertura is not None and cobertura < BAIXO_DIAS:
            return "baixo"
        return "ok"
    # sem consumo recente
    if saldo > 0:
        dias_parado = (hoje - ultimo_consumo).days if ultimo_consumo else 10**9
        if dias_parado >= PARADO_DIAS:
            return "parado"
    return "ok"


def analisar(movimentos: list[dict], hoje: date | None = None,
             janela_dias: int = JANELA_PADRAO, top: int | None = None) -> dict:
    hoje = hoje or date.today()
    ag = agregar(movimentos)

    itens = []
    valor_em_estoque = 0.0
    valor_parado = 0.0
    resumo_status = defaultdict(int)
    unidades_inconsistentes = 0

    for rid, a in ag.items():
        saldo = a["entrada_qtd"] - a["saida_qtd"]
        cd = _consumo_dia(a, hoje, janela_dias)
        cobertura = (saldo / cd) if cd > 0 else None
        data_ruptura = None
        if saldo > 0 and cd > 0:
            data_ruptura = (hoje + timedelta(days=cobertura)).isoformat()
        custo_unit = (a["valor_entrada"] / a["entrada_qtd"]) if a["entrada_qtd"] else 0.0
        valor_saldo = saldo * custo_unit
        impacto_dia = cd * custo_unit
        st = _status(saldo, cd, cobertura, a["ultimo_consumo"], hoje)
        grupo = grupo_de(a["descricao"])
        macro = macro_de(grupo)
        unid_incon = len(a["unidades"]) > 1

        resumo_status[st] += 1
        if valor_saldo > 0:
            valor_em_estoque += valor_saldo
        if st == "parado":
            valor_parado += max(valor_saldo, 0)
        if unid_incon:
            unidades_inconsistentes += 1

        itens.append({
            "resource_id": rid,
            "descricao": a["descricao"],
            "grupo": grupo,
            "macro": macro,
            "saldo": round(saldo, 3),
            "unidade": next(iter(a["unidades"]), ""),
            "consumo_dia": round(cd, 4),
            "cobertura_dias": round(cobertura, 1) if cobertura is not None else None,
            "data_ruptura": data_ruptura,
            "custo_unit": round(custo_unit, 4),
            "valor_saldo": round(valor_saldo, 2),
            "impacto_dia": round(impacto_dia, 2),
            "status": st,
            "ultimo_consumo": a["ultimo_consumo"].isoformat() if a["ultimo_consumo"] else None,
            "ultimo_mov": a["ultimo_mov"].isoformat() if a["ultimo_mov"] else None,
            "n_movs": a["n_movs"],
            "fornecedores": sorted(a["fornecedores"]),
            "saldo_negativo": saldo < 0,
            "unidade_inconsistente": unid_incon,
        })

    # ordena por (ordem do status, -impacto_dia, cobertura)
    itens.sort(key=lambda x: (
        ORDEM_STATUS.get(x["status"], 9),
        -x["impacto_dia"],
        x["cobertura_dias"] if x["cobertura_dias"] is not None else 10**9,
    ))

    alertas = [i for i in itens if i["status"] in ("ruptura", "critico", "baixo")]
    parados = sorted([i for i in itens if i["status"] == "parado"],
                     key=lambda x: -x["valor_saldo"])

    kpis = {
        "n_insumos": len(itens),
        "valor_em_estoque": round(valor_em_estoque, 2),
        "valor_parado": round(valor_parado, 2),
        "resumo_status": dict(resumo_status),
        "unidades_inconsistentes": unidades_inconsistentes,
        "saldos_negativos": sum(1 for i in itens if i["saldo_negativo"]),
    }

    return {
        "hoje": hoje.isoformat(),
        "janela_dias": janela_dias,
        "kpis": kpis,
        "alertas": alertas[:top] if top else alertas,
        "parados": parados[:top] if top else parados,
        "itens": itens,
    }
