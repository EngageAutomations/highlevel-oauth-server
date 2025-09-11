# OAuth Flow Diagnostic Script
# This script helps diagnose why tenant identifiers are missing

Write-Host "=== HighLevel OAuth Flow Diagnostics ===" -ForegroundColor Cyan
Write-Host "This script will help identify why tenant identifiers are missing" -ForegroundColor White
Write-Host ""

$baseUrl = "https://api.engageautomations.com"

# Step 1: Generate OAuth start URL
Write-Host "STEP 1: Generating OAuth Authorization URL" -ForegroundColor Yellow
try {
    $startResponse = Invoke-RestMethod -Uri "$baseUrl/oauth/start?json=1" -Headers @{'Accept'='application/json'} -Method GET
    
    if ($startResponse.authorize_url) {
        Write-Host "Success: Authorization URL generated" -ForegroundColor Green
        Write-Host "URL: $($startResponse.authorize_url)" -ForegroundColor Gray
        Write-Host "State: $($startResponse.state)" -ForegroundColor Gray
        
        Write-Host "" 
        Write-Host "Authorization URL Parameters:" -ForegroundColor Cyan
        $uri = [System.Uri]$startResponse.authorize_url
        $query = [System.Web.HttpUtility]::ParseQueryString($uri.Query)
        
        foreach ($key in $query.Keys) {
            Write-Host "  $key = $($query[$key])" -ForegroundColor White
        }
        
        Write-Host ""
        Write-Host "IMPORTANT: Check if the authorization URL includes:" -ForegroundColor Yellow
        Write-Host "  - response_type=code" -ForegroundColor White
        Write-Host "  - client_id (should match your HighLevel app)" -ForegroundColor White
        Write-Host "  - redirect_uri (should be $baseUrl/oauth/callback)" -ForegroundColor White
        Write-Host "  - scope (should include required permissions)" -ForegroundColor White
        
    } else {
        Write-Host "Error: Failed to generate authorization URL" -ForegroundColor Red
    }
} catch {
    Write-Host "Error generating authorization URL: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""
Write-Host "STEP 2: Manual Testing Instructions" -ForegroundColor Yellow
Write-Host "1. Copy the authorization URL above and paste it in a browser" -ForegroundColor White
Write-Host "2. Complete the HighLevel OAuth flow (choose agency or location)" -ForegroundColor White
Write-Host "3. After redirect, check the callback URL parameters" -ForegroundColor White
Write-Host "4. Look for these parameters in the callback URL:" -ForegroundColor White
Write-Host "   - code (authorization code)" -ForegroundColor Gray
Write-Host "   - state (should match the state above)" -ForegroundColor Gray
Write-Host "   - location_id (for location installs)" -ForegroundColor Gray
Write-Host "   - company_id or agency_id (for agency installs)" -ForegroundColor Gray

Write-Host ""
Write-Host "STEP 3: Common Issues and Solutions" -ForegroundColor Yellow
Write-Host ""
Write-Host "If tenant identifiers are missing from callback:" -ForegroundColor Cyan
Write-Host "  1. HighLevel app configuration issue" -ForegroundColor White
Write-Host "     - Check app settings in HighLevel Marketplace" -ForegroundColor Gray
Write-Host "     - Verify redirect URI matches exactly" -ForegroundColor Gray
Write-Host "     - Ensure app has proper permissions" -ForegroundColor Gray
Write-Host ""
Write-Host "  2. OAuth scope issues" -ForegroundColor White
Write-Host "     - Missing required scopes for tenant access" -ForegroundColor Gray
Write-Host "     - Need locations.readonly and companies.readonly" -ForegroundColor Gray
Write-Host ""
Write-Host "  3. HighLevel API changes" -ForegroundColor White
Write-Host "     - /users/me endpoint may have changed" -ForegroundColor Gray
Write-Host "     - Alternative endpoints might be needed" -ForegroundColor Gray

Write-Host ""
Write-Host "STEP 4: Environment Check" -ForegroundColor Yellow

# Check current environment variables (without exposing secrets)
try {
    $healthResponse = Invoke-RestMethod -Uri "$baseUrl/health" -Method GET
    Write-Host "Server Health: $($healthResponse.status)" -ForegroundColor Green
    Write-Host "Server Version: $($healthResponse.version)" -ForegroundColor Green
    Write-Host "Environment: $($healthResponse.environment)" -ForegroundColor Green
} catch {
    Write-Host "Server health check failed: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""
Write-Host "STEP 5: Next Steps" -ForegroundColor Yellow
Write-Host "If tenant identifiers are still missing after manual testing:" -ForegroundColor White
Write-Host "1. Check HighLevel app configuration in Marketplace" -ForegroundColor Gray
Write-Host "2. Verify OAuth scopes include tenant access permissions" -ForegroundColor Gray
Write-Host "3. Test with different HighLevel accounts (agency vs location)" -ForegroundColor Gray
Write-Host "4. Contact HighLevel support for API guidance" -ForegroundColor Gray

Write-Host ""
Write-Host "Run this script and follow the manual testing steps to identify the root cause" -ForegroundColor Green
Write-Host "Document what parameters HighLevel actually sends in the callback" -ForegroundColor Green

$currentTime = Get-Date
Write-Host ""
Write-Host "Diagnostic completed at $currentTime" -ForegroundColor Gray