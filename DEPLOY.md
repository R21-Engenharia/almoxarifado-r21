# Deploy — Almoxarifado R21

Arquitetura: **Frontend na Vercel** + **Backend (FastAPI) no Render** + **Supabase** (auth + auditoria).
Repositório no GitHub (`R21-Engenharia`) dispara os deploys.

O código já está commitado (branch `main`). Siga na ordem.

---

## 1. GitHub — criar o repositório e enviar o código

1. Crie um repositório **vazio** (sem README) em `github.com/R21-Engenharia`, ex.: **`almoxarifado-r21`** (pode ser privado).
2. No terminal, dentro da pasta do app, rode (troque a URL se o nome for outro):

```bash
git -C "<pasta-do-app>" remote add origin https://github.com/R21-Engenharia/almoxarifado-r21.git
git -C "<pasta-do-app>" push -u origin main
```

---

## 2. Supabase — auditoria e usuários (projeto reutilizado do app de validação)

1. **SQL Editor** → cole e rode o conteúdo de [`backend/schema_supabase.sql`](backend/schema_supabase.sql)
   (cria a tabela `estoque_movimentos`). A tabela `authorized_emails` já existe.
2. **Authentication → Users** → crie os usuários (e-mail + senha) de quem vai operar.
3. **Table `authorized_emails`** → garanta que cada e-mail está lá. Quem pode **gravar**
   (baixa/entrada/estorno) precisa de `role = 'admin'`; os demais só consultam.
4. Anote, em **Settings → API**: `Project URL` e a chave **anon**.

---

## 3. Render — backend (FastAPI)

1. **New → Web Service** → conecte o repositório do GitHub.
2. O Render lê o `render.yaml` (raiz). Se pedir manual: Root Directory `backend`,
   Build `pip install -r requirements.txt`, Start `uvicorn app:app --host 0.0.0.0 --port $PORT`.
3. Em **Environment**, defina:
   - `SIENGE_SUBDOMAIN`, `SIENGE_API_USER`, `SIENGE_API_PASSWORD`
   - `SUPABASE_URL`, `SUPABASE_KEY` (a anon)
   - `ALMOX_CORS_ORIGINS` — deixe em branco por enquanto (preenche no passo 5)
4. Deploy. Confira em `https://<seu-servico>.onrender.com/api/health` → deve mostrar
   `"modo":"sienge","auth":true`.

## 4. Vercel — frontend

1. **Add New → Project** → importe o mesmo repositório.
2. **Root Directory: `web`** (framework Vite é detectado automaticamente).
3. **Environment Variables**:
   - `VITE_SUPABASE_URL` = Project URL do Supabase
   - `VITE_SUPABASE_ANON_KEY` = chave anon
   - `VITE_API_BASE` = URL do backend no Render (ex.: `https://almoxarifado-r21-api.onrender.com`)
4. Deploy. Anote a URL final (ex.: `https://almoxarifado-r21.vercel.app`).

## 5. Fechar o CORS

1. No **Render**, defina `ALMOX_CORS_ORIGINS` = a URL da Vercel do passo 4 e redeploy.
2. Abra a URL da Vercel → faça login com um usuário criado no passo 2.

---

## Como funciona depois de no ar

- **Editar → `git push`** na branch `main` → Vercel e Render re-deployam sozinhos.
- **Login**: só e-mails em `authorized_emails`. Escrita só para `role = 'admin'`.
- **1ª carga de uma obra** leva ~1 min (coleta do Sienge); depois fica em cache.
- Segredos ficam **só** nas envs do Render/Vercel/Supabase — nunca no repositório.
