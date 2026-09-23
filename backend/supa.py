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


def _service_key() -> str:
    """Chave service_role (secreta, só no servidor) — ignora o RLS. Usada nas
    operações privilegiadas do backend (checar authorized_emails, auditoria).
    Cai na anon key se não estiver setada, pra não quebrar antes de configurar."""
    return os.environ.get("SUPABASE_SERVICE_KEY") or _key()


def configurado() -> bool:
    return bool(_url() and _key())


def _headers(token: str | None = None) -> dict:
    h = {"apikey": _key(), "Content-Type": "application/json"}
    h["Authorization"] = f"Bearer {token or _key()}"
    return h


def _headers_admin() -> dict:
    """Headers com a service_role key — para ler/gravar tabelas protegidas por RLS
    a partir do backend (o front nunca recebe esta chave)."""
    k = _service_key()
    return {"apikey": k, "Authorization": f"Bearer {k}", "Content-Type": "application/json"}


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


_AE = "/rest/v1/authorized_emails"


def perms_do_email(email: str) -> dict | None:
    """Linha completa de authorized_emails (perfil + permissões) ou None.
    Usuário INATIVO conta como não autorizado."""
    with httpx.Client(timeout=TIMEOUT) as cli:
        r = cli.get(f"{_url()}{_AE}", params={"email": f"eq.{email}", "select": "*", "limit": 1},
                    headers=_headers_admin())
    if r.status_code == 200 and r.json():
        row = r.json()[0]
        if row.get("ativo") is False:
            return None
        return row
    return None


_PERMS_CACHE: dict[str, tuple[dict | None, float]] = {}
_PERMS_TTL = 60  # curto: desativar alguém vale em até 1 min


def perms_cache(email: str) -> dict | None:
    """perms_do_email com cache curto — é consultado em TODA rota (checagem de obra/módulo)."""
    agora = time.time()
    c = _PERMS_CACHE.get(email)
    if c and c[1] > agora:
        return c[0]
    row = perms_do_email(email)
    _PERMS_CACHE[email] = (row, agora + _PERMS_TTL)
    return row


def role_do_email(email: str) -> str | None:
    """Retorna a role ('admin'/'user'/...) ou None se não autorizado/inativo."""
    agora = time.time()
    c = _ROLE_CACHE.get(email)
    if c and c[1] > agora:
        return c[0]
    row = perms_do_email(email)
    role = (row.get("role") or "user") if row else None
    _ROLE_CACHE[email] = (role, agora + _TTL)
    return role


# ---- gestão de usuários (só via backend, service_role) ----
def listar_usuarios() -> list[dict]:
    with httpx.Client(timeout=TIMEOUT) as cli:
        r = cli.get(f"{_url()}{_AE}", params={"select": "*", "order": "nome.asc"},
                    headers=_headers_admin())
        r.raise_for_status()
        return r.json()


def upsert_usuario(dados: dict) -> dict:
    """Cria/atualiza um usuário (chave = email). Invalida o cache de role."""
    _ROLE_CACHE.pop(dados.get("email", ""), None)
    _PERMS_CACHE.pop(dados.get("email", ""), None)
    with httpx.Client(timeout=TIMEOUT) as cli:
        r = cli.post(f"{_url()}{_AE}?on_conflict=email",
                     headers={**_headers_admin(), "Prefer": "resolution=merge-duplicates,return=representation"},
                     json=dados)
        if r.status_code >= 400:
            raise AuthError((r.text or "")[:200], r.status_code)
        j = r.json()
        return j[0] if isinstance(j, list) and j else (j or dados)


# ---------------------------------------------------------------- embalagens
_EMB = "/rest/v1/embalagens"


def listar_embalagens() -> list[dict]:
    """Todas as embalagens cadastradas (Rolo=100m, Caixa=50un, ...), por insumo."""
    with httpx.Client(timeout=TIMEOUT) as cli:
        r = cli.get(f"{_url()}{_EMB}", params={"select": "*", "order": "resource_id.asc,nome.asc"},
                    headers=_headers_admin())
        r.raise_for_status()
        return r.json()


