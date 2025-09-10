# Comprehensive OAuth Debugging Script
# Implements the ChatGPT diagnostic workflow for invalid_grant errors

param(
    [Parameter(Mandatory=$false)]
    [string]$AuthCode,
    [Parameter(Mandatory=$false)]
    [string]$UserType = "location",
    [Parameter(Mandatory=$false)]
    [switch]$SkipGoldenTest,
    [Parameter(Mandatory=$false)]
    [string]$OAuthServerUrl = "https://api.engageautomations.com"
)

$CLIENT_ID = $env:HL_CLIENT_ID
$CLIENT_SECRET = $env:HL_CLIENT_SECRET
$REDIRECT_URI = "https://api.engageautomations.com/oauth/callback"
$TOKEN_ENDPOINT = "https://services.leadconnectorhq.com/oauth/token"

Write-Host "OAuth Comprehensive Diagnostic Test" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""

if (-not $CLIENT_ID -or -not $CLIENT_SECRET) {
    Write-Host "ERROR: Missing environment variables" -ForegroundColor Red
    Write-Host "Please set HL_CLIENT_ID and HL_CLIENT_SECRET" -ForegroundColor Red
    Write-Host ""
    Write-Host "Example:" -ForegroundColor Yellow
    Write-Host '  $env:HL_CLIENT_ID="your_client_id"' -ForegroundColor Gray
    Write-Host '  $env:HL_CLIENT_SECRET="your_client_secret"' -ForegroundColor Gray
    exit 1
}

Write-Host "Configuration Check:" -ForegroundColor Yellow
Write-Host "  Client ID: $CLIENT_ID" -ForegroundColor Gray
Write-Host "  Redirect URI: $REDIRECT_URI" -ForegroundColor Gray
Write-Host "  OAuth Server: $OAuthServerUrl" -ForegroundColor Gray
Write-Host ""

if (-not $AuthCode) {
    Write-Host "STEP 1: Get Fresh Authorization Code" -ForegroundColor Magenta
    Write-Host "======================================" -ForegroundColor Magenta
    Write-Host "To get a fresh authorization code:" -ForegroundColor White
    Write-Host "1. Go to HighLevel Marketplace" -ForegroundColor White
    Write-Host "2. Install/reinstall your app" -ForegroundColor White
    Write-Host "3. Copy the 'code' parameter from the callback URL" -ForegroundColor White
    Write-Host "4. Run this script with the code:" -ForegroundColor White
    Write-Host "   .\oauth_comprehensive_test.ps1 -AuthCode 'your_code_here'" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Authorization URLs:" -ForegroundColor Yellow
    
    $locationAuthUrl = "https://marketplace.leadconnectorhq.com/oauth/chooselocation?response_type=code&redirect_uri=$([System.Web.HttpUtility]::UrlEncode($REDIRECT_URI))&client_id=$CLIENT_ID&scope=locations.readonly"
    $agencyAuthUrl = "https://marketplace.leadconnectorhq.com/oauth/authorize?response_type=code&redirect_uri=$([System.Web.HttpUtility]::UrlEncode($REDIRECT_URI))&client_id=$CLIENT_ID&scope=locations.readonly"
    
    Write-Host "Location Install: $locationAuthUrl" -ForegroundColor Gray
    Write-Host "Agency Install: $agencyAuthUrl" -ForegroundColor Gray
    exit 0
}

# Validate user type
if ($UserType -notin @("location", "company")) {
    Write-Host "ERROR: UserType must be 'location' or 'company'" -ForegroundColor Red
    exit 1
}

Write-Host "Testing with Authorization Code: $($AuthCode.Substring(0, [Math]::Min(10, $AuthCode.Length)))..." -ForegroundColor Gray
Write-Host "User Type: $UserType" -ForegroundColor Gray
Write-Host ""

# STEP 1: Golden Test (Direct HighLevel API)
if (-not $SkipGoldenTest) {
    Write-Host "STEP 2: Golden Test - Direct HighLevel API" -ForegroundColor Magenta
    Write-Host "=========================================" -ForegroundColor Magenta
    Write-Host "Testing if the authorization code works directly with HighLevel..." -ForegroundColor White
    
    $body = @{
        client_id = $CLIENT_ID
        client_secret = $CLIENT_SECRET
        grant_type = "authorization_code"
        code = $AuthCode
        redirect_uri = $REDIRECT_URI
        user_type = $UserType.ToLower()
    }
    
    $goldenTestSuccess = $false
    
    try {
        $response = Invoke-RestMethod -Uri $TOKEN_ENDPOINT -Method POST -Body $body -ContentType "application/x-www-form-urlencoded"
        
        Write-Host "SUCCESS: Golden test passed!" -ForegroundColor Green
        Write-Host "  Access Token: $($response.access_token.Substring(0,20))..." -ForegroundColor Gray
        Write-Host "  Token Type: $($response.token_type)" -ForegroundColor Gray
        Write-Host "  Expires In: $($response.expires_in) seconds" -ForegroundColor Gray
        if ($response.scope) {
            Write-Host "  Scopes: $($response.scope)" -ForegroundColor Gray
        }
        
        $goldenTestSuccess = $true
        
    } catch {
        $statusCode = $_.Exception.Response.StatusCode.value__
        Write-Host "FAILED: Golden test failed with HTTP $statusCode" -ForegroundColor Red
        
        if ($_.Exception.Response) {
            $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
            $responseBody = $reader.ReadToEnd()
            Write-Host "  Response: $responseBody" -ForegroundColor Red
            
            if ($responseBody -like "*invalid_grant*") {
                Write-Host ""
                Write-Host "DIAGNOSIS: Authorization code is invalid at HighLevel" -ForegroundColor Red
                Write-Host "Root causes:" -ForegroundColor Yellow
                Write-Host "  1. Code already used (codes are single-use only)" -ForegroundColor White
                Write-Host "  2. Code expired (codes are short-lived)" -ForegroundColor White
                Write-Host "  3. Redirect URI mismatch with HighLevel app settings" -ForegroundColor White
                Write-Host "  4. Wrong client_id/secret for the app that issued this code" -ForegroundColor White
                Write-Host "  5. Wrong user_type ($UserType) for this install type" -ForegroundColor White
                Write-Host ""
                Write-Host "SOLUTION: Get a fresh authorization code and verify HighLevel app configuration" -ForegroundColor Yellow
                exit 1
            }
        }
    }
    
    Write-Host ""
}

