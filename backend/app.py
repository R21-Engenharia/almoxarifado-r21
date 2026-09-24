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

import hashlib
import re
from collections import Counter
from typing import Literal

from fastapi import FastAPI, HTTPException, Header, Query, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from pydantic import BaseModel

import sienge
import supa
import demo_data
import engine
import audit
import livro
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
livro.init_db()


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


# ---- permissões aplicadas NO SERVIDOR (obra, módulo, operar) -----------------
# O front só esconde menus; quem garante o acesso é esta camada. Regra do perfil:
# lista vazia = todas as obras / todos os módulos; role admin passa por tudo.
def _perfil(email: str) -> dict:
    return _perfil_norm(supa.perms_cache(email), email)


def _eh_admin(p: dict) -> bool:
    return (p.get("role") or "").lower() == "admin"


def _checar_acesso(email: str, obra: str | None, modulos: tuple[str, ...] = ()):
    """403 se o perfil não inclui a obra ou nenhum dos módulos que usam a rota."""
    if not _auth_ativo():
        return  # dev local sem Supabase
    p = _perfil(email)
    if _eh_admin(p):
        return
    if obra is not None and p["obras"] and str(obra) not in {str(o) for o in p["obras"]}:
        raise HTTPException(403, "Seu perfil não tem acesso a esta obra.")
    if modulos and p["modulos"] and not any(m in p["modulos"] for m in modulos):
        raise HTTPException(403, "Seu perfil não tem acesso a este módulo.")


def _exigir_operar(email: str):
    if not _auth_ativo():
        return
    p = _perfil(email)
    if not (p["operar"] or _eh_admin(p)):
        raise HTTPException(403, "Você não tem permissão para operar o almoxarifado (baixa/entrada).")


def acesso(*modulos: str):
    """Dependência: usuário logado + obra (?obra=) e módulo permitidos no perfil.
    `modulos` = telas que usam a rota; basta ter uma delas."""
    def dep(request: Request, authorization: str | None = Header(default=None)) -> str:
        email = usuario_logado(authorization)
        _checar_acesso(email, request.query_params.get("obra"), modulos)
        return email
    return dep


def operador(*modulos: str):
    """acesso(...) + flag operar (grava no Sienge)."""
    def dep(request: Request, authorization: str | None = Header(default=None)) -> str:
        email = usuario_logado(authorization)
        _checar_acesso(email, request.query_params.get("obra"), modulos)
        _exigir_operar(email)
        return email
    return dep

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


# uma trava por (tipo, obra): duas requisições (ou o warm-up + um acesso) não disparam
# a mesma coleta pesada ao mesmo tempo — a segunda espera e usa o resultado da primeira.
import threading
_TRAVAS: dict[str, threading.Lock] = {}
_TRAVAS_GUARDA = threading.Lock()


def _trava(nome: str) -> threading.Lock:
    with _TRAVAS_GUARDA:
        return _TRAVAS.setdefault(nome, threading.Lock())


_JANELA_INCREMENTAL = 7  # dias de sobreposição (pega lançamento retroativo recente)


def _data_mov(m: dict) -> str:
    return str(m.get("movementDate") or "")[:10]


def _movimentos(prevision_id: str, force: bool = False, completa: bool = False) -> list[dict]:
    """Histórico de movimentos da obra (cache em memória + snapshot em disco).
    force=True re-coleta: INCREMENTAL por padrão (só os últimos dias, trocando essa
    janela inteira — validado idêntico à coleta completa), ou completa=True.
    Deleções antigas no Sienge só entram na coleta completa (a do boot diário)."""
    if not force and prevision_id in _MOVS_CACHE:
        return _MOVS_CACHE[prevision_id]
    with _trava(f"movs:{prevision_id}"):
        if not force and prevision_id in _MOVS_CACHE:
            return _MOVS_CACHE[prevision_id]  # outra thread acabou de carregar
        if _modo_demo():
            _MOVS_CACHE[prevision_id] = demo_data.coletar_movimentos_demo(prevision_id)
            return _MOVS_CACHE[prevision_id]
        if not force:
            snap = _carregar_snapshot(prevision_id)
            if snap is not None:
                _MOVS_CACHE[prevision_id] = snap
                return snap
        o = obra_ou_erro(prevision_id)
        atual = [m for m in _MOVS_CACHE.get(prevision_id, [])
                 if not str(m.get("id", "")).startswith("local-")]  # anexos locais saem: vêm os reais
        datas = [d for d in (_data_mov(m) for m in atual) if d]
        if force and not completa and datas:
            from datetime import timedelta as _td
            ini = (date.fromisoformat(max(datas)) - _td(days=_JANELA_INCREMENTAL)).isoformat()
            novos = sienge.coletar_movimentos(o["building_id"], start_date=ini)
            _MOVS_CACHE[prevision_id] = [m for m in atual if _data_mov(m) < ini] + novos
        else:
            # completa (lenta): sem cache/snapshot, ou pedida explicitamente
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


def _anexar_local(prevision_id: str, itens: list, tipo_id: int, precos: dict | None = None):
    """Após gravar no Sienge, anexa os itens CONFIRMADOS ao cache (evita re-baixar tudo).
    Reflete o saldo imediatamente; os valores reais chegam no próximo 'atualizar'.
    `precos` (resource_id -> preço) = preço usado na entrada, p/ não diluir o custo médio."""
    if not itens:
        return
    _movimentos(prevision_id)
    io = "OUTPUT" if tipo_id in (2, 10) else "INPUT"
    tipo_desc = "Consumo" if tipo_id == 2 else (
        "Inicialização - Entrada Avulsa" if tipo_id == 9 else "Inicialização - Saída Avulsa")
    novos = []
    for n, i in enumerate(itens):
        novos.append({
            "id": f"local-{date.today().isoformat()}-{id(i)}-{n}", "resourceId": i.resource_id,
            "resourceDescription": i.descricao or "", "inputOutput": io,
            "movementTypeId": tipo_id, "movementTypeDescription": tipo_desc,
            "movementQuantity": i.quantidade,
            "movementValue": (precos or {}).get(str(i.resource_id), 0),
            "detailId": i.detail_id, "trademarkId": i.trademark_id,
            "movementDate": date.today().isoformat(),
            "baseUnitOfMeasureSymbol": i.unidade or "", "unitOfMeasureSymbol": i.unidade or "",
            "supplierName": None,
        })
    # cópia-na-escrita: quem está lendo a lista antiga (motor rodando) não é afetado
    with _trava(f"movs:{prevision_id}"):
        _MOVS_CACHE[prevision_id] = _MOVS_CACHE.get(prevision_id, []) + novos
    _salvar_snapshot(prevision_id)
    _invalidar_obra(prevision_id)


# ---------------------------------------------------------------- leitura

@app.get("/api/health")
def health():
    # público (não exige login) — usado para status, para o front saber o modo
    # e como alvo do keep-warm (ping periódico que evita a hibernação no Render free)
    return {"ok": True, "modo": "demo" if _modo_demo() else "sienge",
            "auth": _auth_ativo(), "obras": list(OBRAS.keys())}


