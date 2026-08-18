"""Mapeamento de obras. costCenterId == buildingId (handoff arquivo 01)."""
OBRAS = {
    "10223": {"nome": "Cape Town Residence", "building_id": 23, "cost_center_id": 23},
    "18992": {"nome": "Holmes Residence", "building_id": 13, "cost_center_id": 13},
}


def obra_ou_erro(prevision_id: str) -> dict:
    o = OBRAS.get(str(prevision_id))
    if not o:
        raise KeyError(f"Obra desconhecida: {prevision_id}")
    return o
