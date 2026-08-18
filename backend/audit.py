"""Facade de auditoria: usa Supabase (Postgres) quando configurado; senão,
cai no SQLite local (dev/demo). Mesma assinatura das duas implementações."""
from __future__ import annotations
import supa
import auditoria as sqlite_audit


def _supa() -> bool:
    return supa.configurado()


def init_db():
    if not _supa():
        sqlite_audit.init_db()


def registrar(**kw) -> list[int]:
    return (supa if _supa() else sqlite_audit).registrar(**kw)


def historico(obra: str, limite: int = 200):
    return (supa if _supa() else sqlite_audit).historico(obra, limite)


def por_id(aud_id: int):
    return (supa if _supa() else sqlite_audit).por_id(aud_id)


def marcar_estornado(aud_id: int):
    return (supa if _supa() else sqlite_audit).marcar_estornado(aud_id)