# ---- warm-up no boot -------------------------------------------------------
# Pré-carrega a coleta em segundo plano assim que o backend sobe, para o PRIMEIRO
# acesso não pagar o ~1 min de coleta do Sienge. Vale em qualquer host; no Render
# free combina com o keep-warm (que evita a hibernação). Best-effort e NÃO bloqueia
# o boot — o /api/health responde na hora enquanto o cache aquece atrás.
_AQUECIDO = {"rodou": False}


def _aquecer_cache():
    if _AQUECIDO["rodou"] or _modo_demo():
        return
    _AQUECIDO["rodou"] = True
    for obra in list(OBRAS.keys()):
        try:
            _movimentos(obra)   # 1x: carrega snapshot do disco ou baixa do Sienge (lento)
            _analise(obra)      # aquece o motor de análise
            _estoque_inv(obra)  # aquece o inventário (usado na autorização de compra)
            _em_transito(obra)  # pedidos em aberto (MRP e autorização)
        except Exception:
            pass                # nunca derruba o boot por causa do aquecimento


@app.on_event("startup")
def _on_startup():
    if os.environ.get("ALMOX_WARMUP", "1") == "0":
        return
    import threading
    threading.Thread(target=_aquecer_cache, name="warmup", daemon=True).start()


@app.post("/api/estoque/atualizar")
def atualizar(obra: str = Query(...), completa: bool = False,
              usuario: str = Depends(acesso("estoque"))):
    """Puxa do Sienge os movimentos feitos por fora do app. Incremental (segundos);
    completa=true re-baixa todo o histórico (lento, ~1 min)."""
    obra_ou_erro(obra)
    _movimentos(obra, force=True, completa=completa)
    _TRANSITO_CACHE.pop(obra, None)
    return {"ok": True, "coletado_em": snapshot_info(obra)}


@app.get("/api/obras")
def listar_obras(usuario: str = Depends(usuario_logado)):
    demo = _modo_demo()
    permitidas = None  # None = todas
    if _auth_ativo():
        p = _perfil(usuario)
        if not _eh_admin(p) and p["obras"]:
            permitidas = {str(o) for o in p["obras"]}
    return [
        {"prevision_id": pid,
         "nome": (o["nome"] + " (DEMO)") if demo else o["nome"]}
        for pid, o in OBRAS.items() if permitidas is None or pid in permitidas
    ]


# ---------------------------------------------------------------- usuários / permissões
_MODULOS = ["financeiro", "posicao", "recebimentos", "consumo", "suprimentos", "fornecedores",
            "equipamentos", "aprovacao", "requisicao", "estoque", "operar", "historico",
            "transferencias", "inventario"]


