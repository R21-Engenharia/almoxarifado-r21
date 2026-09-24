"""Passos 08–10 do BOX21: EAP no consumo, transferências/devolução/desmobilização,
requisição com reserva e inventário cíclico.

Tudo que grava no Sienge passa pelo `_gravar` do app (auditoria antes + chave de
idempotência por item). Estados ficam no livro operacional (livro.py), sempre com
compare-and-set no status. Chaves derivadas do próprio registro (ex.: "trf12-rcb")
garantem que repetir uma ação — por clique duplo, rede ou retomada — não duplica
nada no Sienge.
"""
from __future__ import annotations
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel

import app as A
import livro

router = APIRouter()


def _obra(obra: str) -> dict:
    o = A.OBRAS.get(str(obra))
    if not o:
        raise HTTPException(404, f"Obra desconhecida: {obra}")
    return o


def _papel(usuario: str) -> str:
    return (A._perfil(usuario).get("role") or "").lower() if A._auth_ativo() else "admin"


def _livro(fn, *a, **kw):
    """Chama o livro e traduz falha de banco em HTTP (com a dica da migração)."""
    try:
        return fn(*a, **kw)
    except A.supa.AuthError as e:
        raise HTTPException(e.status or 503, e.msg)


def _agora() -> str:
    return datetime.now().astimezone().isoformat()


def _sig(rid, did, tid) -> tuple:
    return (str(rid), did, tid)


def _item_escrita(l: dict, quantidade: float) -> A.ItemEscrita:
    return A.ItemEscrita(resource_id=str(l["resource_id"]), quantidade=quantidade,
                         unidade=l.get("unidade"), descricao=l.get("descricao"),
                         detail_id=l.get("detail_id"), trademark_id=l.get("trademark_id"),
                         variante=l.get("variante"))


# ============================================================== 08 · EAP no consumo
_EAP_CACHE: dict[str, dict] = {}
_ORC_CACHE: dict[tuple, tuple] = {}   # (obra, rid, did, tid) -> (dia, [apropriações])


def _eap_folhas(obra: str) -> list[dict]:
    """Subetapas de último nível do orçamento (onde o material é apropriado), por UC."""
    if obra in _EAP_CACHE:
        return _EAP_CACHE[obra]["folhas"]
    mapa = A._wbs_map(obra)
    ucs, wbs = mapa.get("ucs", {}), mapa.get("wbs", {})
    out = []
    for uc, codes in wbs.items():
        prefixos = set()
        for k in codes:
            p = k.split(".")
            prefixos.update(".".join(p[:n]) for n in range(1, len(p)))
        for k in sorted(codes):
            if k in prefixos:
                continue
            p = k.split(".")
            out.append({
                "uc_id": int(uc) if str(uc).isdigit() else None, "uc_nome": ucs.get(uc),
                "codigo": k, "descricao": (codes[k].get("descricao") or k).strip(),
                "unidade": codes[k].get("unidade"),
                "grupo": ((codes.get(p[0]) or {}).get("descricao") or "").strip() or None,
                "pai": ((codes.get(".".join(p[:-1])) or {}).get("descricao") or "").strip() or None
                       if len(p) > 1 else None,
            })
    _EAP_CACHE[obra] = {"folhas": out}
    return out


def _orcamento_insumo(obra: str, rid, did=None, tid=None) -> list[dict]:
    """Onde o insumo está orçado na obra (apropriação do Sienge), cache diário."""
    if A._modo_demo():
        return []
    k = (obra, str(rid), did, tid)
    hoje = date.today().isoformat()
    c = _ORC_CACHE.get(k)
    if c and c[0] == hoje:
        return c[1]
    o = _obra(obra)
    try:
        aprop = A.sienge.buscar_apropriacao(o["cost_center_id"], rid, detail_id=did, trademark_id=tid)
    except Exception:
        return []   # sem orçamento é melhor que sem tela
    _ORC_CACHE[k] = (hoje, aprop)
    return aprop


def _subetapas_orcadas(obra: str, aprop: list[dict]) -> list[dict]:
    wbs = A._wbs_map(obra)
    out = []
    for a in aprop:
        code = a.get("costEstimationItemReference")
        r = A._resolver_wbs(wbs, a.get("buildingUnitId"), code)
        out.append({"uc_id": a.get("buildingUnitId"), "uc_nome": r["uc_nome"], "codigo": str(code),
                    "descricao": (r["info"].get("descricao") or str(code)).strip(),
                    "qtd_orcada": a.get("quantity")})
    return out


@router.get("/api/eap/lista")
def eap_lista(obra: str = Query(...), usuario: str = Depends(A.acesso("operar", "requisicao", "consumo"))):
    """Lista de subetapas para o seletor + as últimas usadas nesta obra."""
    _obra(obra)
    folhas = _eap_folhas(obra)
    recentes, vistos = [], set()
    try:
        for m in A.audit.historico(obra, 300):
            if m.get("eap_codigo") and (m.get("eap_uc_id"), m["eap_codigo"]) not in vistos:
                vistos.add((m.get("eap_uc_id"), m["eap_codigo"]))
                recentes.append({"uc_id": m.get("eap_uc_id"), "codigo": m["eap_codigo"],
                                 "descricao": m.get("eap_descricao")})
            if len(recentes) >= 8:
                break
    except Exception:
        pass
    return {"tem_mapa": bool(folhas), "subetapas": folhas, "recentes": recentes}


@router.get("/api/eap/insumo")
def eap_insumo(obra: str = Query(...), resource_id: str = Query(...),
               detail_id: int | None = None, trademark_id: int | None = None,
               usuario: str = Depends(A.acesso("operar", "requisicao", "consumo"))):
    """Subetapas onde este insumo (nesta variação) está orçado — sugestões do seletor."""
    _obra(obra)
    return {"orcadas": _subetapas_orcadas(obra, _orcamento_insumo(obra, resource_id, detail_id, trademark_id))}


