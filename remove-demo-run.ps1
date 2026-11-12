param(
    [Parameter(Mandatory = $true)]
    [string] $RunDirectory
)

$runsRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'runs'))
$target = [System.IO.Path]::GetFullPath($RunDirectory)
$prefix = $runsRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
if (-not $target.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "O diretório precisa estar dentro de '$runsRoot'."
}
if (-not (Test-Path -LiteralPath (Join-Path $target 'manifest.json') -PathType Leaf)) {
    throw 'Manifesto da execução não encontrado; remoção cancelada.'
}
$manifest = Get-Content -LiteralPath (Join-Path $target 'manifest.json') -Raw | ConvertFrom-Json
if (-not $manifest.runId -or -not $manifest.hashSha256) {
    throw 'Manifesto não identifica uma execução válida; remoção cancelada.'
}
Remove-Item -LiteralPath $target -Recurse -Force
Write-Output "Execução local removida: $target"