def _perfil_norm(row: dict | None, email: str) -> dict:
    """Normaliza a linha de authorized_emails no shape de permissões do app."""
    row = row or {}
    return {
        "email": email, "nome": row.get("nome"), "cargo": row.get("cargo"),
        "tipo": row.get("tipo") or "Geral", "ativo": row.get("ativo", True),
        "role": (row.get("role") or "user"),
        "perfil": row.get("perfil"),                  # perfil de acesso de origem (almoxarife, engenheiro…)
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


@app.get("/api/estoque/material")
def material(obra: str = Query(...), janela_dias: int = 90,
             usuario: str = Depends(acesso("estoque"))):
    obra_ou_erro(obra)
    res = _analise(obra, janela_dias)
    # a tela de Estoque só usa kpis + alertas + parados; a lista completa (1500+ itens)
    # vai pelo /catalogo quando é preciso — não trafega ~1MB à toa aqui.
    return {**res, "itens": []}


def _linha_abc(i: dict, pct: float, acum, cls: str) -> dict:
    """Linha enxuta da curva ABC (pra exportação e validação com o almoxarife)."""
    return {
        "resource_id": i["resource_id"],
        "descricao": i["descricao"],
        "grupo": i.get("grupo_sienge") or i.get("grupo") or "",
        "familia": i.get("familia") or "",
        "macro": i.get("macro") or "",
        "unidade": i["unidade"],
        "saldo": i["saldo"],
        "custo_unit": i["custo_unit"],
        "valor_saldo": i["valor_saldo"],
        "pct_do_total": round(pct, 3),
        "pct_acumulado": (round(acum, 3) if acum is not None else None),
        "abc": cls,
        "status": i["status"],
        "ultima_entrada": i.get("ultima_entrada"),
        "ultimo_consumo": i.get("ultimo_consumo"),
    }


@app.get("/api/estoque/curva-abc")
def curva_abc(obra: str = Query(...), janela_dias: int = 90,
              usuario: str = Depends(acesso("estoque"))):
    """Curva ABC por capital em estoque + última entrada/consumo por item.
    A/B/C pelo % acumulado do valor (80/95). Itens sem saldo entram como '—'."""
    obra_ou_erro(obra)
    res = _analise(obra, janela_dias)
    itens = res["itens"]
    com = sorted((i for i in itens if i["valor_saldo"] > 0),
                 key=lambda x: -x["valor_saldo"])
    total = sum(i["valor_saldo"] for i in com)
    linhas: list[dict] = []
    acum = 0.0
    for i in com:
        pct = (i["valor_saldo"] / total * 100) if total else 0.0
        # classe pelo acumulado ANTES do item (o que cruza 80% ainda é A)
        cls = "A" if acum < 80 else ("B" if acum < 95 else "C")
        acum += pct
        linhas.append(_linha_abc(i, pct, acum, cls))
    for i in sorted((i for i in itens if i["valor_saldo"] <= 0),
                    key=lambda x: (x["descricao"] or "")):
        linhas.append(_linha_abc(i, 0.0, None, "—"))
    resumo = {}
    for cls in ("A", "B", "C"):
        grp = [l for l in linhas if l["abc"] == cls]
        v = sum(l["valor_saldo"] for l in grp)
        resumo[cls] = {"n_itens": len(grp), "valor": round(v, 2),
                       "pct_valor": round(v / total * 100, 1) if total else 0.0}
    return {"hoje": res["hoje"], "valor_total": round(total, 2),
            "n_itens": len(linhas), "resumo": resumo, "itens": linhas}


# cache de RESULTADO dos motores (evita reprocessar 13k+ movimentos a cada abertura).
# Chave inclui a data => expira sozinho a cada dia; some quando os dados são atualizados.
_ENGINE_CACHE: dict = {}


def _memo(obra: str, tag: str, fn):
    hoje = date.today().isoformat()
    key = (obra, f"{tag}:{hoje}")
    if key in _ENGINE_CACHE:
        return _ENGINE_CACHE[key]
    r = fn()
    for k in [k for k in list(_ENGINE_CACHE) if not k[1].endswith(hoje)]:
        _ENGINE_CACHE.pop(k, None)  # resultados de dias anteriores
    _ENGINE_CACHE[key] = r
    return r


def _invalidar_obra(prevision_id: str):
    _ANALISE_CACHE.pop(prevision_id, None)
    _ESTOQUE_INV_CACHE.pop(prevision_id, None)
    for k in [k for k in _ENGINE_CACHE if k[0] == prevision_id]:
        _ENGINE_CACHE.pop(k, None)


# inventário oficial do Sienge (saldo por cor/marca) — cache diário por obra
_ESTOQUE_INV_CACHE: dict = {}


def _estoque_inv(obra: str, force: bool = False) -> list[dict]:
    hoje = date.today().isoformat()
    c = _ESTOQUE_INV_CACHE.get(obra)
    if not force and c and c[0] == hoje:
        return c[1]
    if _modo_demo():
        return []
    with _trava(f"inv:{obra}"):
        c = _ESTOQUE_INV_CACHE.get(obra)
        if not force and c and c[0] == hoje:
            return c[1]
        rows = sienge.estoque_inventario(OBRAS[obra]["cost_center_id"])
        _ESTOQUE_INV_CACHE[obra] = (hoje, rows)
        return rows


@app.get("/api/estoque/insumo-variantes")
def insumo_variantes(obra: str = Query(...), resource_id: str = Query(...),
                     todas: bool = False, usuario: str = Depends(acesso("operar", "requisicao"))):
    """Variações (cor/bitola/spec/marca) de um insumo. Na BAIXA (todas=false):
    só as que têm saldo na obra. Na ENTRADA (todas=true): todas as cadastradas
    (a variação pode ainda não ter entrado), com o saldo atual anexado."""
    obra_ou_erro(obra)
    saldo = {}  # (detailId, trademarkId) -> (quantity, unit)
    unid_base = None
    for r in _estoque_inv(obra):
        if str(r.get("resourceId")) != str(resource_id):
            continue
        unid_base = unid_base or r.get("unitOfMeasure")
        saldo[(r.get("detailId"), r.get("trademarkId"))] = (r.get("quantity") or 0, r.get("unitOfMeasure"))

    if not todas:
        vs = [{
            "detail_id": d, "detail_desc": "", "trademark_id": t, "trademark_desc": "",
            "saldo": q, "unidade": u,
        } for (d, t), (q, u) in saldo.items() if q]
        # enriquece descrição das variações a partir do inventário
        for v in vs:
            for r in _estoque_inv(obra):
                if str(r.get("resourceId")) == str(resource_id) and r.get("detailId") == v["detail_id"] and r.get("trademarkId") == v["trademark_id"]:
                    v["detail_desc"] = (r.get("detailDescription") or "").strip()
                    v["trademark_desc"] = (r.get("trademarkDescription") or "").strip()
                    break
        return {"variantes": vs}

    # entrada: todas as variações cadastradas
    if _modo_demo():
        return {"variantes": []}
    info = sienge.resource_variacoes(resource_id)
    u0 = info.get("unit") or unid_base or ""
    dets, tms = info.get("details") or [], info.get("trademarks") or []
    vs = []
    if dets:
        for d in dets:
            q = saldo.get((d["id"], None), (0, u0))[0]
            vs.append({"detail_id": d["id"], "detail_desc": (d.get("description") or "").strip(),
                       "trademark_id": None, "trademark_desc": "", "saldo": q, "unidade": u0})
    elif tms:
        for t in tms:
            q = saldo.get((None, t["id"]), (0, u0))[0]
            vs.append({"detail_id": None, "detail_desc": "", "trademark_id": t["id"],
                       "trademark_desc": (t.get("description") or "").strip(), "saldo": q, "unidade": u0})
    return {"variantes": vs}


# ---------------------------------------------------------------- embalagens
class EmbalagemIn(BaseModel):
    resource_id: str
    nome: str
    fator: float
    unidade: str | None = None


@app.get("/api/estoque/embalagens")
def embalagens_listar(usuario: str = Depends(acesso("operar", "requisicao"))):
    if not _auth_ativo():
        return {"embalagens": []}
    return {"embalagens": supa.listar_embalagens()}


@app.post("/api/estoque/embalagens")
def embalagens_salvar(corpo: EmbalagemIn, usuario: str = Depends(operador("operar", "requisicao"))):
    if corpo.fator <= 0:
        raise HTTPException(422, "O fator da embalagem precisa ser maior que zero.")
    dados = corpo.model_dump()
    dados["criado_por"] = usuario
    try:
        return supa.upsert_embalagem(dados)
    except supa.AuthError as e:
        raise HTTPException(e.status if getattr(e, "status", 0) else 422, e.msg)


@app.delete("/api/estoque/embalagens/{emb_id}")
def embalagens_deletar(emb_id: str, usuario: str = Depends(operador("operar", "requisicao"))):
    try:
        supa.deletar_embalagem(emb_id)
    except supa.AuthError as e:
        raise HTTPException(e.status if getattr(e, "status", 0) else 422, e.msg)
    return {"ok": True}


@app.get("/api/estoque/financeiro")
def financeiro(obra: str = Query(...), meses: int = 12,
               usuario: str = Depends(acesso("financeiro"))):
    obra_ou_erro(obra)
    return _memo(obra, f"financeiro:{meses}", lambda: engine.financeiro(_movimentos(obra), hoje=date.today(), meses=meses))


@app.get("/api/estoque/consumo")
def consumo(obra: str = Query(...), meses: int = 12,
            usuario: str = Depends(acesso("consumo"))):
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
    with _trava(f"pedidos:{prevision_id}"):
        if not force and prevision_id in _PEDIDOS_CACHE:
            return _PEDIDOS_CACHE[prevision_id]
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
                 usuario: str = Depends(acesso("fornecedores"))):
    obra_ou_erro(obra)
    return _memo(obra, f"fornecedores:{meses}", lambda: engine.fornecedores(
        _pedidos(obra), _nomes_fornecedores(obra), hoje=date.today(), meses=meses))


@app.get("/api/estoque/recebimentos")
def recebimentos(obra: str = Query(...), meses: int = 12,
                 usuario: str = Depends(acesso("recebimentos"))):
    obra_ou_erro(obra)
    return _memo(obra, f"recebimentos:{meses}", lambda: engine.recebimentos(
        _pedidos(obra), _movimentos(obra), _nomes_fornecedores(obra), hoje=date.today(), meses=meses))


@app.get("/api/estoque/pedido-itens")
def pedido_itens(obra: str = Query(...), pedido_id: int = Query(...),
                 usuario: str = Depends(acesso("recebimentos"))):
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


# ---- "a caminho": material comprado e não recebido ------------------------------
# Lido AO VIVO dos pedidos em aberto do Sienge (não do arquivo de pedidos congelado),
# com cache curto. ~20-30 pedidos por obra, ~0,6 s cada na primeira leitura.
_TRANSITO_TTL = 15 * 60
_TRANSITO_CACHE: dict[str, dict] = {}   # obra -> {"ts", "dados", "erro"}


def _em_transito(obra: str) -> dict:
    """{"por_chave": {(rid, detail_id): {...}}, "sem_conversao": [...], "ts", "erro"}.
    Se o Sienge falhar, devolve vazio com `erro` (o MRP segue só com o físico)."""
    vazio = {"por_chave": {}, "sem_conversao": [], "ts": None, "erro": None}
    if _modo_demo():
        return vazio
    c = _TRANSITO_CACHE.get(obra)
    if c and _time.time() - c["ts"] < _TRANSITO_TTL:
        return c
    with _trava(f"transito:{obra}"):
        c = _TRANSITO_CACHE.get(obra)
        if c and _time.time() - c["ts"] < _TRANSITO_TTL:
            return c
        o = obra_ou_erro(obra)
        try:
            abertos = [{"pedido": p, "itens": sienge.pedido_itens(p["id"])}
                       for p in sienge.pedidos_abertos(o["building_id"])]
            dados = engine.em_transito(abertos, _movimentos(obra))
            c = {**dados, "ts": _time.time(), "erro": None, "n_pedidos": len(abertos)}
        except Exception as e:  # sem trânsito é melhor que sem MRP
            c = {**vazio, "ts": _time.time(), "erro": f"Pedidos em aberto indisponíveis agora ({e})."}
        _TRANSITO_CACHE[obra] = c
        return c


