$ApiKey = "YtiOlU2/GWqjKIIJmpScUaYuvtQFEMMmutZxeZeNrOk="
$Timestamp = [DateTimeOffset]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
$MessageId = "manual-$([Guid]::NewGuid().ToString('N'))"

$Body = @{
    producerId = "demo-presenter"
    sensorId = "IDEALSENSOR_347"
    messageId = $MessageId
    sourceTimestamp = $Timestamp
    payload = @{
        messageId = $MessageId
        timestamp = $Timestamp
        light = $false
        presence = $false
        temperature = 32.4
    }
} | ConvertTo-Json -Depth 10

Invoke-RestMethod `
    -Uri "http://187.77.58.122:3000/publish" `
    -Method Post `
    -Headers @{
        Authorization = "Bearer $ApiKey"
    } `
    -ContentType "application/json" `
    -Body $Body