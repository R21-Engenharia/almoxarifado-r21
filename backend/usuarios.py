"""Gestão de usuários do BOX21 (só backend, service_role).

- Lista com o STATUS real de cada pessoa: cruza authorized_emails (permissões) com
  as contas do Supabase Auth (já entrou? quando?) e com o perfil que ela preencheu (foto).
- Link de acesso: gera o link de convite (conta nova) ou de "defina sua senha" (conta
  que já existe) SEM depender do envio de e-mail do Supabase — o gestor manda por
  WhatsApp/e-mail. Quem usa Google pode simplesmente entrar com o Google.
- Toda alteração de permissão fica registrada em usuarios_eventos (quem, quando, o quê).
Tabelas/colunas: backend/schema_migra_2026_09_D.sql.
"""
from __future__ import annotations
import os
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

import app as A
import supa

router = APIRouter()

PAPEIS = ("user", "engenheiro", "planejamento", "admin")
_CAMPOS = ("nome", "cargo", "tipo", "ativo", "role", "perfil", "modulos", "obras",
           "gerenciar_usuarios", "operar", "gerar_plano")


class UsuarioIn(BaseModel):
    email: str
    nome: str | None = None
    cargo: str | None = None
    tipo: str | None = "Geral"
    ativo: bool = True
    role: str | None = "user"
    perfil: str | None = None
    modulos: list[str] = []
    obras: list[str] = []
    gerenciar_usuarios: bool = False
    operar: bool = False
    gerar_plano: bool = False


class LinkIn(BaseModel):
    email: str
    redirect_to: str | None = None


# ---------------------------------------------------------------- Supabase Auth (admin)
def _auth_admin(method: str, path: str, **kw) -> httpx.Response:
    with httpx.Client(timeout=supa.TIMEOUT) as c:
        return c.request(method, f"{supa._url()}/auth/v1{path}", headers=supa._headers_admin(), **kw)


def _contas_auth() -> dict[str, dict]:
    """email -> conta do Supabase Auth (último acesso, convite, provedores)."""
    out, pagina = {}, 1
    while True:
        r = _auth_admin("GET", "/admin/users", params={"page": pagina, "per_page": 200})
        if r.status_code >= 400:
            return out   # sem service_role: a lista sai sem o status de acesso
        users = (r.json() or {}).get("users") or []
        for u in users:
            if u.get("email"):
                out[u["email"].lower()] = u
        if len(users) < 200:
            return out
        pagina += 1


def _fotos() -> dict[str, dict]:
    try:
        with httpx.Client(timeout=supa.TIMEOUT) as c:
            r = c.get(f"{supa._url()}/rest/v1/perfis", params={"select": "email,nome,foto_url"},
                      headers=supa._headers_admin())
        return {(p.get("email") or "").lower(): p for p in (r.json() if r.status_code == 200 else [])}
    except Exception:
        return {}


def _status(row: dict, conta: dict | None) -> dict:
    ult = (conta or {}).get("last_sign_in_at")
    provs = ((conta or {}).get("app_metadata") or {}).get("providers") or []
    if row.get("ativo") is False:
        st = "inativo"
    elif ult:
        st = "ativo"
    elif conta and conta.get("invited_at"):
        st = "convidado"
    else:
        st = "sem_acesso"
    return {"status": st, "ultimo_acesso": ult, "convidado_em": (conta or {}).get("invited_at"),
            "provedores": provs, "tem_conta": bool(conta)}


# ---------------------------------------------------------------- eventos (quem mudou o quê)
_EV = "/rest/v1/usuarios_eventos"


def _evento(por: str, email: str, acao: str, antes: dict | None = None, depois: dict | None = None):
    try:
        with httpx.Client(timeout=supa.TIMEOUT) as c:
            c.post(f"{supa._url()}{_EV}", headers=supa._headers_admin(),
                   json={"por": por, "email": email, "acao": acao, "antes": antes, "depois": depois})
    except Exception:
        pass  # o registro é complementar: nunca impede a alteração


def _diff(antes: dict, depois: dict) -> tuple[dict, dict]:
    a, d = {}, {}
    for k in _CAMPOS:
        va, vd = antes.get(k), depois.get(k)
        if isinstance(va, list) or isinstance(vd, list):
            va, vd = sorted(va or []), sorted(vd or [])
        if va != vd:
            a[k], d[k] = antes.get(k), depois.get(k)
    return a, d


# ---------------------------------------------------------------- rotas
@router.get("/api/usuarios")
def listar(usuario: str = Depends(A.usuario_gestor)):
    if not A._auth_ativo():
        return {"usuarios": [], "modulos": A._MODULOS}
    contas, fotos = _contas_auth(), _fotos()
    out = []
    for r in supa.listar_usuarios():
        email = (r.get("email") or "").lower()
        p = A._perfil_norm(r, email)
        f = fotos.get(email) or {}
        out.append({**p, "nome": p["nome"] or f.get("nome"), "foto_url": f.get("foto_url"),
                    "atualizado_em": r.get("atualizado_em"), "atualizado_por": r.get("atualizado_por"),
                    **_status(r, contas.get(email))})
    return {"usuarios": out, "modulos": A._MODULOS}