def _transito_publico(t: dict) -> dict:
    """Resumo serializável do trânsito (chaves de tupla não vão para JSON)."""
    return {"atualizado_em": datetime.fromtimestamp(t["ts"]).isoformat(timespec="minutes") if t.get("ts") else None,
            "erro": t.get("erro"), "n_pedidos": t.get("n_pedidos", 0),
            "n_sem_conversao": len(t.get("sem_conversao") or [])}


@app.get("/api/estoque/suprimentos")
def suprimentos(obra: str = Query(...), cobertura_alvo: int = 45,
                usuario: str = Depends(acesso("suprimentos"))):
    """MRP preditivo: junta a análise de consumo (ruptura por insumo), o lead time
    real por fornecedor (recebimentos), o % no prazo (fornecedores) e o que já está
    A CAMINHO (pedidos autorizados não recebidos) — não sugere recomprar o já pedido."""
    obra_ou_erro(obra)
    t = _em_transito(obra)
    a_caminho = engine.transito_por_insumo(t)

    def _calc():
        nomes = _nomes_fornecedores(obra)
        receb = engine.recebimentos(_pedidos(obra), _movimentos(obra), nomes, hoje=date.today())
        forn = engine.fornecedores(_pedidos(obra), nomes, hoje=date.today())
        return engine.suprimentos(_analise(obra)["itens"], receb["lead_fornecedores"],
                                  forn["fornecedores"], hoje=date.today(), cobertura_alvo=cobertura_alvo,
                                  a_caminho=a_caminho)
    res = _memo(obra, f"suprimentos:{cobertura_alvo}:{t.get('ts')}", _calc)
    return {**res, "a_caminho": _transito_publico(t)}


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
                     usuario: str = Depends(acesso("aprovacao"))):
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
                       "unidade": it.get("unitySymbol"),
                       # detalhe/variação pedida (quando o Sienge informa no item da solicitação;
                       # ausente -> None -> o estoque é casado no nível do insumo)
                       "detail_id": it.get("detailId"),
                       "detail_desc": (it.get("detailDescription") or "").strip() or None,
                       "trademark_id": it.get("trademarkId"),
                       "trademark_desc": (it.get("trademarkDescription") or "").strip() or None}
                      for it in its],
        })
    _PEND_CACHE.update(ts=_time.time(), data=out)
    return out


def _projecao_estoque(obra: str, itens: list[dict]) -> list[dict]:
    """Anexa a cada item da solicitação de COMPRA a projeção de estoque:
        estoque_projetado = estoque_atual + quantidade_solicitada   (compra: SOMA, nunca subtrai).
    O estoque atual vem do inventário OFICIAL do Sienge (mesma fonte do módulo de
    estoque — sem dados paralelos), casado no MESMO nível de identificação do item:
    se a solicitação especifica um detalhe/marca, usa o saldo daquela variação;
    caso contrário, usa o total do insumo e devolve o detalhamento por variação.
    Complementar (NÃO entra na fórmula): `a_caminho` = comprado e ainda não recebido,
    no mesmo nível (detalhe pedido, ou o insumo todo)."""
    inv = _estoque_inv(obra)
    transito = _em_transito(obra).get("por_chave", {})
    por_detalhe: dict[tuple, list] = {}   # (rid, detailId, trademarkId) -> [qtd, unidade]
    por_recurso: dict[str, dict] = {}     # rid -> {total, unidade, variantes[]}
    for r in inv:
        rid = str(r.get("resourceId")); did = r.get("detailId"); tid = r.get("trademarkId")
        q = r.get("quantity") or 0; u = r.get("unitOfMeasure")
        cur = por_detalhe.get((rid, did, tid), [0, u])
        cur[0] += q; cur[1] = cur[1] or u
        por_detalhe[(rid, did, tid)] = cur
        ac = por_recurso.setdefault(rid, {"total": 0.0, "unidade": u, "variantes": []})
        ac["total"] += q; ac["unidade"] = ac["unidade"] or u
        if q:
            ac["variantes"].append({
                "detail_id": did, "detail_desc": (r.get("detailDescription") or "").strip(),
                "trademark_id": tid, "trademark_desc": (r.get("trademarkDescription") or "").strip(),
                "saldo": round(q, 3), "unidade": u})
    out = []
    for it in itens:
        rid = str(it["resource_id"]); did = it.get("detail_id"); tid = it.get("trademark_id")
        rec = por_recurso.get(rid)
        todas = sorted(rec["variantes"], key=lambda v: -v["saldo"]) if rec else []  # só saldo>0
        if did is not None or tid is not None:      # pediu uma variação específica
            atual, uni = por_detalhe.get((rid, did, tid), [0, it.get("unidade")])
            variantes = []
            # complementar (informativo): OUTROS detalhes do mesmo insumo com estoque>0,
            # exceto o próprio detalhe solicitado. Não altera nada da compra/estoque.
            outros = [v for v in todas if not (v["detail_id"] == did and v["trademark_id"] == tid)]
        else:                                        # pediu o insumo (sem variação): total + rateio
            atual = rec["total"] if rec else 0
            uni = (rec["unidade"] if rec else None) or it.get("unidade")
            variantes = todas
            outros = []  # sem detalhe pedido, o rateio (variantes) já mostra tudo
        qsol = it.get("quantidade") or 0
        if did is not None:
            tr = [t for (r, d), t in transito.items() if r == rid and d == did]
        else:
            tr = [t for (r, _), t in transito.items() if r == rid]
        out.append({**it,
                    "a_caminho": round(sum(t["qtd"] for t in tr), 3),
                    "a_caminho_estimado": any(t["estimado"] for t in tr),
                    "a_caminho_pedidos": sorted({p["numero"] for t in tr for p in t["pedidos"]}),
                    "estoque_atual": round(atual, 3),
                    "estoque_unidade": uni,
                    "estoque_projetado": round(atual + qsol, 3),
                    "variantes": variantes,
                    "outros_detalhes": outros})
    return out


@app.get("/api/aprovacao/pendentes")
def pendentes(obra: str = Query(...), usuario: str = Depends(acesso("aprovacao"))):
    obra_ou_erro(obra)
    sols = [s for s in _pendentes_todas() if s["obra"] == obra]
    return {"solicitacoes": [{**s, "itens": _projecao_estoque(obra, s["itens"])} for s in sols]}


@app.get("/api/aprovacao/item-subetapa")
def item_subetapa(obra: str = Query(...), pr_id: int = Query(...), item_number: int = Query(...),
                  usuario: str = Depends(acesso("aprovacao"))):
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


