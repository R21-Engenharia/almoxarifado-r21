"""API do Almoxarifado R21 — backend independente.

Fonte única = Sienge. Motores calculam; a IA não entra aqui. Escrita no ERP com
freio (confirmação no front, auditoria de tudo). Roda em modo DEMO se as
credenciais do Sienge não estiverem no ambiente.
"""
from __future__ import annotations
import os
from datetime import date


def _carregar_env():
    """Carrega backend/.env para o ambiente (sem dependência externa)."""
    caminho = os.path.join(os.path.dirname(__file__), ".env")
    if not os.path.exists(caminho):
        return
    with open(caminho, encoding="utf-8") as f:
        for linha in f:
            linha = linha.strip()
            if not linha or linha.startswith("#") or "=" not in linha:
                continue
            chave, _, valor = linha.partition("=")
            chave, valor = chave.strip(), valor.strip().strip('"').strip("'")
            if chave and valor and chave not in os.environ:
                os.environ[chave] = valor


_carregar_env()

from fastapi import FastAPI, HTTPException, Header, Query, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from pydantic import BaseModel

import sienge
import supa
import demo_data
import engine
import audit
import grupos_sienge
from obras import OBRAS, obra_ou_erro

app = FastAPI(title="Almoxarifado R21 API")
# CORS: em produção restringe à origem do front (env ALMOX_CORS_ORIGINS, separado por vírgula)
_origins = [o.strip() for o in os.environ.get("ALMOX_CORS_ORIGINS", "*").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware, allow_origins=_origins, allow_methods=["*"], allow_headers=["*"],
)
# comprime as respostas (JSON grande do catálogo/estoque cai ~8-10x) — leve no 4G do galpão
app.add_middleware(GZipMiddleware, minimum_size=800)

audit.init_db()


# ---------------------------------------------------------------- autenticação
def _auth_ativo() -> bool:
    return supa.configurado()


def usuario_logado(authorization: str | None = Header(default=None)) -> str:
    """Valida o token Supabase e devolve o e-mail. Em dev (sem Supabase) libera."""
    if not _auth_ativo():
        return os.environ.get("ALMOX_DEFAULT_USER", "almoxarife@r21")
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Não autenticado. Entre novamente.")
    token = authorization.split(" ", 1)[1]
    try:
        email = supa.email_do_token(token)
    except supa.AuthError as e:
        raise HTTPException(e.status, e.msg)
    if supa.role_do_email(email) is None:
        raise HTTPException(403, "E-mail não autorizado a usar o app.")
    return email


def usuario_admin(authorization: str | None = Header(default=None)) -> str:
    """Idem, mas exige role 'admin' (para escrita no ERP)."""
    email = usuario_logado(authorization)
    if _auth_ativo() and (supa.role_do_email(email) or "").strip().lower() != "admin":
        raise HTTPException(403, "Ação restrita a administradores.")
    return email


def usuario_gestor(authorization: str | None = Header(default=None)) -> str:
    """Exige permissão de gerenciar usuários (flag gerenciar_usuarios ou role admin)."""
    email = usuario_logado(authorization)
    if not _auth_ativo():
        return email  # dev local
    p = supa.perms_do_email(email) or {}
    if not (p.get("gerenciar_usuarios") or (p.get("role") or "").lower() == "admin"):
        raise HTTPException(403, "Você não tem permissão para gerenciar usuários.")
    return email

import json
from datetime import datetime

# ---- cache de movimentos (memória + disco) e de análise -----------------------
# O histórico do Sienge tem dezenas de milhares de linhas e leva ~1 min para baixar.
# Por isso: 1) persiste em disco (acesso instantâneo entre reinícios); 2) após gravar
# só ANEXA o movimento (não re-baixa tudo); 3) guarda o resultado do motor por obra.
_MOVS_CACHE: dict[str, list[dict]] = {}
_ANALISE_CACHE: dict[str, dict] = {}   # obra -> {"janela": int, "resultado": dict}
_SHEET_BLOQUEADOS: set = set()          # itens de orçamento bloqueados p/ apropriação
_DATA_DIR = os.path.join(os.path.dirname(__file__), "data")


def _modo_demo() -> bool:
    return not sienge.configurado()


def _snap_path(prevision_id: str) -> str:
    return os.path.join(_DATA_DIR, f"snap_{prevision_id}.json")


def _salvar_snapshot(prevision_id: str):
    if _modo_demo():
        return
    try:
        os.makedirs(_DATA_DIR, exist_ok=True)
        with open(_snap_path(prevision_id), "w", encoding="utf-8") as f:
            json.dump({"coletado_em": datetime.now().isoformat(),
                       "movs": _MOVS_CACHE.get(prevision_id, [])}, f, ensure_ascii=False)
    except Exception:
        pass  # Drive pode falhar em escrita; não é fatal


def _carregar_snapshot(prevision_id: str):
    try:
        with open(_snap_path(prevision_id), encoding="utf-8") as f:
            return json.load(f).get("movs")
    except Exception:
        return None


def snapshot_info(prevision_id: str) -> str | None:
    try:
        with open(_snap_path(prevision_id), encoding="utf-8") as f:
            return json.load(f).get("coletado_em")
    except Exception:
        return None


def _movimentos(prevision_id: str, force: bool = False) -> list[dict]:
    if not force and prevision_id in _MOVS_CACHE:
        return _MOVS_CACHE[prevision_id]
    if _modo_demo():
        _MOVS_CACHE[prevision_id] = demo_data.coletar_movimentos_demo(prevision_id)
        return _MOVS_CACHE[prevision_id]
    if not force:
        snap = _carregar_snapshot(prevision_id)
        if snap is not None:
            _MOVS_CACHE[prevision_id] = snap
            return snap
    # baixada completa do Sienge (lenta) — só quando não há snapshot ou force=True
    o = obra_ou_erro(prevision_id)
    _MOVS_CACHE[prevision_id] = sienge.coletar_movimentos(o["building_id"])
    _salvar_snapshot(prevision_id)
    _invalidar_obra(prevision_id)
    return _MOVS_CACHE[prevision_id]


