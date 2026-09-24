"""Auditoria local em SQLite (independente — sem Supabase).

Uma linha por item. Batch compartilha o mesmo sienge_movement_id. Espelha o
schema do Supabase (mesmas colunas e mesma semântica de status):

  status      pendente -> gravado | falhou   (pendente = enviado ao Sienge sem confirmação)
  chave_idempotencia  única por item; repetir a gravação com a mesma chave não reenvia.
  estornado   reservado atomicamente antes do estorno (evita estorno duplo).
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
  solicitante text,
  detail_id integer,
  trademark_id integer,
  variante text,
  embalagem text,
  fator_embalagem real,
  chave_idempotencia text,
  status text not null default 'gravado',
  erro text
);
create index if not exists idx_estoque_mov_obra on estoque_movimentos(obra, criado_em desc);
"""

# colunas acrescentadas depois da primeira versão (migração de bancos antigos)
_COLS_NOVAS = ("terceiro text", "solicitante text", "detail_id integer", "trademark_id integer",
               "variante text", "embalagem text", "fator_embalagem real",
               "chave_idempotencia text", "status text not null default 'gravado'", "erro text",
               "eap_uc_id integer", "eap_codigo text", "eap_descricao text", "motivo text",
               "condicao text", "transferencia_id integer", "obra_contraparte text",
               "requisicao_id integer", "contagem_id integer")

# campos de item gravados junto com a linha
_CAMPOS_ITEM = ("detail_id", "trademark_id", "variante", "embalagem", "fator_embalagem",
                "chave_idempotencia", "eap_uc_id", "eap_codigo", "eap_descricao")
_CAMPOS_EXTRA = ("motivo", "condicao", "transferencia_id", "obra_contraparte", "requisicao_id",
                 "contagem_id")


def _conn():
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    return c


def _row(r) -> dict:
    d = dict(r)
    d["estornado"] = bool(d.get("estornado"))
    d["removido_no_sienge"] = bool(d.get("removido_no_sienge"))
    return d


def init_db():
    with _conn() as c:
        c.executescript(_DDL)
        for col in _COLS_NOVAS:
            try:
                c.execute(f"alter table estoque_movimentos add column {col}")
            except sqlite3.OperationalError:
                pass  # já existe
        c.execute("create unique index if not exists ux_estoque_mov_chave "
                  "on estoque_movimentos(chave_idempotencia) where chave_idempotencia is not null")


def registrar(usuario, obra, operacao, movement_type_id, document_id,
              movement_date, sienge_status, sienge_movement_id, sienge_resposta,
              itens, estorno_de=None, terceiro=None, solicitante=None,
              status="gravado", extra: dict | None = None) -> list[int]:
    """Grava uma linha por item. Retorna os ids criados."""
    ids = []
    ext = [(extra or {}).get(k) for k in _CAMPOS_EXTRA]
    agora = datetime.now(timezone.utc).isoformat()
    with _conn() as c:
        for it in itens:
            cur = c.execute(
                """insert into estoque_movimentos
                (criado_em, usuario, obra, resource_id, descricao, operacao,
                 movement_type_id, quantidade, unidade, document_id, movement_date,
                 sienge_status, sienge_movement_id, sienge_resposta, estorno_de,
                 terceiro, solicitante, status,
                 detail_id, trademark_id, variante, embalagem, fator_embalagem, chave_idempotencia,
                 eap_uc_id, eap_codigo, eap_descricao,
                 motivo, condicao, transferencia_id, obra_contraparte, requisicao_id, contagem_id)
                values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (agora, usuario, obra, str(it["resource_id"]), it.get("descricao"),
                 operacao, movement_type_id, float(it["quantidade"]), it.get("unidade"),
                 document_id, movement_date, sienge_status, str(sienge_movement_id or ""),
                 json.dumps(sienge_resposta, ensure_ascii=False), estorno_de,
                 terceiro, solicitante, status,
                 *(it.get(k) for k in _CAMPOS_ITEM), *ext),
            )
            ids.append(cur.lastrowid)
    return ids


def atualizar(ids: list[int], *, status=None, sienge_status=None, sienge_movement_id=None,
              sienge_resposta=None, erro=None, liberar_chave=False):
    """Fecha o resultado da gravação no Sienge nas linhas `ids`.
    liberar_chave=True zera a chave (falha definitiva: a mesma cesta pode ser regravada)."""
    if not ids:
        return
    sets, vals = [], []
    for col, v in (("status", status), ("sienge_status", sienge_status), ("erro", erro)):
        if v is not None:
            sets.append(f"{col}=?"); vals.append(v)
    if sienge_movement_id is not None:
        sets.append("sienge_movement_id=?"); vals.append(str(sienge_movement_id))
    if sienge_resposta is not None:
        sets.append("sienge_resposta=?"); vals.append(json.dumps(sienge_resposta, ensure_ascii=False))
    if liberar_chave:
        sets.append("chave_idempotencia=null")
    if not sets:
        return
    marks = ",".join("?" * len(ids))
    with _conn() as c:
        c.execute(f"update estoque_movimentos set {', '.join(sets)} where id in ({marks})",
                  (*vals, *ids))


def por_chaves(chaves: list[str]) -> list[dict]:
    if not chaves:
        return []
    marks = ",".join("?" * len(chaves))
    with _conn() as c:
        rows = c.execute(f"select * from estoque_movimentos where chave_idempotencia in ({marks})",
                         tuple(chaves)).fetchall()
    return [_row(r) for r in rows]


def historico(obra: str, limite: int = 200) -> list[dict]:
    with _conn() as c:
        rows = c.execute(
            "select * from estoque_movimentos where obra=? order by criado_em desc limit ?",
            (str(obra), limite),
        ).fetchall()
    return [_row(r) for r in rows]


def consumo_eap(obra: str) -> list[dict]:
    with _conn() as c:
        rows = c.execute("select * from estoque_movimentos where obra=? and operacao='baixa' "
                         "and status='gravado' and estornado=0 order by id", (str(obra),)).fetchall()
    return [_row(r) for r in rows]


def por_vinculo(campo: str, valor) -> list[dict]:
    if campo not in ("transferencia_id", "requisicao_id", "contagem_id"):
        raise ValueError(campo)
    with _conn() as c:
        rows = c.execute(f"select * from estoque_movimentos where {campo}=? order by id",
                         (valor,)).fetchall()
    return [_row(r) for r in rows]


def por_id(aud_id: int) -> dict | None:
    with _conn() as c:
        r = c.execute("select * from estoque_movimentos where id=?", (aud_id,)).fetchone()
    return _row(r) if r else None


def reservar_estorno(aud_id: int) -> bool:
    """Marca estornado=1 só se ainda não estava (compare-and-set). True = reservou."""
    with _conn() as c:
        cur = c.execute("update estoque_movimentos set estornado=1 "
                        "where id=? and estornado=0 and status='gravado'", (aud_id,))
        return cur.rowcount == 1


def liberar_estorno(aud_id: int):
    """Desfaz a reserva quando o estorno falhou de forma definitiva no Sienge."""
    with _conn() as c:
        c.execute("update estoque_movimentos set estornado=0 where id=?", (aud_id,))
