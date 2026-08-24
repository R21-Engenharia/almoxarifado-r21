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
SELIC_ANUAL = 0.15          # taxa p/ custo de oportunidade do capital parado

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


def _ultimos_meses(hoje: date, n: int) -> list[str]:
    seq = []
    for i in range(n - 1, -1, -1):
        yy, mm = hoje.year, hoje.month - i
        while mm <= 0:
            mm += 12
            yy -= 1
        seq.append(f"{yy:04d}-{mm:02d}")
    return seq


def financeiro(movimentos: list[dict], hoje: date | None = None, meses: int = 12) -> dict:
    """Módulo Financeiro: KPIs (capital em estoque, capital ocioso + custo Selic,
    % consumido, ociosidade média) + fluxo mensal Entradas×Saídas (em R$)."""
    hoje = hoje or date.today()
    ag = agregar(movimentos)

    # fluxo mensal (valor movimentado por mês)
    entradas: dict[str, float] = defaultdict(float)
    saidas: dict[str, float] = defaultdict(float)
    for m in movimentos:
        dt = _parse_data(m.get("movementDate"))
        if not dt:
            continue
        val = float(m.get("movementQuantity") or 0) * float(m.get("movementValue") or 0)
        mes = dt.strftime("%Y-%m")
        if (m.get("inputOutput") or "").upper() == "INPUT":
            entradas[mes] += val
        else:
            saidas[mes] += val
    seq = _ultimos_meses(hoje, meses)
    fluxo = [{"mes": k, "entradas": round(entradas.get(k, 0.0), 2),
              "saidas": round(saidas.get(k, 0.0), 2)} for k in seq]

    est = analisar(movimentos, hoje=hoje)
    itens = est["itens"]

    total_entrada_val = sum(a["valor_entrada"] for a in ag.values())
    total_consumo_val = 0.0
    for a in ag.values():
        custo = (a["valor_entrada"] / a["entrada_qtd"]) if a["entrada_qtd"] else 0.0
        total_consumo_val += a["consumo_qtd"] * custo
    consumido_pct = (total_consumo_val / total_entrada_val * 100) if total_entrada_val else 0.0

    # ociosidade média (dias sem consumo) sobre itens com saldo positivo
    dias = []
    for i in itens:
        if i["saldo"] > 0:
            ref = i["ultimo_consumo"] or i["ultimo_mov"]
            if ref:
                dias.append((hoje - date.fromisoformat(ref)).days)
    ociosidade = round(sum(dias) / len(dias)) if dias else 0

    capital_ocioso = est["kpis"]["valor_parado"]
    return {
        "hoje": hoje.isoformat(),
        "kpis": {
            "capital_em_estoque": est["kpis"]["valor_em_estoque"],
            "capital_ocioso": capital_ocioso,
            "selic_mensal": round(capital_ocioso * (SELIC_ANUAL / 12), 2),
            "selic_anual_pct": round(SELIC_ANUAL * 100, 2),
            "estoque_consumido_pct": round(consumido_pct, 2),
            "ociosidade_media_dias": ociosidade,
            "n_insumos": est["kpis"]["n_insumos"],
            "n_parados": est["kpis"]["resumo_status"].get("parado", 0),
        },
        "fluxo": fluxo,
    }


