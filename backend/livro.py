"""Livro operacional do BOX21: transferências, requisições e contagens.

Mesmo padrão da auditoria: Supabase (Postgres via REST, service_role) quando
configurado; senão SQLite local (dev/demo/testes). Todas as mudanças de estado
são compare-and-set no `status` — se outra pessoa agiu antes, volta None.
Tabelas criadas em backend/schema_migra_2026_09_C.sql.
"""
from __future__ import annotations
import json
import sqlite3
from datetime import datetime, timezone

import httpx
import supa
import auditoria

TABELAS = ("transferencias", "requisicoes", "contagens")
_JSON = {"itens", "entrega_pendente"}  # colunas jsonb

# colunas de cada tabela (espelho do SQL; usado pelo SQLite)
_COLS = {
    "transferencias": ("criado_por", "origem", "destino", "status", "chave", "itens", "obs",
                       "recebido_por", "recebido_em", "obs_recebimento", "cancelado_por",
                       "cancelado_em", "erro"),
    "requisicoes": ("obra", "criado_por", "solicitante", "terceiro", "eap_uc_id", "eap_codigo",
                    "eap_descricao", "necessario_em", "obs", "status", "itens", "entrega_pendente",
                    "n_entregas", "aprovado_por", "aprovado_em", "aprov_obs", "separado_por",
                    "separado_em", "entregue_por", "entregue_em", "cancelado_por", "cancelado_em",
                    "motivo", "erro"),
    "contagens": ("obra", "criado_por", "classe", "status", "itens", "contado_por", "contado_em",
                  "ajustado_por", "ajustado_em", "motivo", "obs", "erro"),
}


class ConflitoChave(Exception):
    """Violação de unicidade (ex.: a mesma chave de transferência)."""


def agora() -> str:
    return datetime.now(timezone.utc).isoformat()


def _tab(t: str) -> str:
    if t not in TABELAS:
        raise ValueError(t)
    return t


# ---------------------------------------------------------------- Supabase
def _url(t: str) -> str:
    return f"{supa._url()}/rest/v1/{_tab(t)}"


def _checar(r: httpx.Response):
    if r.status_code == 409 or "23505" in (r.text or ""):
        raise ConflitoChave(r.text[:200])
    if r.status_code >= 400:
        txt = r.text or ""
        if "PGRST204" in txt or "PGRST205" in txt or "does not exist" in txt or "column" in txt.lower():
            raise supa.AuthError("Banco desatualizado: rode backend/schema_migra_2026_09_C.sql no "
                                 "SQL Editor do Supabase. (" + txt[:120] + ")", 503)
        raise supa.AuthError(txt[:200] or f"Supabase {r.status_code}", r.status_code)


def _filtro_status(status) -> str:
    if isinstance(status, (list, tuple, set)):
        return "in.(" + ",".join(status) + ")"
    return f"eq.{status}"


class _Supa:
    def inserir(self, t, dados):
        with httpx.Client(timeout=supa.TIMEOUT) as c:
            r = c.post(_url(t), headers={**supa._headers_admin(), "Prefer": "return=representation"},
                       json=dados)
            _checar(r)
            return r.json()[0]

    def obter(self, t, id_):
        with httpx.Client(timeout=supa.TIMEOUT) as c:
            r = c.get(_url(t), params={"id": f"eq.{id_}", "limit": 1}, headers=supa._headers_admin())
            _checar(r)
            rows = r.json()
            return rows[0] if rows else None

    def por_chave(self, t, chave):
        with httpx.Client(timeout=supa.TIMEOUT) as c:
            r = c.get(_url(t), params={"chave": f"eq.{chave}", "limit": 1}, headers=supa._headers_admin())
            _checar(r)
            rows = r.json()
            return rows[0] if rows else None

    def listar(self, t, *, obra=None, obra_em=("obra",), status=None, limite=200):
        params = {"order": "criado_em.desc", "limit": limite}
        if obra is not None:
            if len(obra_em) == 1:
                params[obra_em[0]] = f"eq.{obra}"
            else:
                params["or"] = "(" + ",".join(f"{c}.eq.{obra}" for c in obra_em) + ")"
        if status:
            params["status"] = _filtro_status(status)
        with httpx.Client(timeout=supa.TIMEOUT) as c:
            r = c.get(_url(t), params=params, headers=supa._headers_admin())
            _checar(r)
            return r.json()

    def transicionar(self, t, id_, de_status, patch):
        patch = {**patch, "atualizado_em": agora()}
        with httpx.Client(timeout=supa.TIMEOUT) as c:
            r = c.patch(_url(t), params={"id": f"eq.{id_}", "status": _filtro_status(de_status)},
                        headers={**supa._headers_admin(), "Prefer": "return=representation"}, json=patch)
            _checar(r)
            rows = r.json()
            return rows[0] if rows else None

    def atualizar(self, t, id_, patch):
        patch = {**patch, "atualizado_em": agora()}
        with httpx.Client(timeout=supa.TIMEOUT) as c:
            r = c.patch(_url(t), params={"id": f"eq.{id_}"},
                        headers={**supa._headers_admin(), "Prefer": "return=representation"}, json=patch)
            _checar(r)
            rows = r.json()
            return rows[0] if rows else None


