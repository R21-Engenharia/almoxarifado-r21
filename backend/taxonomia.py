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


# ============================================================================
# MACROFAMÍLIA — derivada do NOME DA FAMÍLIA REAL do Sienge (confiável), não da
# descrição do insumo. A família é a verdade; a macrofamília agrupa famílias.
# ============================================================================

MACRO_FAMILIA_ORDEM = [
    "Estrutura & Concreto",
    "Alvenaria & Vedação",
    "Hidráulica",
    "Elétrica",
    "Revestimento & Acabamento",
    "Impermeab. & Isolamento",
    "Esquadrias & Madeiras",
    "Fixação",
    "PCI & Prevenção",
    "Climatização",
    "EPI & Segurança",
    "Ferramentas & Consumíveis",
    "Canteiro & Escritório",
    "Áreas Comuns & Decoração",
    "Equipamentos",
    "Mão de Obra",
    "Gestão & Verbas",
    "Outros",
]

# (macrofamília, [palavras-chave no NOME DA FAMÍLIA]). Ordem = prioridade.
_REGRAS_MACROFAMILIA = [
    ("Hidráulica", ["hidraulic", "materiais gas", "tubos e conexoes gas", " gas -",
        "caixas de passagem", "inspecao"]),
    ("Elétrica", ["eletric", "spda", "eletroeletronic", "comunicacao e seguranca"]),
    ("PCI & Prevenção", ["pci", "preventivo", "incendio", "(shp)"]),
    ("Climatização", ["climatizacao", "exaustao", "renovacao de ar"]),
    ("Estrutura & Concreto", ["concreto", "aco para estrutura", "arames e trelic",
        "aglomerantes", "agregados", "argamassa", "espacadores de armadura",
        "laje pre-moldada", "telas para reforco", "fundacoes", "supraestrutura",
        "formas, travamento", "terraplanagem"]),
    ("Alvenaria & Vedação", ["elementos de vedacao"]),
    ("Revestimento & Acabamento", ["revestimentos ceramic", "pintura", "forros",
        "drywall", "rejuntes", "rodape", "marmores e granitos", "pavimentos",
        "gesso", "elementos complementares"]),
    ("Impermeab. & Isolamento", ["impermeabiliz", "isolantes", "isopor"]),
    ("Esquadrias & Madeiras", ["esquadria", "portas de madeira", "madeira",
        "corrimao", "serralheria", "dobradicas e fechaduras"]),
    ("Fixação", ["parafusos", "pregos", "finca-pinos", "materiais de fixacao",
        "aditivos, colas"]),
    ("Áreas Comuns & Decoração", ["areas comuns", "decoracao", "churrasqueira",
        "coberturas", "academia", "jardinagem", "sala de jogos", "paisagismo"]),
    ("EPI & Segurança", ["epi", "epc "]),
    ("Ferramentas & Consumíveis", ["ferramenta", "consumiveis", "pecas de reposicao"]),
    ("Canteiro & Escritório", ["papelaria", "limpeza", "copa e cozinha", "farmacia",
        "instalacoes e canteiro", "computadores e perifericos", "lubrificantes",
        "confraternizac", "veiculares"]),
    ("Equipamentos", ["equipamentos e apoios", "elevador", "grua", "locacao",
        "equipamentos pesados", "operacao de equipamentos", "manutencoes e reparos"]),
    ("Mão de Obra", ["mao de obra", "empreitada"]),
    ("Gestão & Verbas", ["gestao e incorporacao", "verbas", "estimativas",
        "taxas e impostos", "corretagem", "outorga", "consultoria", "colaboradores",
        "custos incorridos", "servicos tecnicos", "aquisicao do terreno", "fretes",
        "prestacao de servic"]),
]


def macrofamilia_de(familia: str) -> str:
    """Deriva a macrofamília a partir do NOME da família real do Sienge."""
    d = _norm(familia)
    if not d or "desativad" in d or "a desativar" in d:
        return "Outros"
    # usa só o trecho após o último '|' (o nome específico da família)
    especifico = _norm(familia.split("|")[-1])
    for macro, palavras in _REGRAS_MACROFAMILIA:
        for p in palavras:
            if p in especifico or p in d:
                return macro
    return "Outros"