class AprovAcao(BaseModel):
    purchase_request_id: int
    etapa: Literal["engenharia", "planejamento"]
    acao: Literal["aprovada", "reprovada", "devolvida"]
    obs: str | None = None


# etapa -> (status em que a solicitação precisa estar, papéis que podem agir)
_ETAPAS = {
    "engenharia": ("aguardando_engenharia", ("engenheiro", "admin")),
    "planejamento": ("aguardando_planejamento", ("planejamento", "admin")),
}


@app.post("/api/aprovacao/acao")
def aprovacao_acao(corpo: AprovAcao, obra: str = Query(...),
                   usuario: str = Depends(acesso("aprovacao"))):
    """Dupla aprovação aplicada NO SERVIDOR (Engenharia -> Planejamento -> Sienge).

    Confere o papel do usuário, a etapa em que a solicitação está e se ela ainda
    aguarda autorização no Sienge. A transição é compare-and-set no status: se
    outra pessoa agiu antes, devolve 409. Só a aprovação do Planejamento autoriza
    no Sienge; reprovar grava a reprovação no Sienge; devolver fica só no BOX21."""
    obra_ou_erro(obra)
    pr, etapa, acao = corpo.purchase_request_id, corpo.etapa, corpo.acao
    status_exigido, papeis = _ETAPAS[etapa]
    papel = (_perfil(usuario).get("role") or "").lower() if _auth_ativo() else "admin"
    if papel not in papeis:
        raise HTTPException(403, f"A etapa de {etapa} é feita por: {' ou '.join(papeis)}.")
    obs = (corpo.obs or "").strip()
    if acao in ("reprovada", "devolvida") and not obs:
        raise HTTPException(422, "Informe o motivo.")
    if not supa.configurado():
        raise HTTPException(503, "As aprovações exigem o Supabase configurado.")

    if not _modo_demo():
        # a solicitação tem que estar pendente no Sienge e ser desta obra
        _PEND_CACHE["ts"] = 0.0
        pend = {s["purchase_request_id"]: s for s in _pendentes_todas()}
        s = pend.get(pr)
        if not s or s["obra"] != obra:
            raise HTTPException(409, "Esta solicitação não está mais aguardando autorização "
                                "no Sienge (ou é de outra obra). Atualize a lista.")

    try:
        ov = supa.aprov_garantir(pr, obra)
    except supa.AuthError as e:
        raise HTTPException(e.status, e.msg)
    if str(ov.get("obra")) != str(obra):
        raise HTTPException(409, "Esta solicitação está registrada em outra obra.")
    if ov.get("status") != status_exigido:
        raise HTTPException(409, f"A solicitação está em '{ov.get('status')}', não em "
                            f"'{status_exigido}'. Atualize a tela.")

    agora = datetime.now().astimezone().isoformat()
    pre = "eng" if etapa == "engenharia" else "plan"
    carimbo = {f"{pre}_por": usuario, f"{pre}_em": agora, f"{pre}_obs": obs or None}
    if acao == "aprovada":
        novo = {**carimbo, "status": "aguardando_planejamento"} if etapa == "engenharia" else \
               {**carimbo, "status": "em_compras", "autorizado_sienge": True}
    elif acao == "reprovada":
        novo = {**carimbo, "status": "reprovada"}
    else:  # devolvida: só estado do BOX21 (a PR segue pendente no Sienge p/ o solicitante)
        novo = {"status": "devolvida"}

    # 1) reserva a transição (ninguém mais age nesta etapa a partir daqui)
    try:
        feito = supa.aprov_transicionar(pr, status_exigido, novo)
    except supa.AuthError as e:
        raise HTTPException(e.status, e.msg)
    if not feito:
        raise HTTPException(409, "Outra pessoa acabou de agir nesta solicitação. Atualize a tela.")

    # 2) escreve no Sienge quando a ação exige; se falhar, desfaz a transição
    toca_sienge = (acao == "aprovada" and etapa == "planejamento") or acao == "reprovada"
    if toca_sienge and not _modo_demo():
        try:
            if acao == "aprovada":
                sienge.solic_autorizar(pr)
            else:
                sienge.solic_reprovar(pr, obs)
        except Exception as e:
            desfaz = {"status": status_exigido, **{k: None for k in carimbo}}
            if "autorizado_sienge" in novo:
                desfaz["autorizado_sienge"] = False
            supa.aprov_transicionar(pr, novo["status"], desfaz)
            msg = e.mensagem if isinstance(e, sienge.SiengeError) else \
                "O Sienge não respondeu. Nada foi alterado no BOX21; confira no Sienge e tente de novo."
            raise HTTPException(422, msg)
        _PEND_CACHE["ts"] = 0.0

    # 3) linha do tempo
    try:
        supa.aprov_evento(pr, etapa, acao, usuario, obs)
        if acao == "aprovada" and etapa == "planejamento":
            supa.aprov_evento(pr, "compras", "autorizada_sienge", usuario,
                              "Autorizada no Sienge — enviada para Compras")
    except supa.AuthError:
        pass  # o estado já mudou (e o Sienge também); o evento é complementar
    return {"ok": True, "aprovacao": feito}


@app.post("/api/estoque/pedidos/atualizar")
def atualizar_pedidos(obra: str = Query(...), usuario: str = Depends(acesso("fornecedores", "recebimentos", "suprimentos"))):
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
            usuario: str = Depends(acesso("posicao"))):
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
def atualizar_grupos(usuario: str = Depends(acesso("posicao"))):
    """Dispara a coleta do mapa insumo→grupo em segundo plano (~11 min: o Sienge
    leva ~30s por página). Retorna na hora; o mapa atualiza quando terminar."""
    if _modo_demo():
        return {"ok": True, "n": 0, "modo": "demo"}
    if not _COLETA_GRUPOS["rodando"]:
        import threading
        threading.Thread(target=_coletar_grupos_bg, daemon=True).start()
    return {"ok": True, "rodando": True, "atual": len(grupos_sienge.carregar())}


@app.get("/api/estoque/catalogo")
def catalogo(obra: str = Query(...), usuario: str = Depends(acesso("operar", "requisicao"))):
    obra_ou_erro(obra)
    est = _analise(obra)
    # catálogo = itens com grupo/macro/saldo/consumo (sem os blocos de alerta) + o que está
    # RESERVADO por requisições aprovadas e ainda não entregues (disponível = saldo - reservado)
    res = operacoes.reservas_por_insumo(obra)
    itens = [{**i, "reservado": round(res[i["resource_id"]], 4)} if i["resource_id"] in res else i
             for i in est["itens"]]
    return {"itens": itens, "macro_ordem": _macros_presentes(est["itens"])}


@app.get("/api/estoque/insumos")
def insumos(obra: str = Query(...), q: str = "",
            usuario: str = Depends(acesso("estoque", "operar", "requisicao"))):
    obra_ou_erro(obra)
    est = _analise(obra)
    ql = q.lower().strip()
    itens = est["itens"]
    if ql:
        itens = [i for i in itens
                 if ql in i["descricao"].lower() or ql == i["resource_id"]]
    return {"itens": itens[:100]}


