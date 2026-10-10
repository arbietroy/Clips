# Starts Clips on Windows: the backend and the website in their own windows, then opens the browser.
# Run it from PowerShell:  .\start.ps1
# Keys (Claude, Pixabay, ...) are read from backend\.env — see backend\.env.example.

$root = $PSScriptRoot

if (-not (Test-Path "$root\backend\.venv")) {
    Write-Host "First run: setting up Python (this takes a few minutes)..." -ForegroundColor Yellow
    Push-Location "$root\backend"
    py -3.12 -m venv .venv
    & .\.venv\Scripts\python.exe -m pip install --upgrade pip
    & .\.venv\Scripts\python.exe -m pip install -r requirements.txt
    Pop-Location
}
if (-not (Test-Path "$root\frontend\node_modules")) {
    Write-Host "First run: installing the website packages..." -ForegroundColor Yellow
    Push-Location "$root\frontend"
    npm install
    Pop-Location
}

Start-Process powershell -ArgumentList "-NoExit", "-Command",
    "`$host.UI.RawUI.WindowTitle = 'Clips backend'; cd '$root\backend'; .\.venv\Scripts\python.exe -m uvicorn server:app --port 8000"
Start-Process powershell -ArgumentList "-NoExit", "-Command",
    "`$host.UI.RawUI.WindowTitle = 'Clips website'; cd '$root\frontend'; npm run dev"

Write-Host "Starting... the browser will open in a few seconds. Keep the two new windows open while you use Clips." -ForegroundColor Green
Start-Sleep -Seconds 6
Start-Process "http://localhost:5173"
