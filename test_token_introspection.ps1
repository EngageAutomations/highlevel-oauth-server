# Test Token Introspection
# This script tests what happens when we try to introspect a HighLevel token

Write-Host "=== HighLevel Token Introspection Test ===" -ForegroundColor Cyan
Write-Host "This script simulates the missing tenant identifier issue" -ForegroundColor White
Write-Host ""

$baseUrl = "https://api.engageautomations.com"

# Test 1: Simulate callback without tenant parameters
Write-Host "TEST 1: Simulating OAuth callback without tenant parameters" -ForegroundColor Yellow

# Generate a test state first
try {
    $startResponse = Invoke-RestMethod -Uri "$baseUrl/oauth/start?json=1" -Headers @{'Accept'='application/json'} -Method GET
    $testState = $startResponse.state
    Write-Host "Generated test state: $testState" -ForegroundColor Gray
} catch {
    Write-Host "Failed to generate test state: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Test callback with missing tenant info (this should trigger the introspection)
Write-Host "\nTesting callback with missing tenant parameters..." -ForegroundColor Cyan

try {
    # Simulate what happens when HighLevel sends callback without location_id/company_id
    $callbackUrl = "$baseUrl/oauth/callback?code=test_code_missing_tenant&state=$testState"
    
    Write-Host "Callback URL: $callbackUrl" -ForegroundColor Gray
    
    # This should fail with "Missing tenant identifier" error
    $callbackResponse = Invoke-RestMethod -Uri $callbackUrl -Method GET -ErrorAction Stop
    
    Write-Host "Unexpected success: $($callbackResponse | ConvertTo-Json)" -ForegroundColor Yellow
    
} catch {
    $errorResponse = $_.Exception.Response
    if ($errorResponse) {
        $reader = New-Object System.IO.StreamReader($errorResponse.GetResponseStream())
        $responseBody = $reader.ReadToEnd()
        $reader.Close()
        
        Write-Host "Expected error response:" -ForegroundColor Green
        Write-Host "Status: $($errorResponse.StatusCode)" -ForegroundColor White
        Write-Host "Body: $responseBody" -ForegroundColor White
        
        # Parse the JSON error
        try {
            $errorJson = $responseBody | ConvertFrom-Json
            if ($errorJson.error -eq "Missing tenant identifier") {
                Write-Host "\nCONFIRMED: This is the exact error you're experiencing" -ForegroundColor Red
                Write-Host "Root cause: HighLevel is not sending tenant parameters in callback" -ForegroundColor Red
            }
        } catch {
            Write-Host "Could not parse error JSON" -ForegroundColor Yellow
        }
    } else {
        Write-Host "Network error: $($_.Exception.Message)" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "TEST 2: Check what HighLevel API endpoints are available" -ForegroundColor Yellow

# Test the /users/me endpoint directly (this is what's failing in introspection)
Write-Host "\nTesting /users/me endpoint behavior..." -ForegroundColor Cyan
Write-Host "NOTE: This will fail because we don't have a real token, but shows the endpoint structure" -ForegroundColor Gray

try {
    # This will fail, but we can see the error structure
    $meResponse = Invoke-RestMethod -Uri "https://services.leadconnectorhq.com/users/me" -Headers @{
        'Authorization' = 'Bearer fake_token_for_testing'
        'Version' = '2021-07-28'
    } -Method GET -ErrorAction Stop
    
} catch {
    $errorResponse = $_.Exception.Response
    if ($errorResponse) {
        $reader = New-Object System.IO.StreamReader($errorResponse.GetResponseStream())
        $responseBody = $reader.ReadToEnd()
        $reader.Close()
        
        Write-Host "Expected /users/me error:" -ForegroundColor Yellow
        Write-Host "Status: $($errorResponse.StatusCode)" -ForegroundColor White
        Write-Host "Body: $responseBody" -ForegroundColor White
        
        if ($responseBody -like "*User id me not found*") {
            Write-Host "\nCONFIRMED: /users/me endpoint returns 'User id me not found'" -ForegroundColor Red
            Write-Host "This suggests the endpoint may have changed or requires different authentication" -ForegroundColor Red
        }
    }
}

Write-Host ""
Write-Host "ANALYSIS AND SOLUTIONS" -ForegroundColor Yellow
Write-Host "\nThe persistent 'Missing tenant identifier' error occurs because:" -ForegroundColor Cyan

Write-Host "\n1. HighLevel OAuth Flow Issue:" -ForegroundColor White
Write-Host "   - HighLevel is not sending location_id/company_id in callback URL" -ForegroundColor Gray
Write-Host "   - This forces the server to attempt introspection via /users/me" -ForegroundColor Gray

Write-Host "\n2. Introspection Failure:" -ForegroundColor White
Write-Host "   - /users/me endpoint returns 'User id me not found'" -ForegroundColor Gray
Write-Host "   - This could mean the endpoint changed or token lacks permissions" -ForegroundColor Gray

Write-Host "\n3. Possible Solutions:" -ForegroundColor White
Write-Host "   A. Fix HighLevel App Configuration:" -ForegroundColor Green
Write-Host "      - Ensure app is configured to send tenant parameters" -ForegroundColor Gray
Write-Host "      - Check redirect URI configuration" -ForegroundColor Gray
Write-Host "      - Verify app permissions in HighLevel Marketplace" -ForegroundColor Gray

Write-Host "\n   B. Update Introspection Logic:" -ForegroundColor Green
Write-Host "      - Try alternative endpoints like /locations or /users/search" -ForegroundColor Gray
Write-Host "      - Update API version or authentication method" -ForegroundColor Gray
Write-Host "      - Add fallback mechanisms" -ForegroundColor Gray

Write-Host "\n   C. Require Manual Tenant Selection:" -ForegroundColor Green
Write-Host "      - Modify OAuth flow to always require explicit tenant choice" -ForegroundColor Gray
Write-Host "      - Add tenant selection UI before OAuth redirect" -ForegroundColor Gray

Write-Host ""
Write-Host "IMMEDIATE NEXT STEPS:" -ForegroundColor Yellow
Write-Host "1. Check your HighLevel Marketplace app configuration" -ForegroundColor White
Write-Host "2. Verify the redirect URI matches exactly: $baseUrl/oauth/callback" -ForegroundColor White
Write-Host "3. Test with a fresh HighLevel app if needed" -ForegroundColor White
Write-Host "4. Contact HighLevel support about tenant parameter requirements" -ForegroundColor White

$currentTime = Get-Date
Write-Host ""
Write-Host "Introspection test completed at $currentTime" -ForegroundColor Gray