@app.get("/api/estoque/movimentos")
def movimentos(obra: str = Query(...), usuario: str = Depends(acesso("historico", "requisicao"))):
    obra_ou_erro(obra)
    return {"itens": audit.historico(obra)}


def _macros_presentes(itens):
    from taxonomia import MACRO_FAMILIA_ORDEM
    presentes = {i["macro"] for i in itens}
    return [m for m in MACRO_FAMILIA_ORDEM if m in presentes]


# ---------------------------------------------------------------- escrita

class ItemEscrita(BaseModel):
    resource_id: str
    quantidade: float                 # sempre na unidade-base do Sienge (o front converte a embalagem)
    unidade: str | None = None
    descricao: str | None = None
    detail_id: int | None = None      # variação (ex.: cor) — o saldo é indexado por isto
    trademark_id: int | None = None   # marca
    variante: str | None = None       # rótulo legível (cor/marca) p/ auditoria
    embalagem: str | None = None      # ex.: "Rolo (100 m)" — só p/ registro
    fator_embalagem: float | None = None


class EapRef(BaseModel):
    """Subetapa do orçamento (EAP/WBS) onde o material vai ser aplicado."""
    uc_id: int | None = None          # unidade construtiva (o mesmo código existe em várias)
    codigo: str
    descricao: str | None = None


class Escrita(BaseModel):
    itens: list[ItemEscrita]
    terceiro: str | None = None       # quem retira o material (requisição/retirada)
    solicitante: str | None = None    # quem solicitou
    eap: EapRef | None = None         # subetapa do consumo (vale para todos os itens da cesta)
    motivo: str | None = None         # devolução / saída avulsa / ajuste
    condicao: str | None = None       # devolução: novo | reaproveitavel


class Estorno(BaseModel):
    auditoria_id: int


# semântica adotada. documentId confirmados nos movimentos REAIS do Sienge:
# tipo 2 (Consumo)->REQ ; tipo 9 (Entrada Avulsa)->INIE ; tipo 10 (Saída Avulsa)->INIE
_OP = {
    "baixa": (2, "REQ"),            # Consumo
    "entrada": (9, "INIE"),         # Inicialização - Entrada Avulsa
    "devolucao": (9, "INIE"),       # sobra que volta da frente de obra (com motivo e condição)
    "saida": (10, "INIE"),          # Saída Avulsa com motivo (perda, devolução ao fornecedor, venda…)
    "transf_saida": (10, "INIE"),   # transferência: sai da obra de origem
    "transf_entrada": (9, "INIE"),  # transferência: entra na obra de destino
    "transf_retorno": (9, "INIE"),  # transferência cancelada: volta para a origem
    "ajuste_mais": (9, "INIE"),     # inventário: sobra
    "ajuste_menos": (10, "INIE"),   # inventário: falta
}
_ROTULO_OP = {"devolucao": "devolução", "saida": "saída avulsa", "transf_saida": "transferência (saída)",
              "transf_entrada": "transferência (entrada)", "transf_retorno": "transferência cancelada",
              "ajuste_mais": "ajuste de inventário (+)", "ajuste_menos": "ajuste de inventário (-)"}
_MOTIVOS_SAIDA = ("perda", "avaria", "devolucao_fornecedor", "venda", "doacao", "outro")


def _preco_unit(prevision_id: str, rid) -> float:
    for i in _analise(prevision_id)["itens"]:
        if i["resource_id"] == str(rid):
            return i.get("custo_unit") or 0.0
    return 0.0


def _gravar_avulso(cost_center_id, prevision_id, tipo_id, doc, hoje,
                   rid, qtd, unid, notes, detail_id=None, trademark_id=None, preco=None):
    """Cria movimento de entrada/saída AVULSA (tipo 9/10). O Sienge exige:
    unitPrice (nas entradas) + buildingAppropriations somando 100% num item de
    orçamento (WBS) NÃO bloqueado. Tenta cada item de orçamento até um aceitar.
    A apropriação e o saldo são indexados por detalhe/marca — por isso repassamos
    detailId/trademarkId tanto na busca quanto no item do movimento."""
    cands = sienge.buscar_apropriacao(cost_center_id, rid,
                                      detail_id=detail_id, trademark_id=trademark_id)
    if not cands:
        raise HTTPException(422, f"Insumo {rid} não tem apropriação de obra "
                            "configurada no Sienge — não dá para registrar entrada/estorno.")
    base_item = {"resourceId": int(rid) if str(rid).isdigit() else rid,
                 "quantity": qtd, "unitOfMeasure": unid}
    if detail_id is not None:
        base_item["detailId"] = detail_id
    if trademark_id is not None:
        base_item["trademarkId"] = trademark_id
    if tipo_id == 9:  # entrada exige preço unitário (transferência: o custo da obra de origem)
        base_item["unitPrice"] = round(preco or _preco_unit(prevision_id, rid) or 0.01, 4)
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


# ---- escrita segura: auditoria antes do Sienge + idempotência -----------------
# Cada item vira uma linha de auditoria com status "pendente" ANTES do POST ao
# Sienge; depois vira "gravado" (com o id do Sienge) ou "falhou". Se a auditoria
# não grava, nada vai ao Sienge. O front manda um Idempotency-Key por cesta: cada
# item ganha uma chave derivada (única no banco), então repetir a mesma cesta não
# reenvia o que já foi gravado — e bloqueia (409) o que ficou sem confirmação.
_CHAVE_RE = re.compile(r"^[A-Za-z0-9-]{8,64}$")


def _chave_valida(chave: str | None) -> str | None:
    if chave is None or chave == "":
        return None
    if not _CHAVE_RE.match(chave):
        raise HTTPException(422, "Idempotency-Key inválida.")
    return chave


def _chaves_itens(chave: str | None, itens: list[ItemEscrita]) -> list[str | None]:
    """Chave por item = chave da cesta + hash da assinatura do item (e da ocorrência,
    se a mesma linha aparecer 2x). Não depende da posição na cesta."""
    if not chave:
        return [None] * len(itens)
    vistos: Counter = Counter()
    out = []
    for i in itens:
        sig = f"{i.resource_id}|{i.detail_id}|{i.trademark_id}|{i.quantidade}|{i.unidade}"
        vistos[sig] += 1
        h = hashlib.sha1(f"{sig}#{vistos[sig]}".encode()).hexdigest()[:16]
        out.append(f"{chave}:{h}")
    return out


def _item_audit(i: ItemEscrita, chave: str | None, eap: EapRef | None = None) -> dict:
    d = {"resource_id": i.resource_id, "quantidade": i.quantidade, "unidade": i.unidade,
         "descricao": i.descricao, "detail_id": i.detail_id, "trademark_id": i.trademark_id,
         "variante": i.variante, "embalagem": i.embalagem,
         "fator_embalagem": i.fator_embalagem, "chave_idempotencia": chave}
    if eap is not None:
        d.update(eap_uc_id=eap.uc_id, eap_codigo=eap.codigo, eap_descricao=eap.descricao)
    return d