@router.get("/api/eap/consumo-orcado")
def consumo_orcado(obra: str = Query(...), usuario: str = Depends(A.acesso("consumo"))):
    """Consumo registrado pelo app × quantidade orçada, por subetapa e insumo.
    Base: baixas gravadas e não estornadas COM subetapa. O orçado vem da apropriação
    do insumo no Sienge (mesma fonte da tela de aprovação)."""
    _obra(obra)
    try:
        linhas = A.audit.consumo_eap(obra)
    except A.supa.AuthError as e:
        raise HTTPException(e.status or 503, e.msg)
    com = [r for r in linhas if r.get("eap_codigo")]
    desde = min((str(r["criado_em"]) for r in com), default=None)
    sem = [r for r in linhas if not r.get("eap_codigo") and desde and str(r["criado_em"]) >= desde]
    custo = {i["resource_id"]: i for i in A._analise(obra)["itens"]}

    # orçado de cada (insumo, variação) — em paralelo, com cache diário
    chaves = sorted({_sig(r["resource_id"], r.get("detail_id"), r.get("trademark_id")) for r in com},
                    key=str)
    with ThreadPoolExecutor(max_workers=6) as ex:
        aprops = dict(zip(chaves, ex.map(lambda k: _orcamento_insumo(obra, *k), chaves)))

    wbs = A._wbs_map(obra)
    grupos: dict[tuple, dict] = {}
    for r in com:
        g = grupos.setdefault((r.get("eap_uc_id"), r["eap_codigo"]), {
            "uc_id": r.get("eap_uc_id"), "codigo": r["eap_codigo"],
            "descricao": r.get("eap_descricao") or r["eap_codigo"],
            "uc_nome": A._resolver_wbs(wbs, r.get("eap_uc_id"), r["eap_codigo"])["uc_nome"],
            "itens": {}})
        k = _sig(r["resource_id"], r.get("detail_id"), r.get("trademark_id"))
        it = g["itens"].setdefault(k, {"resource_id": k[0], "detail_id": k[1], "trademark_id": k[2],
                                       "descricao": r.get("descricao") or f"#{k[0]}",
                                       "unidade": r.get("unidade"), "qtd_consumida": 0.0, "n_baixas": 0})
        it["qtd_consumida"] += float(r.get("quantidade") or 0)
        it["n_baixas"] += 1

    saida, n_acima, valor_total = [], 0, 0.0
    for g in grupos.values():
        itens = []
        for k, it in g["itens"].items():
            orc = None
            for a in aprops.get(k, []):
                if str(a.get("costEstimationItemReference")) == str(g["codigo"]) and \
                        (g["uc_id"] is None or a.get("buildingUnitId") == g["uc_id"]):
                    orc = (orc or 0) + float(a.get("quantity") or 0)
            cu = (custo.get(k[0]) or {}).get("custo_unit") or 0
            pct = round(it["qtd_consumida"] / orc * 100, 1) if orc else None
            status = "sem_orcamento" if not orc else "acima" if pct > 100 else \
                     "atencao" if pct >= 80 else "ok"
            n_acima += status == "acima"
            valor = round(it["qtd_consumida"] * cu, 2)
            valor_total += valor
            itens.append({**it, "qtd_consumida": round(it["qtd_consumida"], 3), "qtd_orcada": orc,
                          "pct": pct, "valor": valor, "custo_unit": cu, "status": status})
        itens.sort(key=lambda x: (-(x["pct"] or 0), -x["valor"]))
        saida.append({**{k: v for k, v in g.items() if k != "itens"}, "itens": itens,
                      "valor_consumido": round(sum(i["valor"] for i in itens), 2),
                      "n_acima": sum(i["status"] == "acima" for i in itens),
                      "n_sem_orcamento": sum(i["status"] == "sem_orcamento" for i in itens)})
    saida.sort(key=lambda g: (-g["n_acima"], -g["valor_consumido"]))
    return {
        "hoje": date.today().isoformat(), "desde": desde[:10] if desde else None,
        "kpis": {"n_baixas_com_eap": len(com), "n_baixas_sem_eap": len(sem),
                 "pct_com_eap": round(len(com) / (len(com) + len(sem)) * 100, 1) if com else 0.0,
                 "n_subetapas": len(saida), "n_itens_acima": n_acima, "valor_consumido": round(valor_total, 2)},
        "subetapas": saida,
    }


# ============================================================== 09 · transferências
class TransfNova(BaseModel):
    destino: str
    itens: list[A.ItemEscrita]
    obs: str | None = None


class TransfRecebe(BaseModel):
    itens: list[dict]          # [{idx, qtd_recebida}]
    obs: str | None = None


def _nome_obra(pid) -> str:
    return (A.OBRAS.get(str(pid)) or {}).get("nome") or str(pid)


def _consolidar_envio(t: dict, chave: str) -> dict:
    """Lê na auditoria o que o Sienge confirmou da saída e grava no registro da transferência."""
    itens = t["itens"]
    corpo_itens = [_item_escrita(l, l["quantidade"]) for l in itens]
    chaves = A._chaves_itens(chave, corpo_itens)
    feitos = {r["chave_idempotencia"]: r for r in A.audit.por_chaves([c for c in chaves if c])}
    pend = False
    for l, c in zip(itens, chaves):
        r = feitos.get(c)
        l["qtd_enviada"] = float(r["quantidade"]) if r and r.get("status") == "gravado" else 0.0
        pend = pend or bool(r and r.get("status") == "pendente")
    return {"itens": itens, "pendente": pend}