def fornecedores(pedidos: list[dict], nomes: dict[str, str] | None = None,
                 hoje: date | None = None, meses: int = 12) -> dict:
    """Scorecard de fornecedores a partir dos purchase-orders (cabeçalhos).
    Por fornecedor: nº pedidos, valor comprado, % no prazo (1 - atraso), último pedido."""
    hoje = hoje or date.today()
    nomes = nomes or {}
    ini = hoje - timedelta(days=meses * 31)
    forn: dict[str, dict] = {}
    total_valor = 0.0
    for p in pedidos:
        dt = _parse_data(p.get("date"))
        if dt and dt < ini:
            continue
        sid = str(p.get("supplierId") or "")
        if not sid:
            continue
        valor = float(p.get("totalAmount") or 0)
        atrasado = bool(p.get("deliveryLate"))
        autorizado = bool(p.get("authorized"))
        f = forn.get(sid)
        if f is None:
            f = forn[sid] = {"supplier_id": sid, "nome": nomes.get(sid, f"Fornecedor {sid}"),
                             "n_pedidos": 0, "valor_total": 0.0, "n_atrasados": 0,
                             "n_autorizados": 0, "ultimo_pedido": None}
        f["n_pedidos"] += 1
        f["valor_total"] += valor
        total_valor += valor
        if atrasado:
            f["n_atrasados"] += 1
        if autorizado:
            f["n_autorizados"] += 1
        if dt and (not f["ultimo_pedido"] or dt.isoformat() > f["ultimo_pedido"]):
            f["ultimo_pedido"] = dt.isoformat()

    lista = []
    for f in forn.values():
        n = f["n_pedidos"]
        f["valor_total"] = round(f["valor_total"], 2)
        f["pct_no_prazo"] = round((1 - f["n_atrasados"] / n) * 100, 1) if n else 100.0
        f["pct_do_total"] = round(f["valor_total"] / total_valor * 100, 1) if total_valor else 0
        lista.append(f)
    lista.sort(key=lambda x: -x["valor_total"])

    n_pedidos = sum(f["n_pedidos"] for f in lista)
    n_atras = sum(f["n_atrasados"] for f in lista)
    return {
        "hoje": hoje.isoformat(),
        "kpis": {
            "n_fornecedores": len(lista),
            "valor_total": round(total_valor, 2),
            "n_pedidos": n_pedidos,
            "pct_atraso": round(n_atras / n_pedidos * 100, 1) if n_pedidos else 0,
            "meses": meses,
        },
        "fornecedores": lista,
    }


def _mediana(xs: list) -> float | None:
    n = len(xs)
    if not n:
        return None
    xs = sorted(xs)
    m = n // 2
    return xs[m] if n % 2 else (xs[m - 1] + xs[m]) / 2


