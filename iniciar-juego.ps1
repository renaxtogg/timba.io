# ============================================================
#  TIMBA.IO - Iniciar servidor de juego
#  Doble clic (o clic derecho → Ejecutar con PowerShell)
#  Cierra la ventana para apagar el servidor.
# ============================================================

$ErrorActionPreference = "SilentlyContinue"
$BACKEND_DIR    = "$PSScriptRoot\backend"
$CF_EXE         = "$env:TEMP\cloudflared.exe"
$VERCEL_TOKEN   = "vca_5juh0hUn3i3yIxtZz35WLRTlCBYxrtj7vwvu9pqSGAlVPPLUUz2QzQ1q"
$VERCEL_TEAM    = "team_h8g7TPZLLVEsK0iXUgpSpOVI"
$VERCEL_PROJ_ID = "prj_ABxyeGvM4xhDuRRtAjk0cVTeTBWp"
$GAME_URL       = "https://timba-io.vercel.app"

Clear-Host
Write-Host "  ╔══════════════════════════════════╗" -ForegroundColor Red
Write-Host "  ║        TIMBA.IO  - Servidor       ║" -ForegroundColor Red
Write-Host "  ╚══════════════════════════════════╝" -ForegroundColor Red
Write-Host ""

# ── Matar procesos anteriores ───────────────────────────────
Write-Host "Limpiando sesión anterior..." -ForegroundColor DarkGray
Get-Process -Name "node"        -ErrorAction SilentlyContinue | Stop-Process -Force
Get-Process -Name "cloudflared" -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 1

# ── Descargar cloudflared si no existe ──────────────────────
if (-not (Test-Path $CF_EXE)) {
    Write-Host "Descargando cloudflared..." -ForegroundColor Cyan
    $ProgressPreference = 'SilentlyContinue'
    Invoke-WebRequest `
        -Uri "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" `
        -OutFile $CF_EXE -UseBasicParsing
}

# ── Arrancar backend ────────────────────────────────────────
Write-Host "Arrancando backend Node.js..." -ForegroundColor Cyan
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
    Write-Host ""
    Write-Host "ERROR: El backend no arrancó." -ForegroundColor Red
    Write-Host "Revisa: $env:TEMP\timba_backend_err.log" -ForegroundColor Gray
    Read-Host "Presiona Enter para salir"
    exit 1
}
Write-Host "  Backend OK  (PID $($nodeProc.Id))" -ForegroundColor Green

# ── Tunnel Cloudflare ───────────────────────────────────────
Write-Host "Abriendo tunnel Cloudflare..." -ForegroundColor Cyan
$cfLog = "$env:TEMP\timba_cf.log"
"" | Out-File $cfLog
$cfProc = Start-Process $CF_EXE `
    -ArgumentList "tunnel","--url","http://localhost:3001","--no-autoupdate" `
    -RedirectStandardOutput $cfLog `
    -RedirectStandardError  $cfLog `
    -PassThru -WindowStyle Hidden

$tunnelUrl = $null
for ($i = 0; $i -lt 25; $i++) {
    Start-Sleep -Seconds 1
    $content = Get-Content $cfLog -Raw -ErrorAction SilentlyContinue
    if ($content -match "https://[a-z0-9\-]+\.trycloudflare\.com") {
        $tunnelUrl = $matches[0]
        break
    }
}
if (-not $tunnelUrl) {
    Write-Host "ERROR: No se pudo obtener URL del tunnel." -ForegroundColor Red
    Read-Host "Presiona Enter para salir"; exit 1
}
Write-Host "  Tunnel OK   $tunnelUrl" -ForegroundColor Green

# ── Actualizar URL en Vercel ────────────────────────────────
Write-Host "Actualizando Vercel con nueva URL..." -ForegroundColor Cyan
$h = @{ "Authorization" = "Bearer $VERCEL_TOKEN"; "Content-Type" = "application/json" }

