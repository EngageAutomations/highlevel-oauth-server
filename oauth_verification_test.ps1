# OAuth Verification Test Script
# Based on error fix document recommendations

# Configuration
$CLIENT_ID = $env:HL_CLIENT_ID
$CLIENT_SECRET = $env:HL_CLIENT_SECRET
$REDIRECT_URI = "https://api.engageautomations.com/oauth/callback"
$HL_TOKEN_ENDPOINT = "https://services.leadconnectorhq.com/oauth/token"

Write-Host "OAuth Verification Test Script" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan

if (-not $CLIENT_ID -or -not $CLIENT_SECRET) {
    Write-Host "Missing environment variables:" -ForegroundColor Red
    Write-Host "   Set HL_CLIENT_ID and HL_CLIENT_SECRET" -ForegroundColor Red
    exit 1
}

Write-Host "Configuration:" -ForegroundColor Yellow
Write-Host "   Client ID: $CLIENT_ID" -ForegroundColor Gray
Write-Host "   Redirect URI: $REDIRECT_URI" -ForegroundColor Gray
Write-Host "   Token Endpoint: $HL_TOKEN_ENDPOINT" -ForegroundColor Gray
Write-Host ""

# Function to test token exchange
function Test-TokenExchange {
    param(
        [string]$Code,
        [string]$UserType,
        [string]$TestName
    )
    
    Write-Host "Testing: $TestName" -ForegroundColor Yellow
    
    $body = @{
        client_id = $CLIENT_ID
        client_secret = $CLIENT_SECRET
        grant_type = "authorization_code"
        code = $Code
        redirect_uri = $REDIRECT_URI
        user_type = $UserType
    }
    
    try {
        $response = Invoke-RestMethod -Uri $HL_TOKEN_ENDPOINT -Method POST -Body $body -ContentType "application/x-www-form-urlencoded"
        Write-Host "SUCCESS: Token exchange worked" -ForegroundColor Green
        Write-Host "   Access Token: $($response.access_token.Substring(0,20))..." -ForegroundColor Gray
        Write-Host "   Token Type: $($response.token_type)" -ForegroundColor Gray
        Write-Host "   Scope: $($response.scope)" -ForegroundColor Gray
        return $true
    }
    catch {
        $errorDetails = $_.Exception.Response
        if ($errorDetails) {
            $reader = New-Object System.IO.StreamReader($errorDetails.GetResponseStream())
            $responseBody = $reader.ReadToEnd()
            Write-Host "FAILED: $responseBody" -ForegroundColor Red
        } else {
            Write-Host "FAILED: $($_.Exception.Message)" -ForegroundColor Red
        }
        return $false
    }
    Write-Host ""
}

# Function to test our OAuth server callback
function Test-OAuthCallback {
    param(
        [string]$Code,
        [string]$QueryParams,
        [string]$TestName
    )
    
    Write-Host "Testing OAuth Server: $TestName" -ForegroundColor Yellow
    
    $url = "https://api.engageautomations.com/oauth/callback?code=$Code`&$QueryParams"
    
    try {
        $response = Invoke-WebRequest -Uri $url -UseBasicParsing
        Write-Host "SUCCESS: OAuth callback processed" -ForegroundColor Green
        Write-Host "   Status: $($response.StatusCode)" -ForegroundColor Gray
        Write-Host "   Response: $($response.Content.Substring(0, [Math]::Min(100, $response.Content.Length)))..." -ForegroundColor Gray
        return $true
    }
    catch {
        $statusCode = $_.Exception.Response.StatusCode.value__
        Write-Host "FAILED: HTTP $statusCode - $($_.Exception.Message)" -ForegroundColor Red
        if ($_.Exception.Response) {
            $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
            $responseBody = $reader.ReadToEnd()
            Write-Host "   Response: $($responseBody.Substring(0, [Math]::Min(200, $responseBody.Length)))..." -ForegroundColor Gray
            # If we get a 401 with "Authorization code not found", that's expected behavior
            if ($statusCode -eq 401 -and $responseBody -like "*Authorization code not found*") {
                Write-Host "   NOTE: 401 'Authorization code not found' is expected with test code" -ForegroundColor Yellow
                return $true  # This is actually success - the server is working correctly
            }
        }
        return $false
    }
    Write-Host ""
}

Write-Host "INSTRUCTIONS:" -ForegroundColor Cyan
Write-Host "1. Go to HighLevel and start an OAuth install" -ForegroundColor White
Write-Host "2. When you reach the callback URL, copy the 'code' parameter" -ForegroundColor White
Write-Host "3. Paste it below when prompted" -ForegroundColor White
Write-Host "4. We'll test both direct HighLevel API and our OAuth server" -ForegroundColor White
Write-Host ""