def recebimentos(pedidos: list[dict], movimentos: list[dict],
                 nomes: dict[str, str] | None = None, hoje: date | None = None,
                 meses: int = 12) -> dict:
    """Recebimento & Conferência a partir de dados REAIS do Sienge:
      - pedidos (purchase-orders): status de entrega + valor em risco (fila pendente/atrasado)
      - movimentos de entrada tipo 'Compra' (inventory-movements): o que FISICAMENTE chegou,
        já com NF (nº), fornecedor, insumo, quantidade e valor -> físico + nota num registro.
    Deriva: fila pendente/atrasada, lead time estimado (pedido->recebimento) por fornecedor,
    log de recebimentos e reajuste silencioso (variação de preço do insumo entre recebimentos)."""
    import bisect
    hoje = hoje or date.today()
    nomes = nomes or {}

    def nome(sid) -> str:
        return nomes.get(str(sid)) or f"Fornecedor {sid}"

    # ---- recebimentos físicos: INPUT tipo 'Compra' (o que chegou = físico + nota) ----
    receb: list[dict] = []
    for m in movimentos:
        if m.get("inputOutput") != "INPUT" or (m.get("movementTypeDescription") or "") != "Compra":
            continue
        dt = _parse_data(m.get("movementDate"))
        if not dt:
            continue
        qtd = float(m.get("movementQuantity") or 0)
        val = float(m.get("movementValue") or 0)
        receb.append({
            "data": dt.isoformat(), "_dt": dt,
            "nf": (f'{(m.get("documentId") or "").strip()} {(m.get("movementNumber") or "").strip()}').strip(),
            "supplier_id": str(m.get("supplierId") or ""),
            "fornecedor": (m.get("supplierName") or nome(m.get("supplierId"))).strip(),
            "resource_id": str(m.get("resourceId") or ""),
            "descricao": (m.get("resourceDescription") or "").strip(),
            "quantidade": qtd,
            "unidade": m.get("unitOfMeasureSymbol") or m.get("unitOfMeasure") or "",
            "valor": round(val, 2),
            "preco_unit": round(val / qtd, 4) if qtd else None,
        })
    receb.sort(key=lambda r: r["data"], reverse=True)
    d30 = hoje - timedelta(days=30)
    val_30 = round(sum(r["valor"] for r in receb if r["_dt"] >= d30), 2)
    n_30 = sum(1 for r in receb if r["_dt"] >= d30)

    # ---- fila pendente / atrasada (cabeçalhos de pedido autorizado) ----
    fila: list[dict] = []
    valor_pend = valor_atras = 0.0
    n_atras = 0
    for p in pedidos:
        if not p.get("authorized"):
            continue
        status = (p.get("status") or "").upper()
        if status in ("CANCELED", "FULLY_DELIVERED"):
            continue
        dt = _parse_data(p.get("date"))
        val = float(p.get("totalAmount") or 0)
        late = bool(p.get("deliveryLate"))
        fila.append({
            "pedido_id": p.get("id"),
            "numero": p.get("formattedPurchaseOrderId") or str(p.get("id")),
            "data": dt.isoformat() if dt else None,
            "dias_aberto": (hoje - dt).days if dt else None,
            "fornecedor": nome(p.get("supplierId")),
            "valor": round(val, 2),
            "status": status or "PENDING",
            "parcial": status == "PARTIALLY_DELIVERED",
            "atrasado": late,
            "comprador": p.get("buyerId"),
        })
        valor_pend += val
        if late:
            n_atras += 1
            valor_atras += val
    fila.sort(key=lambda x: (not x["atrasado"], -(x["dias_aberto"] or 0)))

    # ---- lead time estimado (pedido -> recebimento) por fornecedor ----
    pos_forn: dict[str, list] = defaultdict(list)
    for p in pedidos:
        dt = _parse_data(p.get("date"))
        if dt and p.get("authorized"):
            pos_forn[str(p.get("supplierId") or "")].append(dt)
    for k in pos_forn:
        pos_forn[k].sort()
    lead_forn: dict[str, list] = defaultdict(list)
    for r in receb:
        datas = pos_forn.get(r["supplier_id"])
        if not datas:
            continue
        i = bisect.bisect_right(datas, r["_dt"]) - 1
        if i < 0:
            continue
        lead = (r["_dt"] - datas[i]).days
        if 0 <= lead <= 180:
            lead_forn[r["supplier_id"]].append(lead)
    leads: list[dict] = []
    todos: list[int] = []
    for sid, ls in lead_forn.items():
        if len(ls) < 2:
            continue
        todos += ls
        leads.append({"fornecedor": nome(sid), "n_receb": len(ls),
                      "lead_mediano": round(_mediana(ls), 1),
                      "lead_min": min(ls), "lead_max": max(ls)})
    leads.sort(key=lambda x: -x["lead_mediano"])
    lead_geral = round(_mediana(todos), 1) if todos else None

    # ---- reajuste silencioso: variação de preço do MESMO insumo entre recebimentos ----
    # compara os 2 recebimentos mais recentes do insumo, com guardas contra ruído:
    # mesma unidade (evita cx×un), preço-base sadio, alta relevante e não-absurda,
    # e o recebimento novo dentro da janela analisada.
    ini_iso = (hoje - timedelta(days=meses * 31)).isoformat()
    por_ins: dict[str, list] = defaultdict(list)
    for r in receb:
        if r["preco_unit"] and r["preco_unit"] >= 0.10:
            por_ins[r["resource_id"]].append(r)
    reaj: list[dict] = []
    for rid, rs in por_ins.items():
        if len(rs) < 2:
            continue
        rs2 = sorted(rs, key=lambda x: x["data"])
        ant, novo = rs2[-2], rs2[-1]
        if novo["data"] < ini_iso:
            continue
        if ant["unidade"] != novo["unidade"]:
            continue
        var = (novo["preco_unit"] - ant["preco_unit"]) / ant["preco_unit"] * 100
        if var < 8 or var > 300:
            continue
        reaj.append({
            "resource_id": rid, "descricao": novo["descricao"], "unidade": novo["unidade"],
            "preco_ant": round(ant["preco_unit"], 2), "preco_novo": round(novo["preco_unit"], 2),
            "var_pct": round(var, 1), "data_ant": ant["data"], "data_novo": novo["data"],
            "forn_ant": ant["fornecedor"], "forn_novo": novo["fornecedor"],
            "mesmo_forn": ant["supplier_id"] == novo["supplier_id"],
        })
    reaj.sort(key=lambda x: -x["var_pct"])

    for r in receb:
        r.pop("_dt", None)

    return {
        "hoje": hoje.isoformat(),
        "kpis": {
            "n_pendentes": len(fila), "valor_pendente": round(valor_pend, 2),
            "n_atrasados": n_atras, "valor_atrasado": round(valor_atras, 2),
            "recebido_30d": val_30, "n_recebido_30d": n_30,
            "lead_time_mediano": lead_geral, "n_reajustes": len(reaj),
        },
        "fila": fila,
        "lead_fornecedores": leads[:30],
        "recebimentos": receb[:60],
        "reajustes": reaj[:40],
    }


