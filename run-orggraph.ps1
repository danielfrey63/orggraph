# run-orggraph.ps1
# Startet den Vite-Server und öffnet ein anonymes Chrome-Fenster im Full-Screen-Modus

$Url = "http://localhost:5173"

# Starte den Vite-Server im Hintergrund
Write-Host "Starte Vite-Server..." -ForegroundColor Cyan
$serverProcess = Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "npm run dev" -PassThru -WindowStyle Hidden

# Warte bis der Server bereit ist
Write-Host "Warte auf Server..." -ForegroundColor Cyan -NoNewline
$maxAttempts = 30
$attempts = 0
$serverReady = $false

while ($attempts -lt $maxAttempts -and -not $serverReady) {
    Start-Sleep -Milliseconds 500
    $attempts++
    try {
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2 -ErrorAction SilentlyContinue
        if ($response.StatusCode -eq 200) {
            $serverReady = $true
            Write-Host " Server ist bereit!" -ForegroundColor Green
        }
    } catch {
        Write-Host "." -NoNewline
    }
}

if (-not $serverReady) {
    Write-Host "`nServer konnte nicht gestartet werden." -ForegroundColor Red
    if ($serverProcess) {
        Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue
    }
    exit 1
}

# Öffne Chrome im Inkognito-Modus mit Full-Screen (Kiosk-Modus)
Write-Host "Öffne Chrome im Inkognito-Modus..." -ForegroundColor Cyan

$chromePath = "C:\Program Files\Google\Chrome\Application\chrome.exe"
if (-not (Test-Path $chromePath)) {
    $chromePath = "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
}

if (Test-Path $chromePath) {
    Start-Process -FilePath $chromePath -ArgumentList "--incognito", "--kiosk", $Url
    Write-Host "Chrome gestartet!" -ForegroundColor Green
} else {
    Write-Host "Chrome nicht gefunden. Öffne im Standard-Browser..." -ForegroundColor Yellow
    Start-Process $Url
}

Write-Host "`nDrücke eine beliebige Taste zum Beenden..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")

# Cleanup: Beende den Server beim Schließen
if ($serverProcess) {
    Write-Host "`nBeende Server..." -ForegroundColor Cyan
    Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue
}