def _registrar_pendente(**kw) -> list[int]:
    """Grava a auditoria como pendente; conflito de chave = a mesma cesta já está sendo gravada."""
    kw["extra"] = {k: v for k, v in (kw.get("extra") or {}).items() if v is not None} or None
    try:
        return audit.registrar(status="pendente", sienge_status=None, sienge_movement_id=None,
                               sienge_resposta=None, **kw)
    except supa.AuthError as e:
        if e.status == 409:
            raise HTTPException(409, "Esta mesma cesta já está sendo gravada. Aguarde e confira o Histórico.")
        raise HTTPException(e.status or 503, e.msg)
    except Exception as e:
        if "unique" in str(e).lower():
            raise HTTPException(409, "Esta mesma cesta já está sendo gravada. Aguarde e confira o Histórico.")
        raise HTTPException(503, f"Não foi possível registrar a auditoria; nada foi gravado no Sienge. ({e})")


_MSG_SEM_CONFIRMACAO = ("O Sienge não confirmou a gravação (falha de comunicação) — ela PODE ter sido "
                        "registrada. Confira no Sienge antes de repetir. O item ficou como "
                        "'sem confirmação' no Histórico.")


def _marcar_falha(ids: list[int], **kw):
    """Registra a recusa do Sienge; se o banco falhar aqui, não esconde a mensagem do Sienge."""
    try:
        audit.atualizar(ids, **kw)
    except Exception:
        pass


def _fechar_gravado(ids: list[int], resp: dict) -> str | None:
    """Marca as linhas como gravadas. O Sienge JÁ gravou: se a auditoria falhar aqui,
    não devolve erro (o usuário repetiria e duplicaria) — devolve um aviso."""
    try:
        audit.atualizar(ids, status="gravado", sienge_status=resp["status"],
                        sienge_movement_id=resp["movement_id"], sienge_resposta=resp["resposta"])
        return None
    except Exception:
        return ("Gravado no Sienge, mas o Histórico não foi atualizado — o registro aparece "
                "como 'sem confirmação'. Não repita a operação.")


def _gravar(prevision_id, operacao, corpo: Escrita, usuario, chave: str | None,
            extra: dict | None = None, precos: dict | None = None):
    """Grava a cesta no Sienge com auditoria antes e idempotência por item.
    `extra` = vínculos gravados em cada linha (transferência, requisição, contagem...).
    `precos` = resource_id -> preço unitário das entradas (transferência usa o da origem)."""
    o = obra_ou_erro(prevision_id)
    tipo_id, doc = _OP[operacao]
    hoje = date.today().isoformat()
    notes = f"Via app BOX21 ({_ROTULO_OP.get(operacao, operacao)}) por {usuario}"
    if corpo.terceiro:
        notes += f" | Retirada: {corpo.terceiro}"
    if corpo.solicitante:
        notes += f" | Solic.: {corpo.solicitante}"
    if corpo.eap:
        notes += f" | EAP: {corpo.eap.codigo} {(corpo.eap.descricao or '')[:60]}".rstrip()
    extra = {**(extra or {}), "motivo": corpo.motivo, "condicao": corpo.condicao}
    if extra.get("motivo"):
        notes += f" | Motivo: {extra['motivo']}"
    if extra.get("obra_contraparte"):
        notes += f" | Obra: {extra['obra_contraparte']}"

    # 1) idempotência: o que desta cesta já foi gravado / ficou sem confirmação?
    chaves = _chaves_itens(chave, corpo.itens)
    existentes = {r["chave_idempotencia"]: r for r in audit.por_chaves([c for c in chaves if c])} if chave else {}
    if any(r.get("status") == "pendente" for r in existentes.values()):
        raise HTTPException(409, "Uma gravação anterior desta mesma cesta ficou sem confirmação do "
                            "Sienge. Confira no Sienge/Histórico antes de repetir.")
    ja_ids = [existentes[c]["id"] for c in chaves if c in existentes]
    fila = [(i, c) for i, c in zip(corpo.itens, chaves) if c not in existentes]
    if not fila:  # tudo já tinha sido gravado (ex.: a resposta anterior se perdeu na rede)
        return {"ok": True, "modo": "demo" if _modo_demo() else "sienge", "repetida": True,
                "sienge": None, "auditoria_ids": ja_ids}

    base = dict(usuario=usuario, obra=prevision_id, operacao=operacao, movement_type_id=tipo_id,
                document_id=doc, movement_date=hoje, terceiro=corpo.terceiro,
                solicitante=corpo.solicitante, extra=extra)

    if operacao == "baixa":
        # consumo (tipo 2): um único movimento com N linhas -> tudo ou nada
        ids = _registrar_pendente(itens=[_item_audit(i, c, corpo.eap) for i, c in fila], **base)
        itens_sienge = []
        for i, _ in fila:
            it = {"resourceId": int(i.resource_id) if str(i.resource_id).isdigit() else i.resource_id,
                  "quantity": i.quantidade, "unitOfMeasure": i.unidade or ""}
            if i.detail_id is not None:
                it["detailId"] = i.detail_id
            if i.trademark_id is not None:
                it["trademarkId"] = i.trademark_id
            itens_sienge.append(it)
        if _modo_demo():
            resp = {"status": 201, "movement_id": f"DEMO-{operacao}", "resposta": {"demo": True}}
        else:
            try:
                resp = sienge.criar_movimento(o["cost_center_id"], tipo_id, doc, hoje,
                                              itens_sienge, notes=notes)
            except sienge.SiengeError as e:
                _marcar_falha(ids, status="falhou", sienge_status=e.status, erro=e.mensagem[:500],
                                liberar_chave=True)
                raise HTTPException(422, e.mensagem)
            except Exception:
                raise HTTPException(502, _MSG_SEM_CONFIRMACAO)
        aviso = _fechar_gravado(ids, resp)
        _anexar_local(prevision_id, [i for i, _ in fila], tipo_id)
        return {"ok": True, "modo": "demo" if _modo_demo() else "sienge", "repetida": False,
                "sienge": resp, "auditoria_ids": ja_ids + ids, "aviso": aviso}

    # avulsos (tipo 9/10): o Sienge exige um movimento por item -> item a item, com status
    # próprio; se um falha, os anteriores ficam gravados e a resposta diz quantos foram.
    gravados_ids: list[int] = []
    gravados: list[ItemEscrita] = []
    precos_ok: dict = {}
    resp = None
    aviso = None
    for i, c in fila:
        ids = _registrar_pendente(itens=[_item_audit(i, c, corpo.eap)], **base)
        preco = round((precos or {}).get(str(i.resource_id))
                      or _preco_unit(prevision_id, i.resource_id) or 0.01, 4)
        try:
            if _modo_demo():
                resp = {"status": 201, "movement_id": f"DEMO-{operacao}", "resposta": {"demo": True}}
            else:
                resp = _gravar_avulso(o["cost_center_id"], prevision_id, tipo_id, doc, hoje,
                                      i.resource_id, i.quantidade, i.unidade or "", notes,
                                      detail_id=i.detail_id, trademark_id=i.trademark_id,
                                      preco=preco if tipo_id == 9 else None)
        except HTTPException as e:  # recusa definitiva do Sienge
            _marcar_falha(ids, status="falhou", sienge_status=e.status_code,
                            erro=str(e.detail)[:500], liberar_chave=True)
            _anexar_local(prevision_id, gravados, tipo_id, precos_ok)
            nome = i.descricao or f"#{i.resource_id}"
            ja = len(ja_ids) + len(gravados)
            raise HTTPException(422, f"{e.detail} — item '{nome}'. " + (
                f"{ja} de {len(corpo.itens)} item(ns) já estão gravados no Sienge; "
                "grave de novo a mesma cesta que só os que faltam serão enviados." if ja else
                "Nada desta cesta foi gravado."))
        except Exception:
            _anexar_local(prevision_id, gravados, tipo_id, precos_ok)
            raise HTTPException(502, _MSG_SEM_CONFIRMACAO)
        aviso = _fechar_gravado(ids, resp) or aviso
        gravados_ids += ids
        gravados.append(i)
        precos_ok[str(i.resource_id)] = preco
    _anexar_local(prevision_id, gravados, tipo_id, precos_ok)
    return {"ok": True, "modo": "demo" if _modo_demo() else "sienge", "repetida": False,
            "sienge": resp, "auditoria_ids": ja_ids + gravados_ids, "aviso": aviso}