@router.post("/api/usuarios")
def salvar(corpo: UsuarioIn, usuario: str = Depends(A.usuario_gestor)):
    email = (corpo.email or "").strip().lower()
    if not email or "@" not in email or " " in email:
        raise HTTPException(422, "E-mail inválido.")
    role = (corpo.role or "user").lower()
    if role not in PAPEIS:
        raise HTTPException(422, "Papel inválido.")
    modulos = [m for m in corpo.modulos if m in A._MODULOS]
    if role != "admin" and not modulos:
        raise HTTPException(422, "Marque ao menos um módulo (ou escolha o perfil Administrador).")
    obras = [o for o in corpo.obras if o in A.OBRAS]
    if len(obras) != len(corpo.obras):
        raise HTTPException(422, "Obra desconhecida na lista.")
    eu = usuario.lower() == email
    if eu and not corpo.ativo:
        raise HTTPException(422, "Você não pode inativar a sua própria conta.")
    if eu and not (corpo.gerenciar_usuarios or role == "admin"):
        raise HTTPException(422, "Você não pode tirar de si mesmo a gestão de usuários.")

    antes = next((r for r in supa.listar_usuarios() if (r.get("email") or "").lower() == email), None)
    dados = {**corpo.model_dump(), "email": email, "role": role, "modulos": [] if role == "admin" else modulos,
             "obras": obras, "nome": (corpo.nome or "").strip() or None, "cargo": (corpo.cargo or "").strip() or None,
             "atualizado_em": datetime.now(timezone.utc).isoformat(), "atualizado_por": usuario}
    try:
        salvo = supa.upsert_usuario(dados)
    except supa.AuthError as e:
        if "perfil" in e.msg or "atualizado" in e.msg or "PGRST204" in e.msg:
            raise HTTPException(503, "Banco desatualizado: rode backend/schema_migra_2026_09_D.sql no Supabase.")
        raise HTTPException(e.status if getattr(e, "status", 0) else 422, e.msg)
    if antes is None:
        _evento(usuario, email, "criado", None, {k: dados.get(k) for k in _CAMPOS})
    else:
        a, d = _diff(antes, dados)
        if d:
            acao = "inativado" if d.get("ativo") is False else "reativado" if d.get("ativo") is True else "alterado"
            _evento(usuario, email, acao, a, d)
    return A._perfil_norm(salvo, email)


def _redirect_ok(url: str | None) -> str | None:
    """Só aceita voltar para o próprio app (origens do CORS ou localhost)."""
    if not url:
        return None
    origens = [o.strip().rstrip("/") for o in os.environ.get("ALMOX_CORS_ORIGINS", "").split(",") if o.strip()]
    u = url.rstrip("/")
    if u in origens or u.startswith("http://localhost") or u.startswith("http://127.0.0.1"):
        return u
    return None


@router.post("/api/usuarios/link")
def link_acesso(corpo: LinkIn, usuario: str = Depends(A.usuario_gestor)):
    """Link de primeiro acesso (convite) ou de redefinir senha, para o gestor enviar."""
    email = (corpo.email or "").strip().lower()
    row = next((r for r in supa.listar_usuarios() if (r.get("email") or "").lower() == email), None)
    if not row:
        raise HTTPException(404, "Cadastre o usuário antes de gerar o link.")
    if row.get("ativo") is False:
        raise HTTPException(422, "Usuário inativo: reative antes de gerar o link.")
    base = {"email": email}
    red = _redirect_ok(corpo.redirect_to)
    if red:
        base["redirect_to"] = red
    tipo = "invite"
    r = _auth_admin("POST", "/admin/generate_link", json={**base, "type": "invite"})
    if r.status_code >= 400:   # a conta já existe (Google ou convite anterior): link de definir senha
        tipo = "recovery"
        r = _auth_admin("POST", "/admin/generate_link", json={**base, "type": "recovery"})
    if r.status_code >= 400:
        raise HTTPException(502, f"O Supabase não gerou o link ({r.status_code}): {(r.text or '')[:160]}")
    j = r.json() or {}
    link = j.get("action_link") or (j.get("properties") or {}).get("action_link")
    if not link:
        raise HTTPException(502, "O Supabase não devolveu o link.")
    _evento(usuario, email, "link_gerado", None, {"tipo": tipo})
    return {"link": link, "tipo": tipo}


@router.get("/api/usuarios/eventos")
def eventos(email: str = Query(...), usuario: str = Depends(A.usuario_gestor)):
    if not A._auth_ativo():
        return {"eventos": []}
    with httpx.Client(timeout=supa.TIMEOUT) as c:
        r = c.get(f"{supa._url()}{_EV}", params={"email": f"eq.{email.lower()}", "order": "quando.desc", "limit": 50},
                  headers=supa._headers_admin())
    return {"eventos": r.json() if r.status_code == 200 else []}