def _enriquecer_classificacao(itens: list[dict]):
    """Substitui a classificação por palavra-chave pela REAL do Sienge:
    família + grupo reais, e a MACROFAMÍLIA derivada do nome da família (confiável).
    Assim o insumo não 'some' num macro errado. Sem mapa -> mantém o fallback."""
    import taxonomia
    for i in itens:
        familia, grupo, cat = grupos_sienge.grupo_de(i["resource_id"])
        i["familia"] = familia
        i["grupo_sienge"] = grupo
        i["categoria"] = cat
        # macrofamília derivada da família real; sem família -> "Outros" (taxonomia única)
        i["macro"] = taxonomia.macrofamilia_de(familia) if familia else "Outros"


def _analise(prevision_id: str, janela_dias: int = 90) -> dict:
    c = _ANALISE_CACHE.get(prevision_id)
    if c and c["janela"] == janela_dias:
        return c["resultado"]
    res = engine.analisar(_movimentos(prevision_id), hoje=date.today(),
                          janela_dias=janela_dias)
    _enriquecer_classificacao(res["itens"])  # itens de alertas/parados são os mesmos objetos
    _ANALISE_CACHE[prevision_id] = {"janela": janela_dias, "resultado": res}
    return res


def _anexar_local(prevision_id: str, operacao: str, corpo, tipo_id: int):
    """Após gravar no Sienge, anexa o movimento ao cache (evita re-baixar tudo).
    Reflete o saldo imediatamente; os valores reais chegam no próximo 'atualizar'."""
    if prevision_id not in _MOVS_CACHE:
        _movimentos(prevision_id)
    movs = _MOVS_CACHE[prevision_id]
    io = "OUTPUT" if operacao in ("baixa",) or tipo_id in (2, 10) else "INPUT"
    tipo_desc = "Consumo" if tipo_id == 2 else (
        "Inicialização - Entrada Avulsa" if tipo_id == 9 else "Inicialização - Saída Avulsa")
    for i in corpo.itens:
        movs.append({
            "id": f"local-{len(movs)}", "resourceId": i.resource_id,
            "resourceDescription": i.descricao or "", "inputOutput": io,
            "movementTypeId": tipo_id, "movementTypeDescription": tipo_desc,
            "movementQuantity": i.quantidade, "movementValue": 0,
            "movementDate": date.today().isoformat(),
            "baseUnitOfMeasureSymbol": i.unidade or "", "unitOfMeasureSymbol": i.unidade or "",
            "supplierName": None,
        })
    _salvar_snapshot(prevision_id)
    _invalidar_obra(prevision_id)


# ---------------------------------------------------------------- leitura

@app.get("/api/health")
def health():
    # público (não exige login) — usado para status e para o front saber o modo
    return {"ok": True, "modo": "demo" if _modo_demo() else "sienge",
            "auth": _auth_ativo(), "obras": list(OBRAS.keys())}


@app.post("/api/estoque/atualizar")
def atualizar(obra: str = Query(...), usuario: str = Depends(usuario_logado)):
    """Re-baixa o histórico completo do Sienge (lento). Use quando quiser puxar
    movimentos feitos por fora do app."""
    obra_ou_erro(obra)
    _movimentos(obra, force=True)
    return {"ok": True, "coletado_em": snapshot_info(obra)}


@app.get("/api/obras")
def listar_obras(usuario: str = Depends(usuario_logado)):
    demo = _modo_demo()
    return [
        {"prevision_id": pid,
         "nome": (o["nome"] + " (DEMO)") if demo else o["nome"]}
        for pid, o in OBRAS.items()
    ]


# ---------------------------------------------------------------- usuários / permissões
_MODULOS = ["financeiro", "posicao", "recebimentos", "consumo", "suprimentos", "fornecedores",
            "equipamentos", "aprovacao", "requisicao", "estoque", "operar", "historico"]


def _perfil_norm(row: dict | None, email: str) -> dict:
    """Normaliza a linha de authorized_emails no shape de permissões do app."""
    row = row or {}
    return {
        "email": email, "nome": row.get("nome"), "cargo": row.get("cargo"),
        "tipo": row.get("tipo") or "Geral", "ativo": row.get("ativo", True),
        "role": (row.get("role") or "user"),
        "modulos": row.get("modulos") or [],          # [] = todos
        "obras": row.get("obras") or [],              # [] = todas
        "gerenciar_usuarios": bool(row.get("gerenciar_usuarios") or (row.get("role") or "").lower() == "admin"),
        "operar": bool(row.get("operar")),
        "gerar_plano": bool(row.get("gerar_plano")),
    }


@app.get("/api/eu")
def eu(usuario: str = Depends(usuario_logado)):
    """Perfil + permissões do usuário logado (para o app filtrar menu e ações)."""
    if not _auth_ativo():
        return {"email": usuario, "nome": usuario, "tipo": "Geral", "ativo": True, "role": "admin",
                "modulos": [], "obras": [], "gerenciar_usuarios": True, "operar": True, "gerar_plano": True}
    return _perfil_norm(supa.perms_do_email(usuario), usuario)