@app.post("/api/estoque/baixa")
def baixa(corpo: Escrita, obra: str = Query(...),
          idempotency_key: str | None = Header(default=None),
          usuario: str = Depends(operador("operar", "requisicao"))):
    if not corpo.itens:
        raise HTTPException(400, "Nenhum item informado")
    return _gravar(obra, "baixa", corpo, usuario, _chave_valida(idempotency_key))


@app.post("/api/estoque/entrada")
def entrada(corpo: Escrita, obra: str = Query(...),
            idempotency_key: str | None = Header(default=None),
            usuario: str = Depends(operador("operar"))):
    if not corpo.itens:
        raise HTTPException(400, "Nenhum item informado")
    return _gravar(obra, "entrada", corpo, usuario, _chave_valida(idempotency_key))


_CONDICOES = ("novo", "reaproveitavel")


@app.post("/api/estoque/devolucao")
def devolucao(corpo: Escrita, obra: str = Query(...),
              idempotency_key: str | None = Header(default=None),
              usuario: str = Depends(operador("operar"))):
    """Sobra que volta da frente de obra para o almoxarifado (entrada com motivo e condição).
    Material avariado não volta para o saldo: registre como saída avulsa (avaria)."""
    if not corpo.itens:
        raise HTTPException(400, "Nenhum item informado")
    if not (corpo.motivo or "").strip():
        raise HTTPException(422, "Informe o motivo da devolução.")
    if corpo.condicao not in _CONDICOES:
        raise HTTPException(422, "Informe a condição do material (novo ou reaproveitável). "
                            "Avariado não volta para o estoque.")
    return _gravar(obra, "devolucao", corpo, usuario, _chave_valida(idempotency_key))


@app.post("/api/estoque/saida")
def saida_avulsa(corpo: Escrita, obra: str = Query(...),
                 idempotency_key: str | None = Header(default=None),
                 usuario: str = Depends(operador("operar", "transferencias"))):
    """Saída avulsa com motivo: perda, avaria, devolução ao fornecedor, venda, doação."""
    if not corpo.itens:
        raise HTTPException(400, "Nenhum item informado")
    if corpo.motivo not in _MOTIVOS_SAIDA:
        raise HTTPException(422, "Motivo inválido. Use: " + ", ".join(_MOTIVOS_SAIDA) + ".")
    return _gravar(obra, "saida", corpo, usuario, _chave_valida(idempotency_key))


@app.post("/api/estoque/estorno")
def estorno(corpo: Estorno, usuario: str = Depends(usuario_admin)):
    linha = audit.por_id(corpo.auditoria_id)
    if not linha:
        raise HTTPException(404, "Registro de auditoria não encontrado")
    prevision_id = linha["obra"]
    _checar_acesso(usuario, prevision_id, ("historico",))
    if linha["operacao"] == "estorno":
        raise HTTPException(400, "Não se estorna um estorno.")
    if str(linha["operacao"]).startswith("transf_"):
        raise HTTPException(400, "Movimento de transferência: use Transferências (cancelar/receber), "
                            "não o estorno.")
    if (linha.get("status") or "gravado") != "gravado":
        raise HTTPException(409, "Só dá para estornar movimentos confirmados no Sienge.")
    o = obra_ou_erro(prevision_id)

    # reserva atômica: um segundo clique/aba recebe 409 em vez de gerar outro compensatório
    if not audit.reservar_estorno(corpo.auditoria_id):
        raise HTTPException(409, "Este movimento já foi estornado (ou está sendo estornado agora).")

    # estorno = movimento compensatório na direção oposta (documentId INIE = avulso)
    if int(linha.get("movement_type_id") or 0) in (2, 10):
        tipo_id, doc = 9, "INIE"    # era saída (consumo/avulsa): devolve ao saldo
    else:
        tipo_id, doc = 10, "INIE"   # era entrada: retira do saldo
    hoje = date.today().isoformat()
    notes = f"Via app BOX21 (estorno de #{corpo.auditoria_id}) por {usuario}"
    item = ItemEscrita(resource_id=linha["resource_id"], quantidade=linha["quantidade"],
                       unidade=linha.get("unidade"), descricao=linha.get("descricao"),
                       detail_id=linha.get("detail_id"), trademark_id=linha.get("trademark_id"),
                       variante=linha.get("variante"))
    try:
        ids = _registrar_pendente(itens=[_item_audit(item, None)], usuario=usuario,
                                  obra=prevision_id, operacao="estorno", movement_type_id=tipo_id,
                                  document_id=doc, movement_date=hoje, estorno_de=corpo.auditoria_id)
    except HTTPException:
        audit.liberar_estorno(corpo.auditoria_id)
        raise

    if _modo_demo():
        resp = {"status": 201, "movement_id": "DEMO-estorno", "resposta": {"demo": True}}
    else:
        try:
            # a MESMA variação (cor/detalhe/marca) da baixa/entrada original
            resp = _gravar_avulso(o["cost_center_id"], prevision_id, tipo_id, doc, hoje,
                                  item.resource_id, item.quantidade, item.unidade or "", notes,
                                  detail_id=item.detail_id, trademark_id=item.trademark_id)
        except HTTPException as e:
            _marcar_falha(ids, status="falhou", sienge_status=e.status_code, erro=str(e.detail)[:500])
            audit.liberar_estorno(corpo.auditoria_id)
            raise
        except Exception:
            raise HTTPException(502, _MSG_SEM_CONFIRMACAO)  # mantém reservado: não estornar 2x

    aviso = _fechar_gravado(ids, resp)
    preco = {str(item.resource_id): round(_preco_unit(prevision_id, item.resource_id), 4)} if tipo_id == 9 else None
    _anexar_local(prevision_id, [item], tipo_id, preco)
    return {"ok": True, "auditoria_ids": ids, "sienge": resp, "aviso": aviso}


# ---- passos 08-10: EAP no consumo, transferências, requisições e inventário ----
import operacoes  # noqa: E402  (usa os helpers acima)
app.include_router(operacoes.router)

# ---- gestão de usuários (status de acesso, link de convite, histórico) ----
import usuarios  # noqa: E402
app.include_router(usuarios.router)