# STEP 2: OAuth Server Test
Write-Host "STEP 3: OAuth Server Test" -ForegroundColor Magenta
Write-Host "========================" -ForegroundColor Magenta
Write-Host "Testing your OAuth server with the same authorization code..." -ForegroundColor White

$serverTestUrl = "$OAuthServerUrl/oauth/callback?code=$AuthCode"
if ($UserType -eq "location") {
    $serverTestUrl += "&location_id=test_location"
} else {
    $serverTestUrl += "&company_id=test_company"
}

Write-Host "Server URL: $serverTestUrl" -ForegroundColor Gray

try {
    $serverResponse = Invoke-WebRequest -Uri $serverTestUrl -Method GET -UseBasicParsing
    
    Write-Host "SUCCESS: OAuth server responded with HTTP $($serverResponse.StatusCode)" -ForegroundColor Green
    Write-Host "Response: $($serverResponse.Content.Substring(0, [Math]::Min(200, $serverResponse.Content.Length)))..." -ForegroundColor Gray
    
} catch {
    $serverStatusCode = $_.Exception.Response.StatusCode.value__
    Write-Host "FAILED: OAuth server failed with HTTP $serverStatusCode" -ForegroundColor Red
    
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $serverResponseBody = $reader.ReadToEnd()
        Write-Host "Server Response: $serverResponseBody" -ForegroundColor Red
        
        if ($serverResponseBody -like "*invalid_grant*") {
            if ($goldenTestSuccess) {
                Write-Host ""
                Write-Host "DIAGNOSIS: Server implementation issue" -ForegroundColor Red
                Write-Host "The golden test succeeded but your server failed." -ForegroundColor Yellow
                Write-Host "This means your server is sending different parameters than the golden test." -ForegroundColor Yellow
                Write-Host ""
                Write-Host "Check server logs for TOKEN EXCHANGE ERROR to compare:" -ForegroundColor White
                Write-Host "  - sending.redirect_uri vs $REDIRECT_URI" -ForegroundColor White
                Write-Host "  - sending.user_type vs $($UserType.ToLower())" -ForegroundColor White
                Write-Host "  - Double token exchange attempts" -ForegroundColor White
            } else {
                Write-Host ""
                Write-Host "DIAGNOSIS: Both golden test and server failed" -ForegroundColor Red
                Write-Host "The authorization code is invalid. Get a fresh code." -ForegroundColor Yellow
            }
        } elseif ($serverResponseBody -like "*already used*") {
            Write-Host ""
            Write-Host "DIAGNOSIS: Code reuse detected" -ForegroundColor Yellow
            Write-Host "Your server's deduplication is working correctly." -ForegroundColor Green
            Write-Host "The code was already consumed by a previous request." -ForegroundColor White
        }
    }
}

Write-Host ""
Write-Host "SUMMARY AND NEXT STEPS" -ForegroundColor Cyan
Write-Host "=====================" -ForegroundColor Cyan

if ($goldenTestSuccess) {
    Write-Host "Golden Test: PASSED - Authorization code is valid" -ForegroundColor Green
} else {
    Write-Host "Golden Test: FAILED - Authorization code is invalid" -ForegroundColor Red
}

Write-Host ""
Write-Host "Recommended Actions:" -ForegroundColor Yellow
Write-Host "1. Check Railway logs: railway logs" -ForegroundColor White
Write-Host "2. Look for TOKEN EXCHANGE ERROR entries" -ForegroundColor White
Write-Host "3. Compare server parameters with golden test parameters" -ForegroundColor White
Write-Host "4. Verify HighLevel app redirect URI exactly matches: $REDIRECT_URI" -ForegroundColor White
Write-Host "5. If server fails but golden test passes, check for double exchange" -ForegroundColor White

Write-Host ""
Write-Host "Debug Commands:" -ForegroundColor Cyan
Write-Host "  railway logs --tail" -ForegroundColor Gray
Write-Host "  .\oauth_comprehensive_test.ps1 -AuthCode 'new_code' -UserType 'location'" -ForegroundColor Gray
Write-Host "  .\oauth_comprehensive_test.ps1 -AuthCode 'new_code' -UserType 'company'" -ForegroundColor Gray