@app.get("/api/usuarios")
def usuarios_listar(usuario: str = Depends(usuario_gestor)):
    if not _auth_ativo():
        return {"usuarios": [], "modulos": _MODULOS}
    linhas = [_perfil_norm(r, r.get("email")) for r in supa.listar_usuarios()]
    return {"usuarios": linhas, "modulos": _MODULOS}


class UsuarioIn(BaseModel):
    email: str
    nome: str | None = None
    cargo: str | None = None
    tipo: str | None = "Geral"
    ativo: bool = True
    role: str | None = "user"
    modulos: list[str] = []
    obras: list[str] = []
    gerenciar_usuarios: bool = False
    operar: bool = False
    gerar_plano: bool = False


@app.post("/api/usuarios")
def usuarios_salvar(corpo: UsuarioIn, usuario: str = Depends(usuario_gestor)):
    email = (corpo.email or "").strip().lower()
    if not email or "@" not in email:
        raise HTTPException(422, "E-mail inválido.")
    dados = corpo.model_dump()
    dados["email"] = email
    dados["modulos"] = [m for m in corpo.modulos if m in _MODULOS]
    try:
        salvo = supa.upsert_usuario(dados)
    except supa.AuthError as e:
        raise HTTPException(e.status if getattr(e, "status", 0) else 422, e.msg)
    return _perfil_norm(salvo, email)


@app.get("/api/estoque/material")
def material(obra: str = Query(...), janela_dias: int = 90,
             usuario: str = Depends(usuario_logado)):
    obra_ou_erro(obra)
    res = _analise(obra, janela_dias)
    # a tela de Estoque só usa kpis + alertas + parados; a lista completa (1500+ itens)
    # vai pelo /catalogo quando é preciso — não trafega ~1MB à toa aqui.
    return {**res, "itens": []}


# cache de RESULTADO dos motores (evita reprocessar 13k+ movimentos a cada abertura).
# Chave inclui a data => expira sozinho a cada dia; some quando os dados são atualizados.
_ENGINE_CACHE: dict = {}


def _memo(obra: str, tag: str, fn):
    key = (obra, f"{tag}:{date.today().isoformat()}")
    if key in _ENGINE_CACHE:
        return _ENGINE_CACHE[key]
    r = fn()
    _ENGINE_CACHE[key] = r
    return r


def _invalidar_obra(prevision_id: str):
    _ANALISE_CACHE.pop(prevision_id, None)
    for k in [k for k in _ENGINE_CACHE if k[0] == prevision_id]:
        _ENGINE_CACHE.pop(k, None)


@app.get("/api/estoque/financeiro")
def financeiro(obra: str = Query(...), meses: int = 12,
               usuario: str = Depends(usuario_logado)):
    obra_ou_erro(obra)
    return _memo(obra, f"financeiro:{meses}", lambda: engine.financeiro(_movimentos(obra), hoje=date.today(), meses=meses))


@app.get("/api/estoque/consumo")
def consumo(obra: str = Query(...), meses: int = 12,
            usuario: str = Depends(usuario_logado)):
    obra_ou_erro(obra)
    return _memo(obra, f"consumo:{meses}", lambda: engine.consumo(_movimentos(obra), hoje=date.today(), meses=meses))


# ---- compras (purchase-orders) --------------------------------------------
_PEDIDOS_CACHE: dict[str, list[dict]] = {}
_COLETA_PEDIDOS = {"rodando": False}


def _pedidos(prevision_id: str, force: bool = False) -> list[dict]:
    if not force and prevision_id in _PEDIDOS_CACHE:
        return _PEDIDOS_CACHE[prevision_id]
    p = os.path.join(_DATA_DIR, f"pedidos_{prevision_id}.json")
    if not force and os.path.exists(p):
        try:
            _PEDIDOS_CACHE[prevision_id] = json.load(open(p, encoding="utf-8"))
            return _PEDIDOS_CACHE[prevision_id]
        except Exception:
            pass
    if _modo_demo():
        _PEDIDOS_CACHE[prevision_id] = []
        return []
    o = obra_ou_erro(prevision_id)
    _PEDIDOS_CACHE[prevision_id] = sienge.coletar_pedidos(o["building_id"])
    _invalidar_obra(prevision_id)   # fornecedores/recebimentos/suprimentos dependem dos pedidos
    try:
        os.makedirs(_DATA_DIR, exist_ok=True)
        json.dump(_PEDIDOS_CACHE[prevision_id], open(p, "w", encoding="utf-8"), ensure_ascii=False)
    except Exception:
        pass
    return _PEDIDOS_CACHE[prevision_id]


def _nomes_fornecedores(prevision_id: str) -> dict[str, str]:
    nomes: dict[str, str] = {}
    for m in _movimentos(prevision_id):
        sid, nm = m.get("supplierId"), m.get("supplierName")
        if sid and nm:
            nomes[str(sid)] = nm
    return nomes


@app.get("/api/estoque/fornecedores")
def fornecedores(obra: str = Query(...), meses: int = 12,
                 usuario: str = Depends(usuario_logado)):
    obra_ou_erro(obra)
    return _memo(obra, f"fornecedores:{meses}", lambda: engine.fornecedores(
        _pedidos(obra), _nomes_fornecedores(obra), hoje=date.today(), meses=meses))


@app.get("/api/estoque/recebimentos")
def recebimentos(obra: str = Query(...), meses: int = 12,
                 usuario: str = Depends(usuario_logado)):
    obra_ou_erro(obra)
    return _memo(obra, f"recebimentos:{meses}", lambda: engine.recebimentos(
        _pedidos(obra), _movimentos(obra), _nomes_fornecedores(obra), hoje=date.today(), meses=meses))


