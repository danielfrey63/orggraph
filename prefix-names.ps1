# prefix-names.ps1
# Reads email addresses from temp.txt and prefixes them with
# <Vorname><tab><Nachname><tab> based on data from public/data.sem-n.json

$dataPath = Join-Path $PSScriptRoot "public/data.sem-n.json"
$inputPath = Join-Path $PSScriptRoot "temp.txt"
$outputPath = Join-Path $PSScriptRoot "temp-out.txt"

# Load JSON and build email -> (Vorname, Nachname) lookup
$json = Get-Content $dataPath -Raw -Encoding UTF8 | ConvertFrom-Json
$lookup = @{}
foreach ($person in $json.persons) {
    if (-not $person.email) { continue }
    $email = $person.email.Trim().ToLower()
    $parts = $person.label.Trim() -split '\s+'
    if ($parts.Count -ge 2) {
        $vorname  = ($parts[0..($parts.Count - 2)]) -join ' '
        $nachname = $parts[-1]
    } else {
        $vorname  = $person.label.Trim()
        $nachname = ''
    }
    $lookup[$email] = @{ Vorname = $vorname; Nachname = $nachname }
}

# Process each line from temp.txt
$results = Get-Content $inputPath -Encoding UTF8 | ForEach-Object {
    # Strip leading line numbers like " 1 | "
    $line = $_ -replace '^\s*\d+\s*\|\s*', ''
    $email = $line.Trim()

    if ([string]::IsNullOrWhiteSpace($email)) {
        return ''
    }

    $key = $email.ToLower()
    if ($lookup.ContainsKey($key)) {
        $v = $lookup[$key].Vorname
        $n = $lookup[$key].Nachname
        "$v`t$n`t$email"
    } else {
        "???`t???`t$email"
    }
}

# Output to console and file
$results | ForEach-Object { Write-Host $_ }
$results | Set-Content $outputPath -Encoding UTF8
Write-Host "`nResult written to $outputPath"
