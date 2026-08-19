"""Integração com o Supabase: autenticação (valida o token do usuário) e
auditoria (tabela estoque_movimentos no Postgres, via REST).

Reusa o MESMO projeto Supabase do app de validação. Env:
  SUPABASE_URL   -> https://<ref>.supabase.co
  SUPABASE_KEY   -> chave anon (pública, protegida por RLS)

O login em si é feito no frontend (Supabase Auth). Aqui só validamos o token
recebido e checamos se o e-mail está em `authorized_emails` (e se é admin).
"""
from __future__ import annotations
import os
import time
import httpx

TIMEOUT = 30.0


def _url() -> str:
    return (os.environ.get("SUPABASE_URL") or "").rstrip("/")


def _key() -> str:
    return os.environ.get("SUPABASE_KEY") or ""


def configurado() -> bool:
    return bool(_url() and _key())


def _headers(token: str | None = None) -> dict:
    h = {"apikey": _key(), "Content-Type": "application/json"}
    h["Authorization"] = f"Bearer {token or _key()}"
    return h


# ---------------------------------------------------------------- auth

class AuthError(Exception):
    def __init__(self, msg: str, status: int = 401):
        super().__init__(msg)
        self.msg = msg
        self.status = status


# cache curto de (email -> role) e (token -> (email, expira))
_ROLE_CACHE: dict[str, tuple[str | None, float]] = {}
_TOKEN_CACHE: dict[str, tuple[str, float]] = {}
_TTL = 300  # 5 min


def email_do_token(token: str) -> str:
    """Valida o access_token no Supabase Auth e devolve o e-mail do usuário."""
    agora = time.time()
    c = _TOKEN_CACHE.get(token)
    if c and c[1] > agora:
        return c[0]
    with httpx.Client(timeout=TIMEOUT) as cli:
        r = cli.get(f"{_url()}/auth/v1/user", headers=_headers(token))
    if r.status_code != 200:
        raise AuthError("Sessão inválida ou expirada. Entre novamente.", 401)
    email = (r.json() or {}).get("email")
    if not email:
        raise AuthError("Não foi possível identificar o usuário.", 401)
    _TOKEN_CACHE[token] = (email, agora + _TTL)
    return email


def role_do_email(email: str) -> str | None:
    """Consulta authorized_emails. Retorna a role ('admin'/'user'/...) ou None
    se o e-mail não estiver autorizado."""
    agora = time.time()
    c = _ROLE_CACHE.get(email)
    if c and c[1] > agora:
        return c[0]
    with httpx.Client(timeout=TIMEOUT) as cli:
        r = cli.get(f"{_url()}/rest/v1/authorized_emails",
                    params={"email": f"eq.{email}", "select": "email,role"},
                    headers=_headers())
    role = None
    if r.status_code == 200 and r.json():
        role = (r.json()[0].get("role") or "user")
    _ROLE_CACHE[email] = (role, agora + _TTL)
    return role


# ---------------------------------------------------------------- auditoria

TBL = "/rest/v1/estoque_movimentos"


def registrar(usuario, obra, operacao, movement_type_id, document_id,
              movement_date, sienge_status, sienge_movement_id, sienge_resposta,
              itens, estorno_de=None, terceiro=None, solicitante=None) -> list[int]:
    linhas = [{
        "usuario": usuario, "obra": str(obra),
        "resource_id": str(it["resource_id"]), "descricao": it.get("descricao"),
        "operacao": operacao, "movement_type_id": movement_type_id,
        "quantidade": float(it["quantidade"]), "unidade": it.get("unidade"),
        "document_id": document_id, "movement_date": movement_date,
        "sienge_status": sienge_status, "sienge_movement_id": str(sienge_movement_id or ""),
        "sienge_resposta": sienge_resposta, "estorno_de": estorno_de,
        "terceiro": terceiro, "solicitante": solicitante,
    } for it in itens]
    with httpx.Client(timeout=TIMEOUT) as cli:
        r = cli.post(f"{_url()}{TBL}", headers={**_headers(), "Prefer": "return=representation"},
                     json=linhas)
        r.raise_for_status()
        return [row["id"] for row in r.json()]


def historico(obra: str, limite: int = 200) -> list[dict]:
    with httpx.Client(timeout=TIMEOUT) as cli:
        r = cli.get(f"{_url()}{TBL}",
                    params={"obra": f"eq.{obra}", "order": "criado_em.desc", "limit": limite},
                    headers=_headers())
        r.raise_for_status()
        return r.json()


def por_id(aud_id: int) -> dict | None:
    with httpx.Client(timeout=TIMEOUT) as cli:
        r = cli.get(f"{_url()}{TBL}", params={"id": f"eq.{aud_id}", "limit": 1},
                    headers=_headers())
        r.raise_for_status()
        rows = r.json()
        return rows[0] if rows else None


def marcar_estornado(aud_id: int):
    with httpx.Client(timeout=TIMEOUT) as cli:
        cli.patch(f"{_url()}{TBL}", params={"id": f"eq.{aud_id}"},
                  headers=_headers(), json={"estornado": True})
