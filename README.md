# Almoxarifado R21

App **exclusivo do almoxarifado**, independente do sistema de validação (`prevision_agent`).
Backend próprio que fala com o **Sienge** (fonte única da verdade). Os **motores calculam**
(Stock Engine determinístico); nenhum número sai de IA. Escrita no ERP com confirmação e
auditoria de tudo.

## Estrutura

```
almoxarifado-r21/
├── backend/          FastAPI + Stock Engine + cliente Sienge + auditoria (SQLite)
│   ├── app.py        API (endpoints)
│   ├── engine.py     Stock Engine: saldo, consumo/dia, cobertura, ruptura, capital parado
│   ├── sienge.py     Cliente Sienge (leitura inventory-movements + escrita stock-movements)
│   ├── taxonomia.py  grupo econômico -> macro-grupo (determinístico)
│   ├── auditoria.py  log de movimentações (SQLite local, independente)
│   ├── demo_data.py  dataset de demonstração (roda sem credenciais)
│   ├── obras.py      mapeamento de obras (costCenterId == buildingId)
│   └── .env.example  credenciais do Sienge (copie para .env)
└── web/              React + Vite + TypeScript (Painel, Operar, Histórico) — responsivo
```

## Onde o app mora

O **código-fonte** mora nesta pasta, no Google Drive (fonte da verdade). Só há uma ressalva
técnica: o Drive corrompe `node_modules` (arquivos de 0 byte / Errno 22 — armadilha registrada
no handoff). Por isso:

- **Backend (Python):** roda direto do Drive, desta pasta. O `backend/.env` daqui é o que vale.
- **Frontend (Vite/npm):** roda de uma **cópia local** espelhada automaticamente (o `start.ps1`
  cuida disso). Ao editar o front, rode o `start.ps1` de novo para re-espelhar.

## Rodar (jeito fácil)

Dê dois cliques / execute o `start.ps1` desta pasta:
```powershell
powershell -ExecutionPolicy Bypass -File .\start.ps1
```
Ele sobe o backend (do Drive, porta 8100) e o front (cópia local, porta 5180) em duas janelas.
Abra o endereço que o Vite imprimir. O `/api` é proxied para o backend automaticamente.

## Desempenho / cache

O histórico do Sienge tem dezenas de milhares de movimentos e leva ~1 min para baixar.
Para o app ser instantâneo:
- O histórico é salvo em **`backend/data/snap_{obra}.json`** (snapshot). Acessos e reinícios
  leem do disco (~0,3s) em vez de re-baixar.
- **Baixa/entrada/estorno não re-baixam** o histórico: o movimento é anexado ao cache e o
  saldo atualiza na hora.
- O resultado do motor fica em cache por obra (recalculado só quando o estoque muda).
- Botão **"↻ Atualizar do Sienge"** (no Painel) força a re-coleta completa — use quando houver
  movimentos feitos por fora do app. É a única ação que leva ~1 min.

`backend/data/` é gitignored (contém dados reais).

## Rodar (manual)

**1. Backend** (porta 8100) — direto desta pasta:
```bash
cd backend
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt
.venv/Scripts/python -m uvicorn app:app --port 8100 --reload
```

**2. Frontend** (porta 5180) — de uma cópia LOCAL (não do Drive):
```bash
# copie a pasta web\ para um local fora do Drive, ex. %LOCALAPPDATA%\almoxarifado-r21-web
cd <copia-local>\web
npm install
npm run dev
```

## Modos

- **DEMO** (padrão, sem `.env`): usa `demo_data.py` — 10 insumos cobrindo todos os status
  (ruptura, crítico, baixo, ok, parado). As baixas/entradas refletem no saldo em memória.
- **SIENGE** (produção): preencha `backend/.env` a partir de `.env.example` com
  `SIENGE_SUBDOMAIN`, `SIENGE_API_USER`, `SIENGE_API_PASSWORD`. O app passa a puxar o histórico
  real de `inventory-movements` e a gravar em `POST /stock-movements`. Detecção é automática:
  se as três variáveis existem, sai do modo demo (ver `GET /api/health`).

## Obras

| Obra | prevision_id | costCenterId / buildingId |
|---|---|---|
| Cape Town Residence | 10223 | 23 |
| Holmes Residence | 18992 | 13 |

## Semântica de escrita (contrato do Sienge)

| Operação | movementTypeId | documentId |
|---|---|---|
| Baixa (consumo) | 2 | REQ |
| Entrada (ajuste) | 9 | AJE |
| Estorno de baixa | 9 | EST |
| Estorno de entrada | 10 | EST |

Estorno = movimento compensatório na direção oposta (a API do Sienge não tem delete). Toda
gravação carimba o autor no campo `notes` e grava uma linha na auditoria (`backend/almox.db`).

### Contrato de escrita descoberto (importante)

Confirmado contra o Sienge real da R21 (`r21empreendimentos`):

- **Baixa (consumo, tipo 2, doc REQ):** só `resourceId`, `quantity`, `unitOfMeasure`. Simples.
- **Entrada e estorno (tipo 9 entrada / 10 saída, doc INIE):** o Sienge EXIGE, além dos campos
  acima:
  - **`unitPrice`** (preço unitário) nas entradas (tipo 9) — o app usa o custo médio do insumo.
  - **`buildingAppropriations`**: `[{buildingUnitId, sheetItemId, percentage}]` somando **100%**,
    apontando para um **item de orçamento (WBS) não bloqueado**.
- A apropriação válida vem do GET `/stock-inventories/{cc}/items/{resourceId}/building-appropriation`.
  Alguns itens de orçamento estão **bloqueados para apropriação**; o app tenta os candidatos até
  um aceitar 100% (e memoriza os bloqueados para os próximos estornos serem rápidos).
- O schema do item é **estrito**: campo desconhecido → 400. Só existem os campos acima + `notes`.

Por isso um estorno pode levar até ~1 min (busca a apropriação e pode tentar mais de um item de
orçamento). A tela mostra "Estornando…" durante a operação.

## Pendências herdadas do handoff (próximos passos)

1. **Reconciliação com o Sienge** antes de estornar (revalidar `GET /inventory-movements/{id}`;
   404 = apagado → bloquear estorno). Base já existe em `sienge.buscar_movimento()`.
2. **Apropriação por subetapa** na baixa (escolher subetapa da EAP e guardar na auditoria).
3. **Coleta agendada** / cache persistente do histórico (hoje é em memória por processo).
4. **Gate de admin** para escrita (hoje qualquer usuário identificado opera).
