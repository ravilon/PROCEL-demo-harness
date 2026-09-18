param(
    [string]$HostName,
    [int]$Port = 0,
    [string]$Topic,
    [string]$Message,
    [string]$PayloadFile,
    [string]$Username,
    [string]$Password,
    [switch]$Tls,
    [ValidateRange(0, 2)] [int]$Qos = 1,
    [switch]$Retain,
    [switch]$Interactive
)

$ErrorActionPreference = 'Stop'

$envFile = Join-Path $PSScriptRoot '.env'
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        $line = $_.Trim()
        if (-not $line -or $line.StartsWith('#')) { return }
        $parts = $line.Split('=', 2)
        if ($parts.Count -ne 2) { return }
        $name = $parts[0].Trim()
        $value = $parts[1].Trim()
        if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
            $value = $value.Substring(1, $value.Length - 2)
        }
        [Environment]::SetEnvironmentVariable($name, $value, 'Process')
    }
}

function Get-Setting {
    param([string]$Name, [string]$Default = '')
    $value = [Environment]::GetEnvironmentVariable($Name, 'Process')
    if ([string]::IsNullOrWhiteSpace($value)) { return $Default }
    return $value
}

if (-not $HostName) { $HostName = Get-Setting 'PROCEL_MQTT_HOST' 'localhost' }
if (-not $Port) { $Port = [int](Get-Setting 'PROCEL_MQTT_PORT' '1883') }
if (-not $Username) { $Username = Get-Setting 'PROCEL_MQTT_USERNAME' }
if (-not $Password) { $Password = Get-Setting 'PROCEL_MQTT_PASSWORD' }
if (-not $Tls) { $Tls = (Get-Setting 'PROCEL_MQTT_TLS' 'false').ToLowerInvariant() -eq 'true' }

if ([string]::IsNullOrWhiteSpace($HostName)) {
    throw 'MQTT host is required. Set PROCEL_MQTT_HOST in .env or pass -HostName.'
}
if ($HostName -match '^[a-zA-Z][a-zA-Z0-9+.-]*://') {
    throw 'MQTT host must be a hostname or IP address without http:// or mqtt://. Set TLS and port separately.'
}

$localMosquitto = Get-Command mosquitto_pub -ErrorAction SilentlyContinue
$docker = Get-Command docker -ErrorAction SilentlyContinue
if (-not $localMosquitto -and -not $docker) {
    throw 'mosquitto_pub was not found and Docker is unavailable. Install Mosquitto or Docker.'
}

function Publish-Message {
    param(
        [Parameter(Mandatory)] [string]$PublishTopic,
        [Parameter(Mandatory)] [string]$PublishMessage
    )

    $args = @('-h', $HostName, '-p', $Port, '-q', $Qos, '-t', $PublishTopic, '-m', $PublishMessage)
    if ($Username) { $args += @('-u', $Username) }
    if ($Password) { $args += @('-P', $Password) }
    if ($Tls) { $args += '--tls-use-os-certs' }
    if ($Retain) { $args += '-r' }

    if ($localMosquitto) {
        & $localMosquitto.Source @args
    } else {
        if ($HostName -eq 'localhost' -or $HostName -eq '127.0.0.1') {
            $args[1] = '127.0.0.1'
            & docker compose exec -T mqtt mosquitto_pub @args
        } else {
            & docker run --rm eclipse-mosquitto:2 mosquitto_pub @args
        }
    }
    if ($LASTEXITCODE -ne 0) {
        throw "mosquitto_pub failed with exit code $LASTEXITCODE while publishing to $HostName`:$Port. Check broker address, port, TLS, credentials, and the client error above."
    }
    Write-Host "Published to $PublishTopic"
}

function Get-MessageText {
    if ($PayloadFile) {
        if (-not (Test-Path $PayloadFile)) { throw "Payload file not found: $PayloadFile" }
        return Get-Content $PayloadFile -Raw
    }
    if ($null -ne $Message) { return $Message }
    return Read-Host 'Message'
}

if ($Interactive -or [string]::IsNullOrWhiteSpace($Topic)) {
    Write-Host "MQTT console connected to $HostName`:$Port"
    Write-Host 'Enter a topic and message. Type q as the topic to quit.'
    while ($true) {
        $currentTopic = Read-Host 'Topic'
        if ($currentTopic -eq 'q') { break }
        if ([string]::IsNullOrWhiteSpace($currentTopic)) { continue }
        $currentMessage = Read-Host 'Message'
        Publish-Message -PublishTopic $currentTopic -PublishMessage $currentMessage
    }
    return
}

Publish-Message -PublishTopic $Topic -PublishMessage (Get-MessageText)
