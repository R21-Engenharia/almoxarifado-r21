"""Auditoria local em SQLite (independente — sem Supabase).

Uma linha por item. Batch compartilha o mesmo sienge_movement_id. Estorno lê a
linha e grava o oposto, marcando estornado=true. Espelha o schema do handoff.
"""
from __future__ import annotations
import os
import sqlite3
import json
from datetime import datetime, timezone

DB_PATH = os.environ.get("ALMOX_DB", os.path.join(os.path.dirname(__file__), "almox.db"))

_DDL = """
create table if not exists estoque_movimentos (
  id integer primary key autoincrement,
  criado_em text not null,
  usuario text not null,
  obra text not null,
  resource_id text not null,
  descricao text,
  operacao text not null,          -- baixa | entrada | estorno
  movement_type_id integer not null,
  quantidade real not null,
  unidade text,
  document_id text,
  movement_date text,
  sienge_status integer,
  sienge_movement_id text,
  sienge_resposta text,
  estorno_de integer references estoque_movimentos(id),
  estornado integer not null default 0,
  removido_no_sienge integer not null default 0,
  terceiro text,
  solicitante text
);
create index if not exists idx_estoque_mov_obra on estoque_movimentos(obra, criado_em desc);
"""


def _conn():
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    return c


def init_db():
    with _conn() as c:
        c.executescript(_DDL)
        # migração: garante colunas novas em bancos antigos
        for col in ("terceiro text", "solicitante text"):
            try:
                c.execute(f"alter table estoque_movimentos add column {col}")
            except sqlite3.OperationalError:
                pass  # já existe


def registrar(usuario, obra, operacao, movement_type_id, document_id,
              movement_date, sienge_status, sienge_movement_id, sienge_resposta,
              itens, estorno_de=None, terceiro=None, solicitante=None) -> list[int]:
    """Grava uma linha por item. Retorna os ids criados."""
    ids = []
    agora = datetime.now(timezone.utc).isoformat()
    with _conn() as c:
        for it in itens:
            cur = c.execute(
                """insert into estoque_movimentos
                (criado_em, usuario, obra, resource_id, descricao, operacao,
                 movement_type_id, quantidade, unidade, document_id, movement_date,
                 sienge_status, sienge_movement_id, sienge_resposta, estorno_de,
                 terceiro, solicitante)
                values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (agora, usuario, obra, str(it["resource_id"]), it.get("descricao"),
                 operacao, movement_type_id, float(it["quantidade"]), it.get("unidade"),
                 document_id, movement_date, sienge_status, str(sienge_movement_id or ""),
                 json.dumps(sienge_resposta, ensure_ascii=False), estorno_de,
                 terceiro, solicitante),
            )
            ids.append(cur.lastrowid)
    return ids


def historico(obra: str, limite: int = 200) -> list[dict]:
    with _conn() as c:
        rows = c.execute(
            "select * from estoque_movimentos where obra=? order by criado_em desc limit ?",
            (str(obra), limite),
        ).fetchall()
    return [dict(r) for r in rows]


def por_id(aud_id: int) -> dict | None:
    with _conn() as c:
        r = c.execute("select * from estoque_movimentos where id=?", (aud_id,)).fetchone()
    return dict(r) if r else None


def marcar_estornado(aud_id: int):
    with _conn() as c:
        c.execute("update estoque_movimentos set estornado=1 where id=?", (aud_id,))