@app.get("/api/estoque/pedido-itens")
def pedido_itens(obra: str = Query(...), pedido_id: int = Query(...),
                 usuario: str = Depends(usuario_logado)):
    """Itens de um pedido de compra (para abrir a solicitação da fila de recebimentos)."""
    obra_ou_erro(obra)
    if _modo_demo():
        return {"itens": []}
    out = []
    for it in sienge.pedido_itens(pedido_id):
        qtd = float(it.get("quantity") or 0)
        preco = float(it.get("netPrice") or it.get("unitPrice") or 0)
        out.append({
            "resource_id": str(it.get("resourceId") or ""),
            "descricao": (it.get("resourceDescription") or "").strip(),
            "detalhe": (it.get("detailDescription") or "").strip(),
            "quantidade": qtd,
            "unidade": it.get("unitOfMeasure") or "",
            "preco_unit": round(preco, 4),
            "valor": round(qtd * preco, 2),
        })
    return {"itens": out}


@app.get("/api/estoque/suprimentos")
def suprimentos(obra: str = Query(...), cobertura_alvo: int = 45,
                usuario: str = Depends(usuario_logado)):
    """MRP preditivo: junta a análise de consumo (ruptura por insumo), o lead time
    real por fornecedor (recebimentos) e o % no prazo (fornecedores)."""
    obra_ou_erro(obra)

    def _calc():
        nomes = _nomes_fornecedores(obra)
        receb = engine.recebimentos(_pedidos(obra), _movimentos(obra), nomes, hoje=date.today())
        forn = engine.fornecedores(_pedidos(obra), nomes, hoje=date.today())
        return engine.suprimentos(_analise(obra)["itens"], receb["lead_fornecedores"],
                                  forn["fornecedores"], hoje=date.today(), cobertura_alvo=cobertura_alvo)
    return _memo(obra, f"suprimentos:{cobertura_alvo}", _calc)


# ---- aprovação: contexto orçamento × apropriação ---------------------------
_WBS_CACHE: dict[str, dict] = {}


def _wbs_map(prevision_id: str) -> dict:
    if prevision_id not in _WBS_CACHE:
        p = os.path.join(_DATA_DIR, f"orcamento_wbs_{prevision_id}.json")
        try:
            _WBS_CACHE[prevision_id] = json.load(open(p, encoding="utf-8"))
        except Exception:
            _WBS_CACHE[prevision_id] = {"ucs": {}, "wbs": {}}
    return _WBS_CACHE[prevision_id]


def _resolver_wbs(mapa: dict, building_unit_id, code) -> dict:
    """Resolve (descrição, unidade, qtd_orçada, UC) considerando a UNIDADE CONSTRUTIVA.
    O mesmo wbsCode existe em UCs diferentes — sem a UC certa, mostra subetapa errada."""
    ucs = mapa.get("ucs", {})
    wbs = mapa.get("wbs", {})
    uc = str(building_unit_id) if building_unit_id is not None else None
    info = {}
    if uc is not None:
        info = (wbs.get(uc) or {}).get(str(code)) or {}
    if not info:  # fallback: procura o código em qualquer UC (não deixa sem descrição)
        for sid, codes in wbs.items():
            if str(code) in codes:
                info = codes[str(code)]
                uc = uc or sid
                break
    return {"info": info, "uc_id": building_unit_id, "uc_nome": ucs.get(uc) if uc else None}


@app.get("/api/aprovacao/insumo-orcamento")
def insumo_orcamento(obra: str = Query(...), resource_id: str = Query(...),
                     usuario: str = Depends(usuario_logado)):
    """Contexto de um insumo para a análise da solicitação: onde está orçado
    (subetapas WBS + qtd orçada), saldo de estoque e custo. Base do visualizador."""
    o = obra_ou_erro(obra)
    item = next((i for i in _analise(obra)["itens"] if i["resource_id"] == str(resource_id)), None)
    aprop = [] if _modo_demo() else sienge.buscar_apropriacao(o["cost_center_id"], resource_id)
    wbs = _wbs_map(obra)
    subetapas = []
    for a in aprop:
        code = a.get("costEstimationItemReference")
        r = _resolver_wbs(wbs, a.get("buildingUnitId"), code)
        subetapas.append({
            "sheet_item_id": a.get("sheetItemId"),
            "building_unit_id": a.get("buildingUnitId"),
            "uc_nome": r["uc_nome"],
            "wbs_code": code,
            "descricao": r["info"].get("descricao") or code,
            "qtd_orcada": a.get("quantity"),
            "apropriado_nf": None,   # preenchido pelo coletor de NF (fase 2)
        })
    subetapas.sort(key=lambda s: -(s.get("qtd_orcada") or 0))
    return {
        "resource_id": str(resource_id),
        "descricao": item["descricao"] if item else "",
        "unidade": item["unidade"] if item else "",
        "saldo": item["saldo"] if item else 0,
        "custo_unit": item["custo_unit"] if item else 0,
        "familia": (item or {}).get("familia", ""),
        "orcado_total": round(sum((s.get("qtd_orcada") or 0) for s in subetapas), 2),
        "subetapas": subetapas,
    }


# ---- aprovação: solicitações de compra REAIS do Sienge (purchase-requests) ----
import time as _time
_PEND_CACHE: dict = {"ts": 0.0, "data": []}
_BID_OBRA = {o["building_id"]: pid for pid, o in OBRAS.items()}


