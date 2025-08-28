# PowerShell test script untuk demo cepat

$ErrorActionPreference = "Stop"

function Invoke-JsonPost($url, $body, $headers=@{}) {
  $json = $body | ConvertTo-Json -Depth 10
  Invoke-RestMethod -Method Post -Uri $url -Headers $headers -ContentType 'application/json' -Body $json
}

Write-Host "1) Create queue u1" -ForegroundColor Cyan
Invoke-JsonPost "http://localhost:3000/create-queue" @{ userId = "u1" }

Write-Host "2) Start consumer u1 (admin)" -ForegroundColor Cyan
Invoke-JsonPost "http://localhost:3000/admin/start-consumer" @{ userId = "u1" } @{ 'x-api-key' = "change-me" }

Write-Host "3) Send message to u1" -ForegroundColor Cyan
Invoke-JsonPost "http://localhost:3000/send-message" @{ userId = "u1"; callbackUrl = "http://localhost:3000/_test/callback"; payload = @{ hello = "world" } }

Write-Host "4) List queues (admin)" -ForegroundColor Cyan
Invoke-RestMethod -Method Get -Uri "http://localhost:3000/admin/queues" -Headers @{ 'x-api-key' = "change-me" }

Write-Host "5) Stop consumer u1 (admin)" -ForegroundColor Cyan
Invoke-JsonPost "http://localhost:3000/admin/stop-consumer" @{ userId = "u1" } @{ 'x-api-key' = "change-me" }

Write-Host "Done"



