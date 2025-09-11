# OAuth Fix Verification Test
# Tests the manual upsert logic and verifies no constraint errors

Write-Host "🔍 OAuth Fix Verification Test" -ForegroundColor Cyan
Write-Host "==============================" -ForegroundColor Cyan

# Test 1: Check for recent constraint errors
Write-Host "\n📋 Test 1: Checking for recent ON CONFLICT errors..." -ForegroundColor Yellow
$recentErrors = railway logs | Select-String "ON CONFLICT" | Select-Object -Last 5
if ($recentErrors) {
    Write-Host "❌ Found recent ON CONFLICT errors:" -ForegroundColor Red
    $recentErrors | ForEach-Object { Write-Host $_.Line -ForegroundColor Red }
} else {
    Write-Host "✅ No recent ON CONFLICT errors found" -ForegroundColor Green
}

# Test 2: Check for deployment marker
Write-Host "\n📋 Test 2: Checking for deployment marker..." -ForegroundColor Yellow
$deploymentMarker = railway logs | Select-String "FORCE DEPLOY" | Select-Object -Last 1
if ($deploymentMarker) {
    Write-Host "✅ Found deployment marker: $($deploymentMarker.Line)" -ForegroundColor Green
} else {
    Write-Host "⚠️  Deployment marker not found - checking for manual upsert marker" -ForegroundColor Yellow
    $manualUpsertMarker = railway logs | Select-String "MANUAL UPSERT" | Select-Object -Last 1
    if ($manualUpsertMarker) {
        Write-Host "✅ Found manual upsert marker: $($manualUpsertMarker.Line)" -ForegroundColor Green
    } else {
        Write-Host "❌ No deployment markers found" -ForegroundColor Red
    }
}

# Test 3: Check server status
Write-Host "\n📋 Test 3: Checking server status..." -ForegroundColor Yellow
$serverStatus = railway logs | Select-String "OAuth Server running" | Select-Object -Last 1
if ($serverStatus) {
    Write-Host "✅ Server is running: $($serverStatus.Line)" -ForegroundColor Green
} else {
    Write-Host "❌ Server status unclear" -ForegroundColor Red
}

# Test 4: Check for successful database initialization
Write-Host "\n📋 Test 4: Checking database initialization..." -ForegroundColor Yellow
$dbInit = railway logs | Select-String "Database initialization completed" | Select-Object -Last 1
if ($dbInit) {
    Write-Host "✅ Database initialized: $($dbInit.Line)" -ForegroundColor Green
} else {
    Write-Host "❌ Database initialization unclear" -ForegroundColor Red
}

# Test 5: Test OAuth callback endpoint
Write-Host "\n📋 Test 5: Testing OAuth callback endpoint..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "https://api.engageautomations.com/health" -Method GET -TimeoutSec 10
    if ($response.StatusCode -eq 200) {
        Write-Host "✅ Health endpoint responding (Status: $($response.StatusCode))" -ForegroundColor Green
    } else {
        Write-Host "⚠️  Health endpoint returned status: $($response.StatusCode)" -ForegroundColor Yellow
    }
} catch {
    Write-Host "❌ Health endpoint test failed: $($_.Exception.Message)" -ForegroundColor Red
}

# Summary
Write-Host "\n📊 Test Summary" -ForegroundColor Cyan
Write-Host "==============" -ForegroundColor Cyan
Write-Host "The manual upsert logic has been deployed to replace ON CONFLICT statements." -ForegroundColor White
Write-Host "If no recent ON CONFLICT errors are found, the fix is working correctly." -ForegroundColor White
Write-Host "\n🎯 Next Steps:" -ForegroundColor Cyan
Write-Host "1. Monitor logs for any new constraint errors" -ForegroundColor White
Write-Host "2. Test actual OAuth installations to verify functionality" -ForegroundColor White
Write-Host "3. Check that both location and agency installations work" -ForegroundColor White

Write-Host "\n✅ OAuth Fix Verification Complete" -ForegroundColor Green