def _pendentes_todas():
    if _time.time() - _PEND_CACHE["ts"] < 90 and _PEND_CACHE["data"]:
        return _PEND_CACHE["data"]
    if _modo_demo():
        return []
    itens = sienge.solic_pendentes()
    reqs: dict[int, list[dict]] = {}
    for it in itens:
        reqs.setdefault(it["purchaseRequestId"], []).append(it)
    out = []
    for pr, its in reqs.items():
        try:
            h = sienge.solic_header(pr)
        except Exception:
            continue
        # a API traz itens de solicitações CANCELADAS/rascunho no filtro
        # authorized=false&disapproved=false — só interessa o que aguarda autorização
        if h.get("draft") or (h.get("status") or "").upper() in ("CANCELED", "CANCELLED"):
            continue
        obra = _BID_OBRA.get(h.get("buildingId"))
        if not obra:
            continue
        out.append({
            "purchase_request_id": pr, "obra": obra,
            "requester": h.get("requesterUser"), "data": h.get("requestDate"),
            "notes": h.get("notes"), "status": h.get("status"),
            "itens": [{"item_number": it["itemNumber"], "resource_id": str(it["productId"]),
                       "descricao": it["productDescription"], "quantidade": it["quantity"],
                       "unidade": it.get("unitySymbol")} for it in its],
        })
    _PEND_CACHE.update(ts=_time.time(), data=out)
    return out


@app.get("/api/aprovacao/pendentes")
def pendentes(obra: str = Query(...), usuario: str = Depends(usuario_logado)):
    obra_ou_erro(obra)
    return {"solicitacoes": [s for s in _pendentes_todas() if s["obra"] == obra]}


@app.get("/api/aprovacao/item-subetapa")
def item_subetapa(obra: str = Query(...), pr_id: int = Query(...), item_number: int = Query(...),
                  usuario: str = Depends(usuario_logado)):
    """Subetapas (WBS) que o item da solicitação está pedindo, com descrição e %."""
    obra_ou_erro(obra)
    if _modo_demo():
        return {"subetapas": []}
    wbs = _wbs_map(obra)
    subs = []
    for a in sienge.solic_item_apropriacao(pr_id, item_number):
        code = a.get("costEstimationItemReference")
        r = _resolver_wbs(wbs, a.get("buildingUnitId"), code)
        subs.append({"wbs_code": code, "descricao": r["info"].get("descricao") or code,
                     "uc_id": a.get("buildingUnitId"), "uc_nome": r["uc_nome"],
                     "percentual": a.get("percentage")})
    return {"subetapas": subs}


@app.get("/api/aprovacao/wbs-busca")
def wbs_busca(obra: str = Query(...), q: str = Query(""), uc: str | None = None,
              usuario: str = Depends(usuario_logado)):
    """Busca subetapas (WBS) do orçamento por código ou descrição, por UC.
    Serve para escolher a apropriação CERTA ao corrigir um item."""
    obra_ou_erro(obra)
    mapa = _wbs_map(obra)
    ucs = mapa.get("ucs", {})
    ql = q.strip().lower()
    out = []
    for sid, codes in mapa.get("wbs", {}).items():
        if uc and str(uc) != sid:
            continue
        for code, info in codes.items():
            desc = info.get("descricao") or ""
            if ql and ql not in code.lower() and ql not in desc.lower():
                continue
            out.append({"uc_id": int(sid) if sid.isdigit() else sid, "uc_nome": ucs.get(sid),
                        "wbs_code": code, "descricao": desc, "qtd_orcada": info.get("qtd_orcada")})
            if len(out) >= 40:
                break
        if len(out) >= 40:
            break
    return {"subetapas": out, "ucs": ucs}


class ApropRef(BaseModel):
    building_unit_id: int
    wbs_code: str
    percentage: float


class CorrigirItem(BaseModel):
    obra: str
    purchase_request_id: int
    item_number: int
    apropriacoes: list[ApropRef]
    reprovar_original: bool = True


@app.post("/api/aprovacao/corrigir-item")
def corrigir_item(corpo: CorrigirItem, usuario: str = Depends(usuario_logado)):
    """Corrige a apropriação de um item RELANÇANDO o mesmo insumo com a apropriação
    certa (a API do Sienge não permite editar apropriação existente). Opcionalmente
    reprova o item original (se ainda estiver aguardando). O item novo nasce AUTORIZADO."""
    obra_ou_erro(corpo.obra)
    if _modo_demo():
        raise HTTPException(422, "Indisponível em modo demonstração.")
    soma = round(sum(a.percentage for a in corpo.apropriacoes), 2)
    if abs(soma - 100.0) > 0.01:
        raise HTTPException(422, f"As apropriações precisam somar 100% (soma atual: {soma}%).")
    # dados do item original
    itens = sienge.solic_itens_da_pr(corpo.purchase_request_id)
    orig = next((i for i in itens if i.get("itemNumber") == corpo.item_number), None)
    if not orig:
        raise HTTPException(404, "Item original não encontrado na solicitação.")
    entregas = sienge.solic_item_entregas(corpo.purchase_request_id, corpo.item_number)
    if entregas:
        dr = [{"deliveryRequirementNumber": e.get("deliveryRequirementNumber", i + 1),
               "requirementDate": e.get("requirementDate"),
               "requirementQuantity": e.get("requirementQuantity") or orig.get("quantity"),
               "openQuantity": True} for i, e in enumerate(entregas)]
    else:
        dr = [{"deliveryRequirementNumber": 1, "requirementDate": date.today().isoformat(),
               "requirementQuantity": orig.get("quantity"), "openQuantity": True}]
    novo = {
        "productId": orig.get("productId"),
        "quantity": orig.get("quantity"),
        "unitySymbol": orig.get("unitySymbol"),
        "notes": f"Correção de apropriação do item {corpo.item_number} (BOX21)",
        "buildingsApropriations": [{"buildingUnitId": a.building_unit_id,
                                    "costEstimationItemReference": a.wbs_code,
                                    "percentage": a.percentage} for a in corpo.apropriacoes],
        "deliveryRequirements": dr,
    }
    if orig.get("detailId"):
        novo["detailId"] = orig["detailId"]
    if orig.get("trademarkId"):
        novo["trademarkId"] = orig["trademarkId"]

    # O Sienge NÃO deixa ter o mesmo insumo duplicado na solicitação — então é
    # preciso REPROVAR o item errado ANTES de relançar o corrigido. Só é possível
    # se o item ainda estiver aguardando autorização.
    if orig.get("authorized"):
        raise HTTPException(422, "O item original já está autorizado — não dá para corrigir pela API. "
                                 "Ajuste direto no Sienge.")
    reprovado = False
    if corpo.reprovar_original and not orig.get("disapproved"):
        try:
            sienge.solic_reprovar_item(corpo.purchase_request_id, corpo.item_number)
            reprovado = True
        except sienge.SiengeError as e:
            raise HTTPException(422, f"Não consegui reprovar o item original: {e.mensagem}")
    try:
        sienge.solic_add_itens(corpo.purchase_request_id, [novo])
    except sienge.SiengeError as e:
        raise HTTPException(422, f"Item original {'reprovado' if reprovado else 'mantido'}, "
                                 f"mas falhou ao relançar o corrigido: {e.mensagem}")
    _PEND_CACHE["ts"] = 0.0
    return {"ok": True, "reprovado_original": reprovado}


