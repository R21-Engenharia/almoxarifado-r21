"""Taxonomia determinística: descrição do insumo -> grupo econômico -> macro-grupo.

Regras por palavra-chave, auditáveis. Nada de IA aqui. "Outros" quando nada bate
(nunca forçar equivalência). Espelha a lógica do handoff (arquivo 02).
"""
from __future__ import annotations
import unicodedata

# ordem de exibição dos macro-grupos (o que o almoxarife usa)
MACRO_ORDEM = [
    "Estrutura",
    "Alvenaria/Argamassa",
    "Hidráulica",
    "Elétrica",
    "Revestimento/Acabamento",
    "Impermeabilização",
    "Esquadrias",
    "Fixação/Química",
    "EPI/Ferramentas",
    "Outros",
]

# grupo econômico -> macro-grupo
_GRUPO_MACRO = {
    "Concreto": "Estrutura",
    "Aço/Armadura": "Estrutura",
    "Cimento/Cal": "Estrutura",
    "Areia/Brita/Agregado": "Estrutura",
    "Madeira/Forma": "Estrutura",
    "Bloco/Tijolo": "Alvenaria/Argamassa",
    "Argamassa": "Alvenaria/Argamassa",
    "Tubo/Conexão hidráulica": "Hidráulica",
    "Louças/Metais": "Hidráulica",
    "Cabo/Fio elétrico": "Elétrica",
    "Eletroduto/Elétrica": "Elétrica",
    "Cerâmica/Porcelanato": "Revestimento/Acabamento",
    "Gesso/Drywall": "Revestimento/Acabamento",
    "Tinta/Pintura": "Revestimento/Acabamento",
    "Impermeabilizante": "Impermeabilização",
    "Impermeab./Aditivo": "Impermeabilização",
    "Esquadria/Vidro": "Esquadrias",
    "Fixação/Ferragem": "Fixação/Química",
    "Vedação/Química": "Fixação/Química",
    "EPI/Segurança": "EPI/Ferramentas",
    "Ferramenta/Consumível": "EPI/Ferramentas",
    "Outros": "Outros",
}


def _norm(s: str) -> str:
    s = (s or "").lower()
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii")
    return s


# ordem importa: regras mais específicas primeiro. Lista de (grupo, [palavras]).
_REGRAS = [
    ("Concreto", ["concreto", "graute", "usinado"]),
    ("Argamassa", ["argamassa", "rejunte", "assentamento", "reboco pronto"]),
    ("Aço/Armadura", ["aco ca", "vergalhao", "armadura", "estribo", "tela soldada", "arame recozido"]),
    ("Cimento/Cal", ["cimento", " cal ", "cal hidrat", "cal virgem"]),
    ("Areia/Brita/Agregado", ["areia", "brita", "pedrisco", "pedra", "agregado", "bica corrida"]),
    ("Bloco/Tijolo", ["bloco", "tijolo", "canaleta ceram"]),
    ("Cerâmica/Porcelanato", ["porcelanato", "ceramica", "azulejo", "revestimento ceram", "piso ceram", "pastilha"]),
    ("Gesso/Drywall", ["gesso", "drywall", "placa st", "placa ru", "montante", "guia gesso"]),
    ("Cabo/Fio elétrico", ["cabo", "fio", "condutor"]),
    ("Eletroduto/Elétrica", ["eletroduto", "conduite", "disjuntor", "tomada", "interruptor", "quadro de distrib", "eletrocalha", "luminaria", "lampada"]),
    ("Tubo/Conexão hidráulica", ["tubo", "conexao", "joelho", "luva", "te ", "curva", "registro", "cap ", "pvc"]),
    ("Louças/Metais", ["vaso sanit", "bacia", "cuba", "lavatorio", "torneira", "misturador", "ducha", "sifao", "valvula"]),
    ("Tinta/Pintura", ["tinta", "verniz", "selador", "massa corrida", "massa acril", "primer", "esmalte", "textura"]),
    ("Impermeabilizante", ["impermeabil", "manta asfalt", "veda calha"]),
    ("Impermeab./Aditivo", ["aditivo", "hidrofugante", "cristalizante"]),
    ("Esquadria/Vidro", ["esquadria", "janela", "porta de aluminio", "vidro", "perfil de aluminio", "veneziana"]),
    ("Madeira/Forma", ["madeira", "compensado", "sarrafo", "tabua", "forma", "escora", "caibro", "pontalete"]),
    ("EPI/Segurança", ["capacete", "luva de", "bota", "cinto de seguranca", "oculos", "protetor auric", "epi", "mascara"]),
    ("Fixação/Ferragem", ["parafuso", "prego", "bucha", "chumbador", "dobradica", "fechadura", "porca", "arruela", "abracadeira"]),
    ("Ferramenta/Consumível", ["disco de corte", "broca", "lixa", "trena", "colher de pedreiro", "desempenadeira", "fita crepe", "estopa", "rolo de pintura", "pincel", "brocha"]),
    ("Vedação/Química", ["silicone", "veda rosca", "espuma expansiva", "cola", "adesivo", "selante"]),
]


def grupo_de(descricao: str) -> str:
    d = _norm(descricao)
    for grupo, palavras in _REGRAS:
        for p in palavras:
            if p in d:
                return grupo
    return "Outros"


def macro_de(grupo: str) -> str:
    return _GRUPO_MACRO.get(grupo, "Outros")