def _criar_transferencia(origem: str, destino: str, itens: list[A.ItemEscrita], obs, usuario, chave) -> dict:
    _obra(origem)
    if str(destino) == str(origem):
        raise HTTPException(422, "A obra de destino tem que ser diferente da origem.")
    if str(destino) not in A.OBRAS:
        raise HTTPException(422, "Obra de destino desconhecida pelo app.")
    if not itens or any(i.quantidade <= 0 for i in itens):
        raise HTTPException(422, "Informe os itens e quantidades a transferir.")
    t = _livro(livro.por_chave, "transferencias", chave)
    if t is None:
        linhas = [{**i.model_dump(), "preco_unit": round(A._preco_unit(origem, i.resource_id) or 0, 4),
                   "qtd_enviada": 0.0, "qtd_recebida": None} for i in itens]
        try:
            t = _livro(livro.inserir, "transferencias", {
                "criado_por": usuario, "origem": str(origem), "destino": str(destino),
                "status": "enviando", "chave": chave, "itens": linhas, "obs": obs})
        except livro.ConflitoChave:
            t = _livro(livro.por_chave, "transferencias", chave)
    if str(t["origem"]) != str(origem) or str(t["destino"]) != str(destino):
        raise HTTPException(409, "Esta chave já foi usada em outra transferência.")
    if t["status"] not in ("enviando", "falhou"):
        return {"transferencia": t, "repetida": True}
    if t["status"] == "falhou":
        t = _livro(livro.transicionar, "transferencias", t["id"], "falhou", {"status": "enviando", "erro": None}) or t

    corpo = A.Escrita(itens=[_item_escrita(l, l["quantidade"]) for l in t["itens"]])
    erro = None
    try:
        A._gravar(origem, "transf_saida", corpo, usuario, chave,
                  extra={"transferencia_id": t["id"], "obra_contraparte": str(destino)})
    except HTTPException as e:
        erro = e
    cons = _consolidar_envio(t, chave)
    n_ok = sum(1 for l in cons["itens"] if l["qtd_enviada"] > 0)
    if erro is None or n_ok == len(cons["itens"]):
        patch = {"status": "em_transito", "itens": cons["itens"], "erro": None}
    elif n_ok == 0 and not cons["pendente"]:
        patch = {"status": "falhou", "itens": cons["itens"], "erro": str(erro.detail)[:500]}
    else:  # parcial ou sem confirmação: fica "enviando" para retomar (mesma chave) ou seguir
        patch = {"status": "enviando", "itens": cons["itens"], "erro": str(erro.detail)[:500]}
    t = _livro(livro.atualizar, "transferencias", t["id"], patch) or {**t, **patch}
    if erro is not None and patch["status"] != "em_transito":
        raise HTTPException(erro.status_code, erro.detail)
    return {"transferencia": t, "repetida": False}


@router.get("/api/transferencias/obras")
def transf_obras(usuario: str = Depends(A.acesso("transferencias"))):
    """Obras que o app conhece (destinos possíveis de uma transferência)."""
    return [{"prevision_id": pid, "nome": o["nome"]} for pid, o in A.OBRAS.items()]


@router.get("/api/transferencias")
def transf_listar(obra: str = Query(...), usuario: str = Depends(A.acesso("transferencias"))):
    _obra(obra)
    ts = _livro(livro.listar, "transferencias", obra=str(obra), obra_em=("origem", "destino"), limite=100)
    for t in ts:
        t["sentido"] = "saida" if str(t["origem"]) == str(obra) else "entrada"
        t["origem_nome"], t["destino_nome"] = _nome_obra(t["origem"]), _nome_obra(t["destino"])
    return {"transferencias": ts}


@router.post("/api/transferencias")
def transf_criar(corpo: TransfNova, obra: str = Query(...),
                 idempotency_key: str | None = Header(default=None),
                 usuario: str = Depends(A.operador("transferencias"))):
    """Transferência: saída avulsa na origem -> 'em trânsito' -> entrada no destino
    quando alguém da obra de destino confirmar o recebimento."""
    chave = A._chave_valida(idempotency_key)
    if not chave:
        raise HTTPException(422, "Idempotency-Key obrigatória.")
    return _criar_transferencia(obra, corpo.destino, corpo.itens, corpo.obs, usuario, chave)


def _transf_da_obra(tid: int, obra: str, papel: str) -> dict:
    t = _livro(livro.obter, "transferencias", tid)
    if not t or str(t[papel]) != str(obra):
        raise HTTPException(404, "Transferência não encontrada nesta obra.")
    return t


@router.post("/api/transferencias/{tid}/seguir")
def transf_seguir(tid: int, obra: str = Query(...), usuario: str = Depends(A.operador("transferencias"))):
    """Envio incompleto: segue só com os itens que já saíram (os demais ficam na origem)."""
    t = _transf_da_obra(tid, obra, "origem")
    if not any((l.get("qtd_enviada") or 0) > 0 for l in t["itens"]):
        raise HTTPException(409, "Nenhum item saiu da origem ainda.")
    feito = _livro(livro.transicionar, "transferencias", tid, "enviando", {"status": "em_transito", "erro": None})
    if not feito:
        raise HTTPException(409, "A transferência mudou de estado. Atualize a tela.")
    return {"transferencia": feito}