class SolicAcao(BaseModel):
    purchase_request_id: int
    motivo: str | None = None


@app.post("/api/aprovacao/sienge/autorizar")
def sienge_autorizar(corpo: SolicAcao, usuario: str = Depends(usuario_logado)):
    """Autoriza a solicitação no Sienge (após a dupla aprovação no BOX21)."""
    try:
        sienge.solic_autorizar(corpo.purchase_request_id)
    except sienge.SiengeError as e:
        raise HTTPException(422, e.mensagem)
    _PEND_CACHE["ts"] = 0.0
    return {"ok": True}


@app.post("/api/aprovacao/sienge/reprovar")
def sienge_reprovar(corpo: SolicAcao, usuario: str = Depends(usuario_logado)):
    try:
        sienge.solic_reprovar(corpo.purchase_request_id, corpo.motivo or "")
    except sienge.SiengeError as e:
        raise HTTPException(422, e.mensagem)
    _PEND_CACHE["ts"] = 0.0
    return {"ok": True}


@app.post("/api/estoque/pedidos/atualizar")
def atualizar_pedidos(obra: str = Query(...), usuario: str = Depends(usuario_logado)):
    """(Re)coleta os pedidos de compra da obra em segundo plano (~6 min)."""
    obra_ou_erro(obra)
    if _modo_demo():
        return {"ok": True, "modo": "demo"}
    if not _COLETA_PEDIDOS["rodando"]:
        import threading
        def _bg():
            try:
                _COLETA_PEDIDOS["rodando"] = True
                _pedidos(obra, force=True)
            finally:
                _COLETA_PEDIDOS["rodando"] = False
        threading.Thread(target=_bg, daemon=True).start()
    return {"ok": True, "rodando": True, "atual": len(_pedidos(obra))}


def _posicao(prevision_id: str, nivel: str, detalhe: bool):
    """Consolida a posição de estoque atual pela classificação REAL do Sienge.
    Níveis: grupo (6, topo) -> macro (macrofamília derivada) -> familia (151)."""
    itens = _analise(prevision_id)["itens"]  # já enriquecidos com familia/grupo_sienge/macro
    grupos: dict[str, dict] = {}
    total_valor = 0.0
    sem_grupo = 0
    for i in itens:
        familia = i.get("familia") or ""
        grupo = i.get("grupo_sienge") or ""
        cat = i.get("categoria") or ""
        if nivel == "familia":
            chave = familia or "(Sem classificação)"
        elif nivel == "macro":
            chave = i.get("macro") or "Outros"
        else:  # grupo
            chave = grupo or "(Sem classificação)"
        if not (familia or grupo):
            sem_grupo += 1
        g = grupos.get(chave)
        if g is None:
            g = grupos[chave] = {
                "grupo": chave, "categoria": cat, "familia": familia,
                "n_insumos": 0, "valor_em_estoque": 0.0, "valor_parado": 0.0,
                "n_parados": 0, "n_alertas": 0, "impacto_dia": 0.0, "itens": [] if detalhe else None,
            }
        g["n_insumos"] += 1
        vs = i["valor_saldo"] if i["valor_saldo"] > 0 else 0
        g["valor_em_estoque"] += vs
        total_valor += vs
        if i["status"] == "parado":
            g["valor_parado"] += max(i["valor_saldo"], 0); g["n_parados"] += 1
        if i["status"] in ("ruptura", "critico", "baixo"):
            g["n_alertas"] += 1
        g["impacto_dia"] += i["impacto_dia"]
        if detalhe:
            g["itens"].append({k: i[k] for k in ("resource_id", "descricao", "saldo",
                              "unidade", "valor_saldo", "status", "cobertura_dias")})

    lista = sorted(grupos.values(), key=lambda x: -x["valor_em_estoque"])
    for g in lista:
        g["valor_em_estoque"] = round(g["valor_em_estoque"], 2)
        g["valor_parado"] = round(g["valor_parado"], 2)
        g["impacto_dia"] = round(g["impacto_dia"], 2)
        g["pct_do_total"] = round(g["valor_em_estoque"] / total_valor * 100, 1) if total_valor else 0
    return {
        "nivel": nivel, "hoje": date.today().isoformat(),
        "mapa_ok": bool(grupos_sienge.carregar()),
        "totais": {
            "n_grupos": len(lista), "n_insumos": len(itens),
            "valor_em_estoque": round(total_valor, 2),
            "valor_parado": round(sum(g["valor_parado"] for g in lista), 2),
            "sem_grupo": sem_grupo,
        },
        "grupos": lista,
    }