def upsert_embalagem(dados: dict) -> dict:
    with httpx.Client(timeout=TIMEOUT) as cli:
        r = cli.post(f"{_url()}{_EMB}",
                     headers={**_headers_admin(), "Prefer": "return=representation"},
                     json=dados)
        if r.status_code >= 400:
            raise AuthError((r.text or "")[:200], r.status_code)
        j = r.json()
        return j[0] if isinstance(j, list) and j else (j or dados)


def deletar_embalagem(emb_id: str):
    with httpx.Client(timeout=TIMEOUT) as cli:
        r = cli.delete(f"{_url()}{_EMB}", params={"id": f"eq.{emb_id}"}, headers=_headers_admin())
        if r.status_code >= 400:
            raise AuthError((r.text or "")[:200], r.status_code)


# ---------------------------------------------------------------- auditoria
# Uma linha por item. status: pendente (enviado ao Sienge, sem confirmação) ->
# gravado | falhou. chave_idempotencia é única por item: repetir a gravação com
# a mesma chave não reenvia. Colunas novas vêm da migração schema_migra_2026_09_A.sql.

TBL = "/rest/v1/estoque_movimentos"
_CAMPOS_ITEM = ("detail_id", "trademark_id", "variante", "embalagem", "fator_embalagem",
                "chave_idempotencia")


def _checar(r: httpx.Response):
    """raise_for_status com mensagem útil quando falta a migração do banco."""
    if r.status_code >= 400:
        txt = r.text or ""
        if "PGRST204" in txt or "column" in txt.lower():
            raise AuthError("Banco desatualizado: rode backend/schema_migra_2026_09_A.sql "
                            "no SQL Editor do Supabase. (" + txt[:120] + ")", 503)
        raise AuthError(txt[:200] or f"Supabase {r.status_code}", r.status_code)


def _in(valores) -> str:
    """Filtro PostgREST in.(...) com aspas (as chaves têm ':')."""
    return "in.(" + ",".join(f'"{v}"' for v in valores) + ")"


def registrar(usuario, obra, operacao, movement_type_id, document_id,
              movement_date, sienge_status, sienge_movement_id, sienge_resposta,
              itens, estorno_de=None, terceiro=None, solicitante=None,
              status="gravado") -> list[int]:
    linhas = [{
        "usuario": usuario, "obra": str(obra),
        "resource_id": str(it["resource_id"]), "descricao": it.get("descricao"),
        "operacao": operacao, "movement_type_id": movement_type_id,
        "quantidade": float(it["quantidade"]), "unidade": it.get("unidade"),
        "document_id": document_id, "movement_date": movement_date,
        "sienge_status": sienge_status, "sienge_movement_id": str(sienge_movement_id or ""),
        "sienge_resposta": sienge_resposta, "estorno_de": estorno_de,
        "terceiro": terceiro, "solicitante": solicitante, "status": status,
        **{k: it.get(k) for k in _CAMPOS_ITEM},
    } for it in itens]
    with httpx.Client(timeout=TIMEOUT) as cli:
        r = cli.post(f"{_url()}{TBL}", headers={**_headers_admin(), "Prefer": "return=representation"},
                     json=linhas)
        _checar(r)
        return [row["id"] for row in r.json()]


def atualizar(ids: list[int], *, status=None, sienge_status=None, sienge_movement_id=None,
              sienge_resposta=None, erro=None, liberar_chave=False):
    """Fecha o resultado da gravação no Sienge. liberar_chave zera a chave (falha
    definitiva: a mesma cesta pode ser gravada de novo sem esbarrar na unicidade)."""
    if not ids:
        return
    patch: dict = {}
    for k, v in (("status", status), ("sienge_status", sienge_status), ("erro", erro),
                 ("sienge_resposta", sienge_resposta)):
        if v is not None:
            patch[k] = v
    if sienge_movement_id is not None:
        patch["sienge_movement_id"] = str(sienge_movement_id)
    if liberar_chave:
        patch["chave_idempotencia"] = None
    if not patch:
        return
    with httpx.Client(timeout=TIMEOUT) as cli:
        r = cli.patch(f"{_url()}{TBL}", params={"id": "in.(" + ",".join(str(i) for i in ids) + ")"},
                      headers=_headers_admin(), json=patch)
        _checar(r)