@router.post("/api/transferencias/{tid}/receber")
def transf_receber(tid: int, corpo: TransfRecebe, obra: str = Query(...),
                   usuario: str = Depends(A.operador("transferencias"))):
    """Confirma o recebimento na obra de destino (entrada avulsa com o custo da origem).
    Quantidade menor que a enviada fica registrada como divergência."""
    t = _transf_da_obra(tid, obra, "destino")
    if t["status"] == "em_transito":
        itens = t["itens"]
        qtds = {int(x["idx"]): float(x.get("qtd_recebida") or 0) for x in corpo.itens}
        for n, l in enumerate(itens):
            env = float(l.get("qtd_enviada") or 0)
            q = qtds.get(n, env)
            if q < 0 or q > env + 1e-6:
                raise HTTPException(422, f"Quantidade recebida de '{l.get('descricao')}' tem que estar "
                                    f"entre 0 e {env:g}.")
            l["qtd_recebida"] = q if env > 0 else 0.0
        t2 = _livro(livro.transicionar, "transferencias", tid, "em_transito", {
            "status": "recebendo", "itens": itens, "recebido_por": usuario,
            "obs_recebimento": (corpo.obs or "").strip() or None})
        if not t2:
            raise HTTPException(409, "Outra pessoa acabou de agir nesta transferência. Atualize a tela.")
        t = t2
    elif t["status"] != "recebendo":  # "recebendo" = retomada após falha (usa as qtds já gravadas)
        raise HTTPException(409, f"Transferência está '{t['status']}', não em trânsito.")

    rec = [l for l in t["itens"] if (l.get("qtd_recebida") or 0) > 0]
    if rec:
        try:
            A._gravar(str(obra), "transf_entrada",
                      A.Escrita(itens=[_item_escrita(l, l["qtd_recebida"]) for l in rec]), usuario,
                      f"trf{tid}-rcb", extra={"transferencia_id": tid, "obra_contraparte": str(t["origem"])},
                      precos={str(l["resource_id"]): l.get("preco_unit") for l in rec})
        except HTTPException as e:
            _livro(livro.atualizar, "transferencias", tid, {"erro": str(e.detail)[:500]})
            raise
    diverg = any((l.get("qtd_recebida") or 0) + 1e-6 < (l.get("qtd_enviada") or 0) for l in t["itens"])
    t = _livro(livro.atualizar, "transferencias", tid, {
        "status": "recebida_divergencia" if diverg else "recebida", "recebido_em": _agora(), "erro": None})
    return {"transferencia": t}


@router.post("/api/transferencias/{tid}/cancelar")
def transf_cancelar(tid: int, obra: str = Query(...), usuario: str = Depends(A.operador("transferencias"))):
    """Cancela uma transferência ainda não recebida: o que saiu volta para a origem."""
    t = _transf_da_obra(tid, obra, "origem")
    if t["status"] in ("em_transito", "enviando"):
        if t["status"] == "enviando":
            t = {**t, **_consolidar_envio(t, t["chave"])}
        t2 = _livro(livro.transicionar, "transferencias", tid, ("em_transito", "enviando"), {
            "status": "cancelando", "itens": t["itens"], "cancelado_por": usuario})
        if not t2:
            raise HTTPException(409, "Outra pessoa acabou de agir nesta transferência. Atualize a tela.")
        t = t2
    elif t["status"] != "cancelando":
        raise HTTPException(409, f"Transferência está '{t['status']}': não dá mais para cancelar.")
    volta = [l for l in t["itens"] if (l.get("qtd_enviada") or 0) > 0]
    if volta:
        try:
            A._gravar(str(obra), "transf_retorno",
                      A.Escrita(itens=[_item_escrita(l, l["qtd_enviada"]) for l in volta]), usuario,
                      f"trf{tid}-cnc", extra={"transferencia_id": tid, "obra_contraparte": str(t["destino"])},
                      precos={str(l["resource_id"]): l.get("preco_unit") for l in volta})
        except HTTPException as e:
            _livro(livro.atualizar, "transferencias", tid, {"erro": str(e.detail)[:500]})
            raise
    t = _livro(livro.atualizar, "transferencias", tid, {"status": "cancelada", "cancelado_em": _agora(),
                                                         "erro": None})
    return {"transferencia": t}


# ---- desmobilização (encerrar obra) -------------------------------------------
class Decisao(BaseModel):
    resource_id: str
    detail_id: int | None = None
    trademark_id: int | None = None
    descricao: str | None = None
    variante: str | None = None
    unidade: str | None = None
    quantidade: float
    destino: str               # "transferir:<obra>" | motivo de saída | "manter"


class Desmob(BaseModel):
    decisoes: list[Decisao]


@router.get("/api/desmobilizacao")
def desmob_listar(obra: str = Query(...), usuario: str = Depends(A.acesso("transferencias"))):
    """Saldo da obra por variação, com valor e sugestão de destino (obra que consome o insumo)."""
    _obra(obra)
    custo = {i["resource_id"]: i for i in A._analise(obra)["itens"]}
    consumo_outras: dict[str, list] = {}
    for pid in A.OBRAS:
        if pid == str(obra):
            continue
        try:
            for i in A._analise(pid)["itens"]:
                if (i.get("consumo_dia") or 0) > 0:
                    consumo_outras.setdefault(i["resource_id"], []).append(
                        {"obra": pid, "nome": _nome_obra(pid), "consumo_dia": i["consumo_dia"]})
        except Exception:
            continue
    linhas = []
    for r in A._estoque_inv(obra):
        q = float(r.get("quantity") or 0)
        if q <= 0:
            continue
        rid = str(r.get("resourceId"))
        info = custo.get(rid) or {}
        cu = info.get("custo_unit") or 0
        sug = sorted(consumo_outras.get(rid, []), key=lambda x: -x["consumo_dia"])
        linhas.append({
            "resource_id": rid, "detail_id": r.get("detailId"), "trademark_id": r.get("trademarkId"),
            "descricao": (r.get("resourceDescription") or info.get("descricao") or f"#{rid}").strip(),
            "variante": " / ".join(x for x in ((r.get("detailDescription") or "").strip(),
                                               (r.get("trademarkDescription") or "").strip()) if x) or None,
            "unidade": r.get("unitOfMeasure") or info.get("unidade"), "saldo": round(q, 4),
            "custo_unit": cu, "valor": round(q * cu, 2),
            "sugestao": f"transferir:{sug[0]['obra']}" if sug else None, "consumo_outras": sug[:3]})
    linhas.sort(key=lambda x: -x["valor"])
    return {"itens": linhas, "valor_total": round(sum(l["valor"] for l in linhas), 2),
            "motivos": list(A._MOTIVOS_SAIDA),
            "obras": [{"prevision_id": p, "nome": o["nome"]} for p, o in A.OBRAS.items() if p != str(obra)]}