def suprimentos(itens: list[dict], lead_fornecedores: list[dict],
                scorecard: list[dict], hoje: date | None = None,
                cobertura_alvo: int = 45, lead_padrao: int = 10) -> dict:
    """MRP preditivo: para cada insumo ATIVO, calcula o ponto de pedido com o
    lead time REAL do fornecedor e um estoque de segurança que cresce com a
    falta de confiabilidade do fornecedor. Sai a lista 'comprar até o dia X,
    quantidade Y' e o trade-off em R$ (imobilizar cedo × risco de faltar).

    Tudo vem de dados reais já calculados:
      - itens: saída de analisar() (saldo, consumo_dia, custo_unit, cobertura, ruptura, fornecedores)
      - lead_fornecedores: de recebimentos() (lead mediano pedido->entrega por fornecedor)
      - scorecard: de fornecedores() (% no prazo por fornecedor)
    """
    hoje = hoje or date.today()
    lead_map = {l["fornecedor"]: l["lead_mediano"] for l in lead_fornecedores}
    leads_todos = [l["lead_mediano"] for l in lead_fornecedores]
    lead_geral = _mediana(leads_todos) if leads_todos else lead_padrao
    rel_map = {s["nome"]: s.get("pct_no_prazo", 100.0) for s in scorecard}
    selic_dia = SELIC_ANUAL / 365
    selic_mes = SELIC_ANUAL / 12

    URG = {"comprar_agora": 0, "esta_semana": 1, "programar": 2, "ok": 3}
    lista: list[dict] = []
    for it in itens:
        cd = it.get("consumo_dia") or 0
        cobertura = it.get("cobertura_dias")
        if cd <= 0 or cobertura is None:
            continue  # sem consumo recente -> não entra no MRP (é capital parado, outro módulo)
        saldo = it.get("saldo") or 0
        custo = it.get("custo_unit") or 0
        forns = it.get("fornecedores") or []
        # fornecedor de referência: o que tem lead conhecido; senão o primeiro
        forn = next((f for f in forns if f in lead_map), forns[0] if forns else None)
        lead = lead_map.get(forn, lead_geral) or lead_padrao
        pct_prazo = rel_map.get(forn, 85.0)
        pct_atraso = max(0.0, 100 - pct_prazo)
        # estoque de segurança (em dias): cresce com o lead e com o histórico de atraso
        ss_dias = max(2, round(lead * (0.25 + pct_atraso / 100)))
        protecao = lead + ss_dias                      # dias que o estoque precisa cobrir
        dias_ate_pedir = round(cobertura - protecao, 1)  # <=0 => já passou do ponto
        limite = (hoje + timedelta(days=int(dias_ate_pedir))).isoformat()
        rop_qtd = round(cd * protecao, 2)              # ponto de pedido (quantidade)
        qtd_sugerida = max(0.0, round(cd * (protecao + cobertura_alvo) - saldo, 2))
        valor_sugerido = round(qtd_sugerida * custo, 2)
        custo_antecipar_dia = round(valor_sugerido * selic_dia, 2)  # R$/dia preso se comprar cedo
        exposicao_parada_dia = it.get("impacto_dia") or 0          # R$/dia em risco se parar

        if dias_ate_pedir <= 0:
            urg = "comprar_agora"
        elif dias_ate_pedir <= 7:
            urg = "esta_semana"
        elif dias_ate_pedir <= cobertura_alvo:
            urg = "programar"
        else:
            urg = "ok"

        lista.append({
            "resource_id": it["resource_id"], "descricao": it["descricao"],
            "unidade": it.get("unidade", ""), "macro": it.get("macro", ""),
            "saldo": saldo, "consumo_dia": round(cd, 3), "custo_unit": round(custo, 4),
            "cobertura_dias": cobertura, "data_ruptura": it.get("data_ruptura"),
            "fornecedor": forn, "lead_dias": round(lead, 1), "pct_no_prazo": round(pct_prazo, 1),
            "ss_dias": ss_dias, "protecao_dias": protecao,
            "rop_qtd": rop_qtd, "dias_ate_pedir": dias_ate_pedir, "data_limite": limite,
            "qtd_sugerida": qtd_sugerida, "valor_sugerido": valor_sugerido,
            "custo_antecipar_dia": custo_antecipar_dia, "exposicao_parada_dia": round(exposicao_parada_dia, 2),
            "urgencia": urg,
        })

    lista.sort(key=lambda x: (URG[x["urgencia"]], x["dias_ate_pedir"], -x["exposicao_parada_dia"]))

    agora = [x for x in lista if x["urgencia"] == "comprar_agora"]
    semana = [x for x in lista if x["urgencia"] == "esta_semana"]
    nao_urgente = [x for x in lista if x["urgencia"] in ("programar", "ok")]
    valor_total = round(sum(x["valor_sugerido"] for x in lista), 2)
    economia_mes = round(sum(x["valor_sugerido"] for x in nao_urgente) * selic_mes, 2)

    return {
        "hoje": hoje.isoformat(),
        "parametros": {"cobertura_alvo_dias": cobertura_alvo, "selic_anual_pct": round(SELIC_ANUAL * 100, 2)},
        "kpis": {
            "n_comprar_agora": len(agora), "valor_comprar_agora": round(sum(x["valor_sugerido"] for x in agora), 2),
            "n_esta_semana": len(semana), "valor_esta_semana": round(sum(x["valor_sugerido"] for x in semana), 2),
            "n_itens": len(lista), "valor_total_sugerido": valor_total,
            "economia_selic_mes": economia_mes,
            "exposicao_parada_dia": round(sum(x["exposicao_parada_dia"] for x in agora), 2),
        },
        "itens": lista[:250],
    }


