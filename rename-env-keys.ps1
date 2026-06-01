# rename-env-keys.ps1
# Umbenennung der ENV-Keys auf neue Konvention
# 2025-11-25

$ErrorActionPreference = "Stop"

# Key-Mapping: Alt -> Neu
$keyMapping = @{
    # "ATTRIBUTES_URL" bereits umbenannt zu DATA_ATTRIBUTES_URL
    "DEFAULT_DEPTH"               = "TOOLBAR_DEPTH_DEFAULT"
    "DEFAULT_DIR"                 = "TOOLBAR_DIRECTION_DEFAULT"
    "MANAGEMENT_ONLY"             = "TOOLBAR_MANAGEMENT_ACTIVE"
    "HIERARCHICAL_LAYOUT"         = "TOOLBAR_HIERARCHY_ACTIVE"
    "LABELS_VISIBLE"              = "TOOLBAR_LABELS_ACTIVE"
    "DEFAULT_ZOOM"                = "TOOLBAR_ZOOM_DEFAULT"
    "PSEUDONYMIZATION_ENABLED"    = "TOOLBAR_PSEUDO_ACTIVE"
    "PSEUDONYMIZATION_PASSWORD"   = "TOOLBAR_PSEUDO_PASSWORD"
    "DEBUG_MODE"                  = "TOOLBAR_DEBUG_ACTIVE"
    "ATTRIBUTES_VISIBLE"          = "LEGEND_ATTRIBUTES_ACTIVE"
    "DEFAULT_HIDDEN_ROOTS"        = "LEGEND_HIDDEN_ROOTS_DEFAULT"
    "DEFAULT_START_ID"            = "GRAPH_START_ID_DEFAULT"
    "HIDE_SUBTREE_BUTTON"         = "_REMOVE_"
    "OE_LEGEND_COLLAPSED"         = "LEGEND_OES_COLLAPSED"
    "ATTRIBUTE_LEGEND_COLLAPSED"  = "LEGEND_ATTRIBUTES_COLLAPSED"
    "CONTINUOUS_SIMULATION"       = "TOOLBAR_SIMULATION_ACTIVE"
    "HIDDEN_LEGEND_COLLAPSED"     = "LEGEND_HIDDEN_COLLAPSED"
    "DEFAULT_COLLAPSED_CATEGORIES" = "_REMOVE_"
}

$targetFiles = @(
    "public/env.example.json",
    "public/env.json",
    "src/app.js",
    "src/constants.js",
    "src/utils.js",
    "src/export.js"
)

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "=== ENV-Key Umbenennung ===" -ForegroundColor Cyan
Write-Host "Projekt: $projectRoot" -ForegroundColor Gray
Write-Host ""

$totalReplacements = 0

foreach ($relPath in $targetFiles) {
    $filePath = Join-Path $projectRoot $relPath
    
    if (-not (Test-Path $filePath)) {
        Write-Host "  SKIP: $relPath (nicht gefunden)" -ForegroundColor Yellow
        continue
    }
    
    $content = Get-Content $filePath -Raw -Encoding UTF8
    $originalContent = $content
    $fileReplacements = 0
    
    foreach ($oldKey in $keyMapping.Keys) {
        $newKey = $keyMapping[$oldKey]
        
        if ($newKey -eq "_REMOVE_") {
            if ($relPath -match "\.json$") {
                $pattern = '(?m)^\s*"' + [regex]::Escape($oldKey) + '"[^,\n]*,?\s*\n?'
                if ($content -match $pattern) {
                    $content = $content -replace $pattern, ""
                    $fileReplacements++
                    Write-Host "    REMOVE: $oldKey" -ForegroundColor Red
                }
            }
        }
        else {
            if ($content -match [regex]::Escape($oldKey)) {
                $content = $content -replace [regex]::Escape($oldKey), $newKey
                $count = ([regex]::Matches($originalContent, [regex]::Escape($oldKey))).Count
                $fileReplacements += $count
                Write-Host "    $oldKey -> $newKey ($count)" -ForegroundColor Green
            }
        }
    }
    
    if ($fileReplacements -gt 0) {
        Set-Content $filePath -Value $content -Encoding UTF8 -NoNewline
        Write-Host "  OK: $relPath ($fileReplacements Ersetzungen)" -ForegroundColor Cyan
        $totalReplacements += $fileReplacements
    }
    else {
        Write-Host "  OK: $relPath (keine Aenderungen)" -ForegroundColor Gray
    }
}

Write-Host ""
Write-Host "=== Fertig: $totalReplacements Ersetzungen ===" -ForegroundColor Cyan