@app.get("/api/estoque/posicao")
def posicao(obra: str = Query(...), nivel: str = "grupo", detalhe: bool = False,
            usuario: str = Depends(usuario_logado)):
    obra_ou_erro(obra)
    if nivel not in ("grupo", "familia", "macro"):
        nivel = "grupo"
    return _posicao(obra, nivel, detalhe)


_COLETA_GRUPOS = {"rodando": False, "n": 0}


def _coletar_grupos_bg():
    try:
        _COLETA_GRUPOS["rodando"] = True
        _COLETA_GRUPOS["n"] = grupos_sienge.coletar(sienge.get_json)
        _ANALISE_CACHE.clear()
    finally:
        _COLETA_GRUPOS["rodando"] = False


@app.post("/api/estoque/grupos/atualizar")
def atualizar_grupos(usuario: str = Depends(usuario_logado)):
    """Dispara a coleta do mapa insumo→grupo em segundo plano (~11 min: o Sienge
    leva ~30s por página). Retorna na hora; o mapa atualiza quando terminar."""
    if _modo_demo():
        return {"ok": True, "n": 0, "modo": "demo"}
    if not _COLETA_GRUPOS["rodando"]:
        import threading
        threading.Thread(target=_coletar_grupos_bg, daemon=True).start()
    return {"ok": True, "rodando": True, "atual": len(grupos_sienge.carregar())}


@app.get("/api/estoque/catalogo")
def catalogo(obra: str = Query(...), usuario: str = Depends(usuario_logado)):
    obra_ou_erro(obra)
    est = _analise(obra)
    # catálogo = itens com grupo/macro/saldo/consumo (sem os blocos de alerta)
    return {"itens": est["itens"], "macro_ordem": _macros_presentes(est["itens"])}


@app.get("/api/estoque/insumos")
def insumos(obra: str = Query(...), q: str = "",
            usuario: str = Depends(usuario_logado)):
    obra_ou_erro(obra)
    est = _analise(obra)
    ql = q.lower().strip()
    itens = est["itens"]
    if ql:
        itens = [i for i in itens
                 if ql in i["descricao"].lower() or ql == i["resource_id"]]
    return {"itens": itens[:100]}


@app.get("/api/estoque/movimentos")
def movimentos(obra: str = Query(...), usuario: str = Depends(usuario_logado)):
    obra_ou_erro(obra)
    return {"itens": audit.historico(obra)}


def _macros_presentes(itens):
    from taxonomia import MACRO_FAMILIA_ORDEM
    presentes = {i["macro"] for i in itens}
    return [m for m in MACRO_FAMILIA_ORDEM if m in presentes]


# ---------------------------------------------------------------- escrita

class ItemEscrita(BaseModel):
    resource_id: str
    quantidade: float
    unidade: str | None = None
    descricao: str | None = None


class Escrita(BaseModel):
    itens: list[ItemEscrita]
    terceiro: str | None = None       # quem retira o material (requisição/retirada)
    solicitante: str | None = None    # quem solicitou


class Estorno(BaseModel):
    auditoria_id: int


# semântica adotada. documentId confirmados nos movimentos REAIS do Sienge:
# tipo 2 (Consumo)->REQ ; tipo 9 (Entrada Avulsa)->INIE ; tipo 10 (Saída Avulsa)->INIE
_OP = {
    "baixa": (2, "REQ"),      # Consumo
    "entrada": (9, "INIE"),   # Inicialização - Entrada Avulsa
}


def _preco_unit(prevision_id: str, rid) -> float:
    for i in _analise(prevision_id)["itens"]:
        if i["resource_id"] == str(rid):
            return i.get("custo_unit") or 0.0
    return 0.0


def _gravar_avulso(cost_center_id, prevision_id, tipo_id, doc, hoje,
                   rid, qtd, unid, notes):
    """Cria movimento de entrada/saída AVULSA (tipo 9/10). O Sienge exige:
    unitPrice (nas entradas) + buildingAppropriations somando 100% num item de
    orçamento (WBS) NÃO bloqueado. Tenta cada item de orçamento até um aceitar."""
    cands = sienge.buscar_apropriacao(cost_center_id, rid)
    if not cands:
        raise HTTPException(422, f"Insumo {rid} não tem apropriação de obra "
                            "configurada no Sienge — não dá para registrar entrada/estorno.")
    base_item = {"resourceId": int(rid) if str(rid).isdigit() else rid,
                 "quantity": qtd, "unitOfMeasure": unid}
    if tipo_id == 9:  # entrada exige preço unitário
        base_item["unitPrice"] = round(_preco_unit(prevision_id, rid) or 0.01, 4)
    # pula itens de orçamento já sabidamente bloqueados (acelera estornos seguintes)
    ordenados = sorted(cands, key=lambda c: c["sheetItemId"] in _SHEET_BLOQUEADOS)
    ultimo = None
    for c in ordenados:
        item = dict(base_item)
        item["buildingAppropriations"] = [{
            "buildingUnitId": c["buildingUnitId"],
            "sheetItemId": c["sheetItemId"], "percentage": 100}]
        try:
            return sienge.criar_movimento(cost_center_id, tipo_id, doc, hoje, [item], notes=notes)
        except sienge.SiengeError as e:
            ultimo = e
            if "bloquead" in e.mensagem.lower():
                _SHEET_BLOQUEADOS.add(c["sheetItemId"])
                continue  # item de orçamento bloqueado -> tenta o próximo
            raise HTTPException(422, e.mensagem)
    raise HTTPException(422, ultimo.mensagem if ultimo
                        else "Nenhum item de orçamento apropriável para este insumo.")