def por_chaves(chaves: list[str]) -> list[dict]:
    if not chaves:
        return []
    with httpx.Client(timeout=TIMEOUT) as cli:
        r = cli.get(f"{_url()}{TBL}", params={"chave_idempotencia": _in(chaves), "select": "*"},
                    headers=_headers_admin())
        _checar(r)
        return r.json()


def historico(obra: str, limite: int = 200) -> list[dict]:
    with httpx.Client(timeout=TIMEOUT) as cli:
        r = cli.get(f"{_url()}{TBL}",
                    params={"obra": f"eq.{obra}", "order": "criado_em.desc", "limit": limite},
                    headers=_headers_admin())
        r.raise_for_status()
        return r.json()


def por_id(aud_id: int) -> dict | None:
    with httpx.Client(timeout=TIMEOUT) as cli:
        r = cli.get(f"{_url()}{TBL}", params={"id": f"eq.{aud_id}", "limit": 1},
                    headers=_headers_admin())
        r.raise_for_status()
        rows = r.json()
        return rows[0] if rows else None


def reservar_estorno(aud_id: int) -> bool:
    """estornado=true só se ainda estava false e a linha está gravada (compare-and-set).
    True = esta chamada reservou; False = outra chamada já estornou/está estornando."""
    with httpx.Client(timeout=TIMEOUT) as cli:
        r = cli.patch(f"{_url()}{TBL}",
                      params={"id": f"eq.{aud_id}", "estornado": "is.false", "status": "eq.gravado"},
                      headers={**_headers_admin(), "Prefer": "return=representation"},
                      json={"estornado": True})
        _checar(r)
        return bool(r.json())


def liberar_estorno(aud_id: int):
    with httpx.Client(timeout=TIMEOUT) as cli:
        r = cli.patch(f"{_url()}{TBL}", params={"id": f"eq.{aud_id}"},
                      headers=_headers_admin(), json={"estornado": False})
        _checar(r)


# ---------------------------------------------------------------- aprovação
# Estado da dupla aprovação (overlay sobre a solicitação do Sienge). Só o backend
# grava (service_role); o front apenas lê. Transições por compare-and-set no status.
_APROV = "/rest/v1/aprov_sienge"
_APROV_EV = "/rest/v1/aprov_sienge_eventos"


def aprov_get(pr: int) -> dict | None:
    with httpx.Client(timeout=TIMEOUT) as cli:
        r = cli.get(f"{_url()}{_APROV}", params={"purchase_request_id": f"eq.{pr}", "limit": 1},
                    headers=_headers_admin())
        _checar(r)
        rows = r.json()
        return rows[0] if rows else None


def aprov_garantir(pr: int, obra: str) -> dict:
    """Cria a linha (aguardando_engenharia) se não existir; devolve a linha atual."""
    atual = aprov_get(pr)
    if atual:
        return atual
    with httpx.Client(timeout=TIMEOUT) as cli:
        r = cli.post(f"{_url()}{_APROV}?on_conflict=purchase_request_id",
                     headers={**_headers_admin(), "Prefer": "resolution=ignore-duplicates"},
                     json={"purchase_request_id": pr, "obra": str(obra),
                           "status": "aguardando_engenharia"})
        _checar(r)
    return aprov_get(pr) or {}


def aprov_transicionar(pr: int, de_status: str, patch: dict) -> dict | None:
    """Aplica `patch` só se o status ainda for `de_status`. None = alguém agiu antes."""
    with httpx.Client(timeout=TIMEOUT) as cli:
        r = cli.patch(f"{_url()}{_APROV}",
                      params={"purchase_request_id": f"eq.{pr}", "status": f"eq.{de_status}"},
                      headers={**_headers_admin(), "Prefer": "return=representation"}, json=patch)
        _checar(r)
        rows = r.json()
        return rows[0] if rows else None


def aprov_evento(pr: int, etapa: str, acao: str, usuario: str, observacao: str | None = None):
    with httpx.Client(timeout=TIMEOUT) as cli:
        r = cli.post(f"{_url()}{_APROV_EV}", headers=_headers_admin(),
                     json={"purchase_request_id": pr, "etapa": etapa, "acao": acao,
                           "usuario": usuario, "observacao": observacao or None})
        _checar(r)
