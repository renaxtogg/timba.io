# ============================================================
#  TIMBA.IO - Servidor local de desarrollo
#  Uso: solo para probar cambios localmente.
#  En produccion el backend corre en Railway automaticamente.
# ============================================================

$BACKEND_DIR = "$PSScriptRoot\backend"
$GAME_URL    = "https://timba-io.vercel.app"

Clear-Host
Write-Host "  ╔══════════════════════════════════╗" -ForegroundColor Red
Write-Host "  ║     TIMBA.IO - Dev local          ║" -ForegroundColor Red
Write-Host "  ╚══════════════════════════════════╝" -ForegroundColor Red
Write-Host ""

# Matar instancias anteriores
Get-Process -Name "node" -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 1

# Arrancar backend
Write-Host "Arrancando backend en localhost:3001..." -ForegroundColor Cyan
$nodeProc = Start-Process "node" -ArgumentList "server.js" `
    -WorkingDirectory $BACKEND_DIR `
    -RedirectStandardOutput "$env:TEMP\timba_backend.log" `
    -RedirectStandardError  "$env:TEMP\timba_backend_err.log" `
    -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 2

$health = $false
for ($i = 0; $i -lt 5; $i++) {
    try {
        $r = Invoke-RestMethod "http://localhost:3001/health" -TimeoutSec 2
        if ($r.ok) { $health = $true; break }
    } catch {}
    Start-Sleep -Seconds 1
}

if (-not $health) {
    Write-Host "ERROR: El backend no arranco." -ForegroundColor Red
    Write-Host "Log: $env:TEMP\timba_backend_err.log" -ForegroundColor Gray
    Read-Host "Presiona Enter para salir"
    exit 1
}

Write-Host "  Backend OK  (PID $($nodeProc.Id))" -ForegroundColor Green
Write-Host ""
Write-Host "  ┌──────────────────────────────────────────────────┐" -ForegroundColor Green
Write-Host "  │  MODO DEV LOCAL                                  │" -ForegroundColor Green
Write-Host "  │                                                  │" -ForegroundColor Green
Write-Host "  │  Backend: http://localhost:3001                  │" -ForegroundColor Yellow
Write-Host "  │  Abre index.html con BACKEND_URL=localhost:3001  │" -ForegroundColor Gray
Write-Host "  │                                                  │" -ForegroundColor Green
Write-Host "  │  Produccion (Railway + Vercel):                  │" -ForegroundColor Green
Write-Host "  │  $GAME_URL                     │" -ForegroundColor Yellow
Write-Host "  │                                                  │" -ForegroundColor Green
Write-Host "  │  Cierra esta ventana para apagar el servidor.    │" -ForegroundColor Green
Write-Host "  └──────────────────────────────────────────────────┘" -ForegroundColor Green
Write-Host ""

Start-Process $GAME_URL

# Watchdog
try {
    while ($true) {
        Start-Sleep -Seconds 30
        $alive = $false
        try { $alive = (Invoke-RestMethod "http://localhost:3001/health" -TimeoutSec 3).ok } catch {}
        if (-not $alive) {
            Write-Host "  [!] Backend caido, reiniciando..." -ForegroundColor Yellow
            $nodeProc = Start-Process "node" -ArgumentList "server.js" `
                -WorkingDirectory $BACKEND_DIR -PassThru -WindowStyle Hidden
            Start-Sleep -Seconds 2
        }
        Write-Host "  [$(Get-Date -Format 'HH:mm')] Activo - localhost:3001" -ForegroundColor DarkGray
    }
} finally {
    Write-Host ""
    Write-Host "Apagando servidor..." -ForegroundColor Yellow
    Stop-Process -Id $nodeProc.Id -Force -ErrorAction SilentlyContinue
    Write-Host "Servidor apagado." -ForegroundColor Gray
}