def _gravar(prevision_id, operacao, corpo: Escrita, usuario):
    o = obra_ou_erro(prevision_id)
    tipo_id, doc = _OP[operacao]
    hoje = date.today().isoformat()
    notes = f"Via app BOX21 ({operacao}) por {usuario}"
    if corpo.terceiro:
        notes += f" | Retirada: {corpo.terceiro}"
    if corpo.solicitante:
        notes += f" | Solic.: {corpo.solicitante}"

    if _modo_demo():
        resp = {"status": 201, "movement_id": f"DEMO-{operacao}", "resposta": {"demo": True}}
    elif operacao == "baixa":
        # consumo (tipo 2): não exige preço nem apropriação — um movimento com N linhas
        itens_sienge = [
            {"resourceId": int(i.resource_id) if str(i.resource_id).isdigit() else i.resource_id,
             "quantity": i.quantidade, "unitOfMeasure": i.unidade or ""}
            for i in corpo.itens
        ]
        try:
            resp = sienge.criar_movimento(o["cost_center_id"], tipo_id, doc, hoje,
                                          itens_sienge, notes=notes)
        except sienge.SiengeError as e:
            raise HTTPException(422, e.mensagem)
    else:
        # entrada (tipo 9): exige preço + apropriação -> um movimento por item
        resp = {"status": 201, "movement_id": None, "resposta": {}}
        for i in corpo.itens:
            resp = _gravar_avulso(o["cost_center_id"], prevision_id, tipo_id, doc, hoje,
                                  i.resource_id, i.quantidade, i.unidade or "", notes)
    # anexa ao cache em vez de re-baixar todo o histórico (saldo atualiza na hora)
    _anexar_local(prevision_id, operacao, corpo, tipo_id)

    ids = audit.registrar(
        usuario=usuario, obra=prevision_id, operacao=operacao,
        movement_type_id=tipo_id, document_id=doc, movement_date=hoje,
        sienge_status=resp["status"], sienge_movement_id=resp["movement_id"],
        sienge_resposta=resp["resposta"],
        itens=[{"resource_id": i.resource_id, "quantidade": i.quantidade,
                "unidade": i.unidade, "descricao": i.descricao} for i in corpo.itens],
        terceiro=corpo.terceiro, solicitante=corpo.solicitante,
    )
    return {"ok": True, "modo": "demo" if _modo_demo() else "sienge",
            "sienge": resp, "auditoria_ids": ids}


@app.post("/api/estoque/baixa")
def baixa(corpo: Escrita, obra: str = Query(...),
          usuario: str = Depends(usuario_admin)):
    if not corpo.itens:
        raise HTTPException(400, "Nenhum item informado")
    return _gravar(obra, "baixa", corpo, usuario)


@app.post("/api/estoque/entrada")
def entrada(corpo: Escrita, obra: str = Query(...),
            usuario: str = Depends(usuario_admin)):
    if not corpo.itens:
        raise HTTPException(400, "Nenhum item informado")
    return _gravar(obra, "entrada", corpo, usuario)


@app.post("/api/estoque/estorno")
def estorno(corpo: Estorno, usuario: str = Depends(usuario_admin)):
    linha = audit.por_id(corpo.auditoria_id)
    if not linha:
        raise HTTPException(404, "Registro de auditoria não encontrado")
    if linha["estornado"]:
        raise HTTPException(400, "Este movimento já foi estornado")

    prevision_id = linha["obra"]
    o = obra_ou_erro(prevision_id)
    # estorno = movimento compensatório na direção oposta (documentId INIE = avulso)
    if linha["operacao"] == "baixa":
        tipo_id, doc, op_oposta = 9, "INIE", "entrada"   # devolve ao saldo
    else:
        tipo_id, doc, op_oposta = 10, "INIE", "baixa"     # retira do saldo
    hoje = date.today().isoformat()
    notes = f"Via app Almoxarifado R21 (estorno de #{corpo.auditoria_id}) por {usuario}"

    if _modo_demo():
        resp = {"status": 201, "movement_id": f"DEMO-estorno", "resposta": {"demo": True}}
    else:
        # estorno = entrada/saída avulsa (tipo 9/10): exige preço + apropriação 100%
        resp = _gravar_avulso(o["cost_center_id"], prevision_id, tipo_id, doc, hoje,
                              linha["resource_id"], linha["quantidade"],
                              linha["unidade"] or "", notes)

    ids = audit.registrar(
        usuario=usuario, obra=prevision_id, operacao="estorno",
        movement_type_id=tipo_id, document_id=doc, movement_date=hoje,
        sienge_status=resp["status"], sienge_movement_id=resp["movement_id"],
        sienge_resposta=resp["resposta"],
        itens=[{"resource_id": linha["resource_id"], "quantidade": linha["quantidade"],
                "unidade": linha["unidade"], "descricao": linha["descricao"]}],
        estorno_de=corpo.auditoria_id,
    )
    audit.marcar_estornado(corpo.auditoria_id)
    # anexa o compensatório ao cache (saldo volta na hora, sem re-baixar tudo)
    _anexar_local(prevision_id, "estorno",
                  Escrita(itens=[ItemEscrita(resource_id=linha["resource_id"],
                                             quantidade=linha["quantidade"],
                                             unidade=linha["unidade"],
                                             descricao=linha["descricao"])]), tipo_id)
    return {"ok": True, "auditoria_ids": ids, "sienge": resp}
