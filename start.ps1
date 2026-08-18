# Sobe o Almoxarifado R21.
#  - BACKEND: roda DESTA pasta (Drive). Usa o backend\.env daqui.
#  - FRONTEND: o Google Drive corrompe node_modules, entao o front roda de uma
#    copia LOCAL, espelhada automaticamente a partir daqui (padrao do app de validacao).
$root = $PSScriptRoot
$webRunDir = "$env:LOCALAPPDATA\almoxarifado-r21-web"

# --- Backend (roda do Drive, porta 8100) ---
Start-Process powershell -ArgumentList @(
  '-NoExit','-Command',
  "cd '$root\backend'; if (-not (Test-Path .venv)) { python -m venv .venv; .\.venv\Scripts\python -m pip install -r requirements.txt }; .\.venv\Scripts\python -m uvicorn app:app --port 8100 --reload"
)

# --- Frontend (espelha web\ para pasta local e roda vite la, porta 5180) ---
robocopy "$root\web" $webRunDir /E /XD node_modules dist /NFL /NDL /NJH /NJS /NP | Out-Null
Start-Process powershell -ArgumentList @(
  '-NoExit','-Command',
  "cd '$webRunDir'; if (-not (Test-Path node_modules)) { npm install }; npm run dev"
)

Write-Host "Backend (do Drive): http://localhost:8100/api/health"
Write-Host "App (build local):  abra o endereco que o Vite imprimir (ex.: http://localhost:5180)"
Write-Host ""
Write-Host "Edite as credenciais em: $root\backend\.env"
