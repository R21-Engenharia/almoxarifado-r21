"""Facade de auditoria: usa Supabase (Postgres) quando configurado; senão,
cai no SQLite local (dev/demo). Mesma assinatura das duas implementações."""
from __future__ import annotations
import supa
import auditoria as sqlite_audit


def _supa() -> bool:
    return supa.configurado()


def _impl():
    return supa if _supa() else sqlite_audit


def init_db():
    if not _supa():
        sqlite_audit.init_db()


def registrar(**kw) -> list[int]:
    return _impl().registrar(**kw)


def atualizar(ids: list[int], **kw):
    return _impl().atualizar(ids, **kw)


def por_chaves(chaves: list[str]) -> list[dict]:
    return _impl().por_chaves(chaves)


def historico(obra: str, limite: int = 200):
    return _impl().historico(obra, limite)


def consumo_eap(obra: str) -> list[dict]:
    return _impl().consumo_eap(obra)


def por_vinculo(campo: str, valor) -> list[dict]:
    return _impl().por_vinculo(campo, valor)


def por_id(aud_id: int):
    return _impl().por_id(aud_id)


def reservar_estorno(aud_id: int) -> bool:
    return _impl().reservar_estorno(aud_id)


def liberar_estorno(aud_id: int):
    return _impl().liberar_estorno(aud_id)