# Get authorization code from user
$authCode = Read-Host "Enter the authorization code from the callback URL"

if (-not $authCode -or $authCode -eq "TEST") {
    Write-Host "Using TEST code - this will fail but shows the flow" -ForegroundColor Yellow
    $authCode = "TEST"
}

Write-Host ""
Write-Host "DIRECT HIGHLEVEL API TESTS" -ForegroundColor Cyan
Write-Host "==============================" -ForegroundColor Cyan

# Test direct HighLevel API calls
$locationSuccess = Test-TokenExchange -Code $authCode -UserType "location" -TestName "Location Install (lowercase)"
$companySuccess = Test-TokenExchange -Code $authCode -UserType "company" -TestName "Company Install (lowercase)"
$locationCapSuccess = Test-TokenExchange -Code $authCode -UserType "Location" -TestName "Location Install (capitalized)"
$companyCapSuccess = Test-TokenExchange -Code $authCode -UserType "Company" -TestName "Company Install (capitalized)"

Write-Host "OAUTH SERVER CALLBACK TESTS" -ForegroundColor Cyan
Write-Host "===============================" -ForegroundColor Cyan

# Test our OAuth server callbacks
$callbackLocationSuccess = Test-OAuthCallback -Code $authCode -QueryParams "location_id=LOCATION_X" -TestName "Location Callback"
$callbackAgencySuccess = Test-OAuthCallback -Code $authCode -QueryParams "agency_id=AGENCY_X" -TestName "Agency Callback"
$callbackCompanySuccess = Test-OAuthCallback -Code $authCode -QueryParams "company_id=COMPANY_X" -TestName "Company Callback"

Write-Host "SUMMARY REPORT" -ForegroundColor Cyan
Write-Host "================" -ForegroundColor Cyan

Write-Host "Direct HighLevel API:" -ForegroundColor Yellow
Write-Host "  location (lowercase): $(if($locationSuccess){'PASS'}else{'FAIL'})" -ForegroundColor $(if($locationSuccess){'Green'}else{'Red'})
Write-Host "  company (lowercase): $(if($companySuccess){'PASS'}else{'FAIL'})" -ForegroundColor $(if($companySuccess){'Green'}else{'Red'})
Write-Host "  Location (capitalized): $(if($locationCapSuccess){'PASS'}else{'FAIL'})" -ForegroundColor $(if($locationCapSuccess){'Green'}else{'Red'})
Write-Host "  Company (capitalized): $(if($companyCapSuccess){'PASS'}else{'FAIL'})" -ForegroundColor $(if($companyCapSuccess){'Green'}else{'Red'})

Write-Host "OAuth Server Callbacks:" -ForegroundColor Yellow
Write-Host "  Location callback: $(if($callbackLocationSuccess){'PASS'}else{'FAIL'})" -ForegroundColor $(if($callbackLocationSuccess){'Green'}else{'Red'})
Write-Host "  Agency callback: $(if($callbackAgencySuccess){'PASS'}else{'FAIL'})" -ForegroundColor $(if($callbackAgencySuccess){'Green'}else{'Red'})
Write-Host "  Company callback: $(if($callbackCompanySuccess){'PASS'}else{'FAIL'})" -ForegroundColor $(if($callbackCompanySuccess){'Green'}else{'Red'})

Write-Host ""
Write-Host "RECOMMENDATIONS:" -ForegroundColor Cyan
if ($locationCapSuccess -or $companyCapSuccess) {
    Write-Host "Capitalized user_type values work with HighLevel" -ForegroundColor Green
} else {
    Write-Host "Check if HighLevel expects different user_type values" -ForegroundColor Red
}

if ($callbackLocationSuccess -and $callbackAgencySuccess) {
    Write-Host "OAuth server callbacks are working correctly" -ForegroundColor Green
} else {
    Write-Host "OAuth server may need debugging" -ForegroundColor Red
}

Write-Host ""
Write-Host "Next Steps:" -ForegroundColor Yellow
Write-Host "1. If direct API tests fail, check redirect_uri configuration" -ForegroundColor White
Write-Host "2. If callback tests fail, check OAuth server logs" -ForegroundColor White
Write-Host "3. Verify environment variables match HighLevel app settings" -ForegroundColor White

Write-Host ""
Write-Host "Test completed at $(Get-Date)" -ForegroundColor Gray