@router.post("/api/desmobilizacao/executar")
def desmob_executar(corpo: Desmob, obra: str = Query(...),
                    idempotency_key: str | None = Header(default=None),
                    usuario: str = Depends(A.operador("transferencias"))):
    """Executa as decisões: uma transferência por obra de destino e uma saída avulsa por
    motivo. Cada grupo é independente e idempotente (repetir não duplica)."""
    _obra(obra)
    chave = A._chave_valida(idempotency_key)
    if not chave:
        raise HTTPException(422, "Idempotency-Key obrigatória.")
    grupos: dict[str, list[A.ItemEscrita]] = {}
    for d in corpo.decisoes:
        if d.destino == "manter" or d.quantidade <= 0:
            continue
        if not (d.destino.startswith("transferir:") or d.destino in A._MOTIVOS_SAIDA):
            raise HTTPException(422, f"Destino inválido: {d.destino}")
        grupos.setdefault(d.destino, []).append(A.ItemEscrita(
            resource_id=d.resource_id, quantidade=d.quantidade, unidade=d.unidade, descricao=d.descricao,
            detail_id=d.detail_id, trademark_id=d.trademark_id, variante=d.variante))
    if not grupos:
        raise HTTPException(422, "Nenhuma decisão para executar.")
    resultados = []
    for n, (dest, itens) in enumerate(sorted(grupos.items())):
        sub = f"{chave}-g{n}"
        try:
            if dest.startswith("transferir:"):
                pid = dest.split(":", 1)[1]
                r = _criar_transferencia(obra, pid, itens, "Desmobilização da obra", usuario, sub)
                resultados.append({"grupo": dest, "ok": True, "n_itens": len(itens),
                                   "mensagem": f"Transferência #{r['transferencia']['id']} para "
                                               f"{_nome_obra(pid)} (em trânsito)"})
            else:
                A._gravar(obra, "saida", A.Escrita(itens=itens, motivo=dest), usuario, sub)
                resultados.append({"grupo": dest, "ok": True, "n_itens": len(itens),
                                   "mensagem": f"Saída avulsa ({dest}) registrada"})
        except HTTPException as e:
            resultados.append({"grupo": dest, "ok": False, "n_itens": len(itens), "mensagem": str(e.detail)})
    return {"resultados": resultados, "ok": all(r["ok"] for r in resultados)}


# ============================================================== 10 · requisição com reserva
_ST_RESERVA = ("aprovada", "separada", "parcial", "entregando")
_ST_REQ_ABERTAS = ("solicitada",) + _ST_RESERVA


class ReqItem(BaseModel):
    resource_id: str
    quantidade: float
    unidade: str | None = None
    descricao: str | None = None
    detail_id: int | None = None
    trademark_id: int | None = None
    variante: str | None = None


class ReqNova(BaseModel):
    itens: list[ReqItem]
    eap: A.EapRef | None = None
    terceiro: str | None = None
    solicitante: str | None = None
    necessario_em: str | None = None
    obs: str | None = None


class ReqAcao(BaseModel):
    acao: Literal["aprovar", "reprovar", "separar", "entregar", "cancelar"]
    obs: str | None = None
    entregas: list[dict] | None = None   # [{idx, quantidade}] (entregar)


def reservas(obra: str) -> dict[tuple, float]:
    """(insumo, detalhe, marca) -> quantidade reservada por requisições aprovadas não entregues."""
    out: dict[tuple, float] = {}
    for r in livro.listar("requisicoes", obra=str(obra), status=_ST_RESERVA, limite=1000):
        for l in r.get("itens") or []:
            falta = float(l.get("quantidade") or 0) - float(l.get("qtd_entregue") or 0)
            if falta > 0:
                k = _sig(l["resource_id"], l.get("detail_id"), l.get("trademark_id"))
                out[k] = out.get(k, 0.0) + falta
    return out


def reservas_por_insumo(obra: str) -> dict[str, float]:
    """Mesma coisa somada por insumo. Falha de banco (ex.: migração não rodada) = sem reservas."""
    try:
        res = reservas(obra)
    except Exception:
        return {}
    out: dict[str, float] = {}
    for (rid, _, _), q in res.items():
        out[rid] = out.get(rid, 0.0) + q
    return out


@router.get("/api/estoque/reservas")
def estoque_reservas(obra: str = Query(...),
                     usuario: str = Depends(A.acesso("requisicao", "operar", "estoque"))):
    _obra(obra)
    res = _livro(reservas, obra)
    return {"reservas": [{"resource_id": k[0], "detail_id": k[1], "trademark_id": k[2],
                          "quantidade": round(q, 4)} for k, q in res.items()]}


@router.get("/api/requisicoes")
def req_listar(obra: str = Query(...), abertas: bool = True,
               usuario: str = Depends(A.acesso("requisicao"))):
    _obra(obra)
    rs = _livro(livro.listar, "requisicoes", obra=str(obra),
                status=_ST_REQ_ABERTAS if abertas else None, limite=200)
    return {"requisicoes": rs, "papel": _papel(usuario)}


@router.post("/api/requisicoes")
def req_criar(corpo: ReqNova, obra: str = Query(...), usuario: str = Depends(A.acesso("requisicao"))):
    """Pedido de material da obra: nasce 'solicitada'; reserva o saldo quando aprovado."""
    _obra(obra)
    if not corpo.itens or any(i.quantidade <= 0 for i in corpo.itens):
        raise HTTPException(422, "Informe os itens e quantidades.")
    if _eap_folhas(obra) and not corpo.eap:
        raise HTTPException(422, "Informe a subetapa (EAP) em que o material vai ser aplicado.")
    eap = corpo.eap
    r = _livro(livro.inserir, "requisicoes", {
        "obra": str(obra), "criado_por": usuario, "status": "solicitada",
        "solicitante": (corpo.solicitante or "").strip() or None,
        "terceiro": (corpo.terceiro or "").strip() or None,
        "eap_uc_id": eap.uc_id if eap else None, "eap_codigo": eap.codigo if eap else None,
        "eap_descricao": eap.descricao if eap else None,
        "necessario_em": corpo.necessario_em or None, "obs": (corpo.obs or "").strip() or None,
        "itens": [{**i.model_dump(), "qtd_entregue": 0.0} for i in corpo.itens]})
    return {"requisicao": r}