def consumo(movimentos: list[dict], hoje: date | None = None, meses: int = 12) -> dict:
    """Módulo Consumo: série mensal de consumo (R$, só tipo Consumo), KPIs de
    ritmo/tendência e ranking dos insumos que mais consomem capital."""
    hoje = hoje or date.today()
    ag = agregar(movimentos)
    seq = _ultimos_meses(hoje, meses)
    serie = {k: 0.0 for k in seq}

    itens = []
    for rid, a in ag.items():
        if a["consumo_qtd"] <= 0:
            continue
        custo = (a["valor_entrada"] / a["entrada_qtd"]) if a["entrada_qtd"] else 0.0
        consumo_periodo = 0.0
        for mes, q in a["consumo_mensal"].items():
            if mes in serie:
                serie[mes] += q * custo
                consumo_periodo += q * custo
        cd = _consumo_dia(a, hoje, 90)
        saldo = a["entrada_qtd"] - a["saida_qtd"]
        cobertura = (saldo / cd) if cd > 0 else None
        itens.append({
            "resource_id": rid, "descricao": a["descricao"],
            "unidade": next(iter(a["unidades"]), ""),
            "consumo_periodo": round(consumo_periodo, 2),
            "consumo_dia_valor": round(cd * custo, 2),
            "consumo_qtd": round(a["consumo_qtd"], 2),
            "cobertura_dias": round(cobertura, 1) if cobertura is not None else None,
            "saldo": round(saldo, 2),
            "ultimo_consumo": a["ultimo_consumo"].isoformat() if a["ultimo_consumo"] else None,
        })

    itens.sort(key=lambda x: -x["consumo_periodo"])
    serie_list = [{"mes": k, "consumo": round(serie[k], 2)} for k in seq]
    total = sum(serie.values())
    mes_atual = serie[seq[-1]] if seq else 0.0
    tendencia = None
    if len(seq) >= 2 and serie[seq[-2]] > 0:
        tendencia = round((serie[seq[-1]] - serie[seq[-2]]) / serie[seq[-2]] * 100, 1)
    return {
        "hoje": hoje.isoformat(),
        "kpis": {
            "consumo_mes": round(mes_atual, 2),
            "consumo_medio_mes": round(total / len(seq), 2) if seq else 0,
            "consumo_total_periodo": round(total, 2),
            "tendencia_pct": tendencia,
            "n_ativos": len(itens),
            "meses": len(seq),
        },
        "serie": serie_list,
        "top": itens[:50],
    }
