# Test Enhanced Tenant Introspection
Write-Host "=== Enhanced Tenant Introspection Test ===" -ForegroundColor Cyan
Write-Host "Testing the new multi-strategy approach to fix 'Missing tenant identifier' error"
Write-Host ""

# Test 1: Check if enhanced introspection module exists
Write-Host "STEP 1: Checking enhanced introspection module" -ForegroundColor Yellow
if (Test-Path "fix_tenant_introspection.js") {
    Write-Host "✓ Enhanced introspection module exists" -ForegroundColor Green
} else {
    Write-Host "✗ Enhanced introspection module not found" -ForegroundColor Red
}

# Test 2: Check if oauth_server.js has been updated
Write-Host "STEP 2: Checking oauth_server.js integration" -ForegroundColor Yellow
$oauthContent = Get-Content "oauth_server.js" -Raw
if ($oauthContent -match "enhancedTenantIntrospection") {
    Write-Host "✓ Enhanced introspection integrated" -ForegroundColor Green
} else {
    Write-Host "✗ Enhanced introspection not integrated" -ForegroundColor Red
}

# Test 3: Check dependencies
Write-Host "STEP 3: Checking dependencies" -ForegroundColor Yellow
if (Test-Path "package.json") {
    Write-Host "✓ package.json found" -ForegroundColor Green
} else {
    Write-Host "✗ package.json not found" -ForegroundColor Red
}

# Test 4: Show enhanced strategies
Write-Host "STEP 4: Enhanced Introspection Strategies" -ForegroundColor Yellow
Write-Host "The new implementation includes multiple fallback strategies:"
Write-Host "  1. /users/me endpoint (original approach)"
Write-Host "  2. /locations endpoint (list accessible locations)"
Write-Host "  3. /companies endpoint (for agency-level tokens)"
Write-Host "  4. /oauth/userinfo endpoint (if available)"
Write-Host "  5. Token introspection endpoint"
Write-Host "  + JWT token payload parsing (if token is JWT format)"

# Test 5: Next steps
Write-Host "STEP 5: Next Steps" -ForegroundColor Yellow
Write-Host "To deploy and test:"
Write-Host "1. Deploy to Railway: railway up"
Write-Host "2. Test OAuth flow and monitor logs"
Write-Host "3. Look for 'Enhanced introspection completed' in logs"

# Summary
Write-Host "=== SUMMARY ===" -ForegroundColor Cyan
Write-Host "Enhanced introspection should resolve the persistent"
Write-Host "'Missing tenant identifier' error by trying multiple"
Write-Host "HighLevel API endpoints instead of relying only on /users/me."

$currentDate = Get-Date
Write-Host "Test completed at $currentDate" -ForegroundColor Gray