def _entregar(r: dict, obra: str, usuario: str, corpo: ReqAcao) -> dict:
    rid = r["id"]
    if r["status"] == "entregando":        # retomada após falha: usa a entrega já registrada
        pend = r.get("entrega_pendente") or {}
    else:
        if r["status"] not in ("aprovada", "separada", "parcial"):
            raise HTTPException(409, f"Requisição está '{r['status']}': não dá para entregar.")
        qs = {int(e["idx"]): float(e.get("quantidade") or 0) for e in (corpo.entregas or [])}
        if not any(q > 0 for q in qs.values()):
            raise HTTPException(422, "Informe as quantidades entregues.")
        for n, q in qs.items():
            if n < 0 or n >= len(r["itens"]):
                raise HTTPException(422, "Item inválido.")
            l = r["itens"][n]
            falta = float(l["quantidade"]) - float(l.get("qtd_entregue") or 0)
            if q < 0 or q > falta + 1e-6:
                raise HTTPException(422, f"'{l.get('descricao')}': entregar entre 0 e {falta:g}.")
        pend = {"n": int(r.get("n_entregas") or 0) + 1, "de": r["status"],
                "itens": [{"idx": n, "quantidade": q} for n, q in sorted(qs.items()) if q > 0]}
        r2 = _livro(livro.transicionar, "requisicoes", rid, r["status"], {
            "status": "entregando", "entrega_pendente": pend, "n_entregas": pend["n"]})
        if not r2:
            raise HTTPException(409, "Outra pessoa acabou de agir nesta requisição. Atualize a tela.")
        r = r2
    itens = [_item_escrita(r["itens"][e["idx"]], e["quantidade"]) for e in pend["itens"]]
    eap = A.EapRef(uc_id=r.get("eap_uc_id"), codigo=r["eap_codigo"], descricao=r.get("eap_descricao")) \
        if r.get("eap_codigo") else None
    corpo_b = A.Escrita(itens=itens, terceiro=r.get("terceiro") or r.get("solicitante") or r["criado_por"],
                        solicitante=r.get("solicitante") or r["criado_por"], eap=eap)
    try:
        resp = A._gravar(str(obra), "baixa", corpo_b, usuario, f"req{rid}-e{pend['n']}",
                         extra={"requisicao_id": rid})
    except HTTPException as e:
        if e.status_code == 422:   # o Sienge recusou a baixa inteira: nada saiu, volta ao estado anterior
            _livro(livro.transicionar, "requisicoes", rid, "entregando", {
                "status": pend["de"], "entrega_pendente": None, "n_entregas": pend["n"] - 1,
                "erro": str(e.detail)[:500]})
        else:                      # sem confirmação: fica "entregando" para conferir e retomar
            _livro(livro.atualizar, "requisicoes", rid, {"erro": str(e.detail)[:500]})
        raise
    itens_r = r["itens"]
    for e in pend["itens"]:
        itens_r[e["idx"]]["qtd_entregue"] = float(itens_r[e["idx"]].get("qtd_entregue") or 0) + e["quantidade"]
    completa = all(float(l.get("qtd_entregue") or 0) + 1e-6 >= float(l["quantidade"]) for l in itens_r)
    r = _livro(livro.atualizar, "requisicoes", rid, {
        "status": "entregue" if completa else "parcial", "itens": itens_r, "entrega_pendente": None,
        "entregue_por": usuario, "entregue_em": _agora(), "erro": None})
    return {"requisicao": r, "baixa": resp}


@router.post("/api/requisicoes/{rid}/acao")
def req_acao(rid: int, corpo: ReqAcao, obra: str = Query(...),
             usuario: str = Depends(A.acesso("requisicao"))):
    r = _livro(livro.obter, "requisicoes", rid)
    if not r or str(r["obra"]) != str(obra):
        raise HTTPException(404, "Requisição não encontrada nesta obra.")
    papel, obs = _papel(usuario), (corpo.obs or "").strip() or None
    a = corpo.acao
    if a in ("aprovar", "reprovar"):
        if papel not in ("engenheiro", "admin"):
            raise HTTPException(403, "Quem aprova a requisição é o engenheiro da obra.")
        if a == "reprovar" and not obs:
            raise HTTPException(422, "Informe o motivo.")
        patch = {"status": "aprovada" if a == "aprovar" else "reprovada", "aprovado_por": usuario,
                 "aprovado_em": _agora(), "aprov_obs": obs}
        r2 = _livro(livro.transicionar, "requisicoes", rid, "solicitada", patch)
    elif a == "separar":
        A._exigir_operar(usuario)
        r2 = _livro(livro.transicionar, "requisicoes", rid, "aprovada",
                    {"status": "separada", "separado_por": usuario, "separado_em": _agora()})
    elif a == "entregar":
        A._exigir_operar(usuario)
        return _entregar(r, obra, usuario, corpo)
    else:  # cancelar
        if r["criado_por"] != usuario and papel not in ("engenheiro", "admin"):
            raise HTTPException(403, "Só quem pediu ou o engenheiro cancela a requisição.")
        r2 = _livro(livro.transicionar, "requisicoes", rid, ("solicitada", "aprovada", "separada", "parcial"),
                    {"status": "cancelada", "cancelado_por": usuario, "cancelado_em": _agora(), "motivo": obs})
    if not r2:
        raise HTTPException(409, f"A requisição está '{r['status']}': esta ação não se aplica. Atualize a tela.")
    return {"requisicao": r2}


# ============================================================== 10 · inventário cíclico
PERIODICIDADE = {"A": 30, "B": 90, "C": 180}   # dias entre contagens por classe
TOL_VALOR = 200.0                              # acima disso (R$) o ajuste precisa de admin
TOL_PCT = 10.0                                 # ... ou acima deste % do saldo do sistema
_ST_CONTAGEM_FEITA = ("contada", "ajustando", "ajustada", "conferida", "encerrada")


class NovaContagem(BaseModel):
    classe: Literal["A", "B", "C"] | None = None
    resource_ids: list[str] | None = None
    max_itens: int = 30