# Borrar env var vieja
$envs = Invoke-RestMethod -Uri "https://api.vercel.com/v9/projects/$VERCEL_PROJ_ID/env?teamId=$VERCEL_TEAM" -Headers $h
$old  = $envs.envs | Where-Object { $_.key -eq "BACKEND_URL" }
if ($old) {
    Invoke-RestMethod -Uri "https://api.vercel.com/v9/projects/$VERCEL_PROJ_ID/env/$($old.id)?teamId=$VERCEL_TEAM" `
        -Headers $h -Method Delete | Out-Null
}

# Crear nueva
$body = @{ key="BACKEND_URL"; value=$tunnelUrl; type="plain"; target=@("production","preview","development") } | ConvertTo-Json
Invoke-RestMethod -Uri "https://api.vercel.com/v9/projects/$VERCEL_PROJ_ID/env?teamId=$VERCEL_TEAM" `
    -Headers $h -Method Post -Body $body | Out-Null

# Redeploy (tarda ~30s, abrimos el juego directo mientras tanto)
$deps = Invoke-RestMethod -Uri "https://api.vercel.com/v6/deployments?projectId=$VERCEL_PROJ_ID&teamId=$VERCEL_TEAM&limit=1&target=production" -Headers $h
$lastDeploy = $deps.deployments[0].uid
$rbody = @{ name="timba-io"; deploymentId=$lastDeploy; target="production" } | ConvertTo-Json
Invoke-RestMethod -Uri "https://api.vercel.com/v13/deployments?teamId=$VERCEL_TEAM&forceNew=1" `
    -Headers $h -Method Post -Body $rbody | Out-Null

Write-Host "  Vercel OK   (redeploy en segundo plano ~30s)" -ForegroundColor Green

# ── Listo ───────────────────────────────────────────────────
Write-Host ""
Write-Host "  ┌─────────────────────────────────────────────────┐" -ForegroundColor Green
Write-Host "  │  JUEGO LISTO                                    │" -ForegroundColor Green
Write-Host "  │                                                  │" -ForegroundColor Green
Write-Host "  │  URL instantánea (abriendo ahora):              │" -ForegroundColor Green
Write-Host "  │  $tunnelUrl" -ForegroundColor Yellow
Write-Host "  │                                                  │" -ForegroundColor Green
Write-Host "  │  URL Vercel (lista en ~30s):                    │" -ForegroundColor Green
Write-Host "  │  $GAME_URL                    │" -ForegroundColor Yellow
Write-Host "  │                                                  │" -ForegroundColor Green
Write-Host "  │  Cierra esta ventana para apagar el servidor.   │" -ForegroundColor Green
Write-Host "  └─────────────────────────────────────────────────┘" -ForegroundColor Green
Write-Host ""

Start-Process $tunnelUrl

# ── Watchdog + heartbeat ────────────────────────────────────
try {
    while ($true) {
        Start-Sleep -Seconds 30
        $alive = $false
        try { $alive = (Invoke-RestMethod "http://localhost:3001/health" -TimeoutSec 3).ok } catch {}
        if (-not $alive) {
            Write-Host "  [!] Backend caído, reiniciando..." -ForegroundColor Yellow
            $nodeProc = Start-Process "node" -ArgumentList "server.js" `
                -WorkingDirectory $BACKEND_DIR -PassThru -WindowStyle Hidden
            Start-Sleep -Seconds 2
        }
        $ts = Get-Date -Format "HH:mm"
        Write-Host "  [$ts] Activo — $tunnelUrl" -ForegroundColor DarkGray
    }
} finally {
    Write-Host ""
    Write-Host "Apagando servidor..." -ForegroundColor Yellow
    Stop-Process -Id $nodeProc.Id  -Force -ErrorAction SilentlyContinue
    Stop-Process -Id $cfProc.Id   -Force -ErrorAction SilentlyContinue
    Write-Host "Servidor apagado. Hasta la próxima." -ForegroundColor Gray
}
