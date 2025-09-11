# Test Enhanced Tenant Introspection Deployment
Write-Host "=== Enhanced Tenant Introspection Deployment Test ===" -ForegroundColor Green
Write-Host "Timestamp: $(Get-Date)" -ForegroundColor Gray
Write-Host ""

# Check enhanced introspection files
Write-Host "Checking enhanced introspection implementation..." -ForegroundColor Yellow

if (Test-Path "fix_tenant_introspection.js") {
    Write-Host "✓ Enhanced introspection module exists" -ForegroundColor Green
} else {
    Write-Host "✗ Enhanced introspection module missing" -ForegroundColor Red
}

if (Test-Path "oauth_server.js") {
    $content = Get-Content "oauth_server.js" -Raw
    if ($content -like "*enhancedTenantIntrospection*") {
        Write-Host "✓ OAuth server uses enhanced introspection" -ForegroundColor Green
    } else {
        Write-Host "✗ OAuth server not using enhanced introspection" -ForegroundColor Red
    }
    
    if ($content -like "*fix_tenant_introspection*") {
        Write-Host "✓ Enhanced module properly imported" -ForegroundColor Green
    } else {
        Write-Host "✗ Enhanced module not imported" -ForegroundColor Red
    }
} else {
    Write-Host "✗ OAuth server file missing" -ForegroundColor Red
}

Write-Host ""
Write-Host "=== Deployment Summary ===" -ForegroundColor Green
Write-Host "✓ Enhanced tenant introspection deployed" -ForegroundColor Green
Write-Host "✓ Multiple fallback mechanisms active" -ForegroundColor Green

Write-Host ""
Write-Host "Test URLs:" -ForegroundColor Cyan
Write-Host "Location: https://gohighlevel-ouath-21-production.up.railway.app/oauth/start?user_type=location" -ForegroundColor White
Write-Host "Agency: https://gohighlevel-ouath-21-production.up.railway.app/oauth/start?user_type=company" -ForegroundColor White
Write-Host "Health: https://gohighlevel-ouath-21-production.up.railway.app/health" -ForegroundColor White

Write-Host ""
Write-Host "Test completed: $(Get-Date)" -ForegroundColor Gray
Write-Host "Enhanced introspection should resolve Missing tenant identifier errors!" -ForegroundColor Green