class EnvioContagem(BaseModel):
    contagens: list[dict]        # [{idx, qtd}]
    obs: str | None = None


class AjusteContagem(BaseModel):
    motivo: str
    idxs: list[int] | None = None   # None = todos os divergentes


def _abc(obra: str) -> list[dict]:
    return A.curva_abc(obra=obra, janela_dias=90, usuario="")["itens"]


def _ultimas_contagens(obra: str) -> dict[str, str]:
    ult: dict[str, str] = {}
    for c in livro.listar("contagens", obra=str(obra), status=_ST_CONTAGEM_FEITA, limite=1000):
        quando = str(c.get("contado_em") or c.get("criado_em"))[:10]
        for l in c.get("itens") or []:
            if l.get("qtd_contada") is not None and quando > ult.get(str(l["resource_id"]), ""):
                ult[str(l["resource_id"])] = quando
    return ult


def _plano(obra: str) -> list[dict]:
    ult = _livro(_ultimas_contagens, obra)
    hoje = date.today()
    out = []
    for i in _abc(obra):
        if i["abc"] not in PERIODICIDADE:
            continue
        u = ult.get(i["resource_id"])
        prox = (date.fromisoformat(u) + timedelta(days=PERIODICIDADE[i["abc"]])) if u else hoje
        out.append({"resource_id": i["resource_id"], "descricao": i["descricao"], "unidade": i["unidade"],
                    "abc": i["abc"], "valor_saldo": i["valor_saldo"], "custo_unit": i["custo_unit"],
                    "ultima_contagem": u, "proxima": prox.isoformat(),
                    "dias_atraso": (hoje - prox).days, "vencido": prox <= hoje})
    out.sort(key=lambda x: ("ABC".index(x["abc"]), -x["dias_atraso"], -x["valor_saldo"]))
    return out


@router.get("/api/inventario/plano")
def inv_plano(obra: str = Query(...), usuario: str = Depends(A.acesso("inventario"))):
    """Plano de contagem cíclica por classe ABC (A mensal, B trimestral, C semestral)."""
    _obra(obra)
    itens = _plano(obra)
    resumo = {c: {"n_itens": sum(i["abc"] == c for i in itens),
                  "n_vencidos": sum(i["abc"] == c and i["vencido"] for i in itens),
                  "n_nunca": sum(i["abc"] == c and not i["ultima_contagem"] for i in itens),
                  "periodicidade_dias": d} for c, d in PERIODICIDADE.items()}
    # acuracidade: itens contados nos últimos 90 dias sem divergência acima da tolerância
    desde = (date.today() - timedelta(days=90)).isoformat()
    n = ok = 0
    for c in _livro(livro.listar, "contagens", obra=str(obra), status=_ST_CONTAGEM_FEITA, limite=500):
        if str(c.get("contado_em") or "")[:10] < desde:
            continue
        for l in c.get("itens") or []:
            if l.get("divergencia") is None:
                continue
            n += 1
            ok += not l.get("precisa_aprovacao") and abs(l.get("divergencia") or 0) < 1e-9
    return {"hoje": date.today().isoformat(), "resumo": resumo, "itens": itens,
            "acuracidade": {"n_itens": n, "pct_exatos": round(ok / n * 100, 1) if n else None},
            "tolerancia": {"valor": TOL_VALOR, "pct": TOL_PCT}}


def _publica(c: dict) -> dict:
    """Contagem cega: enquanto está aberta, o saldo do sistema não sai do servidor."""
    if c and c.get("status") == "aberta":
        c = {**c, "itens": [{k: v for k, v in l.items() if k not in ("saldo_sistema", "divergencia",
                                                                      "valor_divergencia")}
                            for l in c.get("itens") or []]}
    return c


@router.get("/api/inventario/contagens")
def inv_listar(obra: str = Query(...), usuario: str = Depends(A.acesso("inventario"))):
    _obra(obra)
    cs = _livro(livro.listar, "contagens", obra=str(obra), limite=100)
    return {"contagens": [_publica(c) for c in cs], "papel": _papel(usuario)}


@router.post("/api/inventario/contagens")
def inv_criar(corpo: NovaContagem, obra: str = Query(...), usuario: str = Depends(A.operador("inventario"))):
    """Gera uma contagem com os itens vencidos (ou os escolhidos), uma linha por variação."""
    _obra(obra)
    plano = _plano(obra)
    if corpo.resource_ids:
        alvo = [p for p in plano if p["resource_id"] in set(map(str, corpo.resource_ids))]
    else:
        alvo = [p for p in plano if p["vencido"] and (not corpo.classe or p["abc"] == corpo.classe)]
    alvo = alvo[:max(1, min(corpo.max_itens, 200))]
    if not alvo:
        raise HTTPException(422, "Nenhum item a contar com esse filtro.")
    inv: dict[str, list] = {}
    for r in A._estoque_inv(obra):
        if float(r.get("quantity") or 0) != 0:
            inv.setdefault(str(r.get("resourceId")), []).append(r)
    linhas = []
    for p in alvo:
        vs = inv.get(p["resource_id"]) or [{}]
        for r in vs:
            linhas.append({
                "resource_id": p["resource_id"], "detail_id": r.get("detailId"),
                "trademark_id": r.get("trademarkId"), "descricao": p["descricao"],
                "variante": " / ".join(x for x in ((r.get("detailDescription") or "").strip(),
                                                   (r.get("trademarkDescription") or "").strip()) if x) or None,
                "unidade": r.get("unitOfMeasure") or p["unidade"], "abc": p["abc"],
                "custo_unit": p["custo_unit"], "qtd_contada": None})
    c = _livro(livro.inserir, "contagens", {"obra": str(obra), "criado_por": usuario, "status": "aberta",
                                            "classe": corpo.classe, "itens": linhas})
    return {"contagem": _publica(c)}