# ---------------------------------------------------------------- SQLite
class _Sqlite:
    def _conn(self):
        c = sqlite3.connect(auditoria.DB_PATH)
        c.row_factory = sqlite3.Row
        return c

    def init(self):
        with self._conn() as c:
            for t, cols in _COLS.items():
                defs = ", ".join(
                    f"{col} text unique" if col == "chave" else
                    f"{col} integer not null default 0" if col == "n_entregas" else f"{col}"
                    for col in cols)
                c.execute(f"create table if not exists {t} (id integer primary key autoincrement, "
                          f"criado_em text not null, atualizado_em text not null, {defs})")

    def _dec(self, r):
        if r is None:
            return None
        d = dict(r)
        for k in _JSON:
            if k in d and isinstance(d[k], str):
                d[k] = json.loads(d[k])
        return d

    def _enc(self, dados):
        return {k: (json.dumps(v, ensure_ascii=False) if k in _JSON and v is not None else v)
                for k, v in dados.items()}

    def inserir(self, t, dados):
        dados = self._enc(dados)
        dados.setdefault("status", {"transferencias": "enviando", "requisicoes": "solicitada",
                                    "contagens": "aberta"}[_tab(t)])
        ts = agora()
        cols = ["criado_em", "atualizado_em", *dados.keys()]
        try:
            with self._conn() as c:
                cur = c.execute(f"insert into {t} ({','.join(cols)}) values ({','.join('?' * len(cols))})",
                                (ts, ts, *dados.values()))
                rid = cur.lastrowid
        except sqlite3.IntegrityError as e:
            raise ConflitoChave(str(e))
        return self.obter(t, rid)

    def obter(self, t, id_):
        with self._conn() as c:
            return self._dec(c.execute(f"select * from {_tab(t)} where id=?", (id_,)).fetchone())

    def por_chave(self, t, chave):
        with self._conn() as c:
            return self._dec(c.execute(f"select * from {_tab(t)} where chave=?", (chave,)).fetchone())

    def listar(self, t, *, obra=None, obra_em=("obra",), status=None, limite=200):
        where, vals = [], []
        if obra is not None:
            where.append("(" + " or ".join(f"{col}=?" for col in obra_em) + ")")
            vals += [str(obra)] * len(obra_em)
        if status:
            sts = list(status) if isinstance(status, (list, tuple, set)) else [status]
            where.append(f"status in ({','.join('?' * len(sts))})")
            vals += sts
        sql = f"select * from {_tab(t)}" + (" where " + " and ".join(where) if where else "")
        with self._conn() as c:
            rows = c.execute(sql + " order by criado_em desc, id desc limit ?", (*vals, limite)).fetchall()
        return [self._dec(r) for r in rows]

    def _update(self, t, id_, patch, de_status=None):
        patch = self._enc({**patch, "atualizado_em": agora()})
        sets = ", ".join(f"{k}=?" for k in patch)
        sql = f"update {_tab(t)} set {sets} where id=?"
        vals = [*patch.values(), id_]
        if de_status is not None:
            sts = list(de_status) if isinstance(de_status, (list, tuple, set)) else [de_status]
            sql += f" and status in ({','.join('?' * len(sts))})"
            vals += sts
        with self._conn() as c:
            n = c.execute(sql, vals).rowcount
        return self.obter(t, id_) if n else None

    def transicionar(self, t, id_, de_status, patch):
        return self._update(t, id_, patch, de_status)

    def atualizar(self, t, id_, patch):
        return self._update(t, id_, patch)


_SQLITE = _Sqlite()
_SUPA = _Supa()


def _impl():
    return _SUPA if supa.configurado() else _SQLITE


def init_db():
    if not supa.configurado():
        _SQLITE.init()


def inserir(t, dados): return _impl().inserir(t, dados)
def obter(t, id_): return _impl().obter(t, id_)
def por_chave(t, chave): return _impl().por_chave(t, chave)
def listar(t, **kw): return _impl().listar(t, **kw)
def transicionar(t, id_, de_status, patch): return _impl().transicionar(t, id_, de_status, patch)
def atualizar(t, id_, patch): return _impl().atualizar(t, id_, patch)