@router.post("/api/inventario/contagens/{cid}/enviar")
def inv_enviar(cid: int, corpo: EnvioContagem, obra: str = Query(...),
               usuario: str = Depends(A.operador("inventario"))):
    """Recebe a contagem cega e só então compara com o saldo do Sienge (lido na hora)."""
    c = _livro(livro.obter, "contagens", cid)
    if not c or str(c["obra"]) != str(obra):
        raise HTTPException(404, "Contagem não encontrada nesta obra.")
    if c["status"] != "aberta":
        raise HTTPException(409, "Esta contagem já foi enviada.")
    qs = {int(x["idx"]): x.get("qtd") for x in corpo.contagens}
    itens = c["itens"]
    for n, l in enumerate(itens):
        q = qs.get(n)
        if q is None or float(q) < 0:
            raise HTTPException(422, f"Falta a quantidade contada de '{l['descricao']}'"
                                f"{' · ' + l['variante'] if l.get('variante') else ''}.")
        l["qtd_contada"] = float(q)
    sis: dict[tuple, float] = {}
    for r in A._estoque_inv(obra, force=True):   # saldo oficial NESTE momento
        k = _sig(r.get("resourceId"), r.get("detailId"), r.get("trademarkId"))
        sis[k] = sis.get(k, 0.0) + float(r.get("quantity") or 0)
    tem_div = False
    for l in itens:
        s = sis.get(_sig(l["resource_id"], l.get("detail_id"), l.get("trademark_id")), 0.0)
        div = round(l["qtd_contada"] - s, 4)
        val = round(div * float(l.get("custo_unit") or 0), 2)
        l.update(saldo_sistema=round(s, 4), divergencia=div, valor_divergencia=val,
                 precisa_aprovacao=abs(val) > TOL_VALOR or (abs(div) > abs(s) * TOL_PCT / 100 and abs(div) > 1e-9))
        tem_div = tem_div or abs(div) > 1e-9
    c2 = _livro(livro.transicionar, "contagens", cid, "aberta", {
        "status": "contada" if tem_div else "conferida", "itens": itens, "contado_por": usuario,
        "contado_em": _agora(), "obs": (corpo.obs or "").strip() or None})
    if not c2:
        raise HTTPException(409, "Esta contagem já foi enviada.")
    return {"contagem": c2}


@router.post("/api/inventario/contagens/{cid}/ajustar")
def inv_ajustar(cid: int, corpo: AjusteContagem, obra: str = Query(...),
                usuario: str = Depends(A.operador("inventario"))):
    """Ajusta o Sienge pela contagem: sobra = entrada avulsa, falta = saída avulsa, com motivo.
    Divergência acima da tolerância só com administrador."""
    c = _livro(livro.obter, "contagens", cid)
    if not c or str(c["obra"]) != str(obra):
        raise HTTPException(404, "Contagem não encontrada nesta obra.")
    motivo = (corpo.motivo or "").strip()
    if not motivo:
        raise HTTPException(422, "Informe o motivo do ajuste.")
    itens = c["itens"]
    if c["status"] == "contada":
        sel = set(corpo.idxs) if corpo.idxs is not None else \
            {n for n, l in enumerate(itens) if abs(l.get("divergencia") or 0) > 1e-9}
        sel = {n for n in sel if 0 <= n < len(itens) and abs(itens[n].get("divergencia") or 0) > 1e-9}
        if not sel:
            raise HTTPException(422, "Nenhum item divergente selecionado.")
        if any(itens[n].get("precisa_aprovacao") for n in sel) and _papel(usuario) != "admin":
            raise HTTPException(403, "Há divergência acima da tolerância "
                                f"(R$ {TOL_VALOR:.0f} ou {TOL_PCT:.0f}% do saldo): o ajuste precisa de um administrador.")
        for n, l in enumerate(itens):
            l["ajustar"] = n in sel
        c2 = _livro(livro.transicionar, "contagens", cid, "contada", {
            "status": "ajustando", "itens": itens, "ajustado_por": usuario, "motivo": motivo})
        if not c2:
            raise HTTPException(409, "A contagem mudou de estado. Atualize a tela.")
        c = c2
    elif c["status"] != "ajustando":   # "ajustando" = retomada após falha
        raise HTTPException(409, f"Contagem está '{c['status']}': não há ajuste a fazer.")
    motivo = c.get("motivo") or motivo
    mais = [l for l in c["itens"] if l.get("ajustar") and l["divergencia"] > 0]
    menos = [l for l in c["itens"] if l.get("ajustar") and l["divergencia"] < 0]
    extra = {"contagem_id": cid}
    try:
        if mais:
            A._gravar(str(obra), "ajuste_mais", A.Escrita(
                itens=[_item_escrita(l, l["divergencia"]) for l in mais], motivo=motivo),
                usuario, f"inv{cid}-mais", extra=extra)
        if menos:
            A._gravar(str(obra), "ajuste_menos", A.Escrita(
                itens=[_item_escrita(l, -l["divergencia"]) for l in menos], motivo=motivo),
                usuario, f"inv{cid}-menos", extra=extra)
    except HTTPException as e:
        _livro(livro.atualizar, "contagens", cid, {"erro": str(e.detail)[:500]})
        raise
    c = _livro(livro.atualizar, "contagens", cid, {"status": "ajustada", "ajustado_em": _agora(), "erro": None})
    return {"contagem": c}


@router.post("/api/inventario/contagens/{cid}/encerrar")
def inv_encerrar(cid: int, obra: str = Query(...), usuario: str = Depends(A.operador("inventario"))):
    """Fecha a contagem sem ajustar o Sienge (ex.: divergência explicada por lançamento pendente)."""
    c = _livro(livro.obter, "contagens", cid)
    if not c or str(c["obra"]) != str(obra):
        raise HTTPException(404, "Contagem não encontrada nesta obra.")
    c2 = _livro(livro.transicionar, "contagens", cid, ("aberta", "contada"), {"status": "encerrada"})
    if not c2:
        raise HTTPException(409, f"Contagem está '{c['status']}'.")
    return {"contagem": _publica(c2)}
