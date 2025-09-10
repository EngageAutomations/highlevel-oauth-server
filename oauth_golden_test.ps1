# OAuth Golden Test Script
# Tests direct HighLevel API calls to isolate invalid_grant issues

param(
    [Parameter(Mandatory=$true)]
    [string]$AuthCode,
    [Parameter(Mandatory=$false)]
    [string]$UserType = "location"
)

$CLIENT_ID = $env:HL_CLIENT_ID
$CLIENT_SECRET = $env:HL_CLIENT_SECRET
$REDIRECT_URI = "https://api.engageautomations.com/oauth/callback"
$TOKEN_ENDPOINT = "https://services.leadconnectorhq.com/oauth/token"

Write-Host "OAuth Golden Test - Direct HighLevel API Call" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan

if (-not $CLIENT_ID -or -not $CLIENT_SECRET) {
    Write-Host "ERROR: Missing environment variables" -ForegroundColor Red
    Write-Host "Set HL_CLIENT_ID and HL_CLIENT_SECRET" -ForegroundColor Red
    exit 1
}

Write-Host "Configuration:" -ForegroundColor Yellow
Write-Host "  Client ID: $CLIENT_ID" -ForegroundColor Gray
Write-Host "  Redirect URI: $REDIRECT_URI" -ForegroundColor Gray
Write-Host "  User Type: $UserType" -ForegroundColor Gray
Write-Host "  Auth Code: $($AuthCode.Substring(0, [Math]::Min(10, $AuthCode.Length)))..." -ForegroundColor Gray
Write-Host ""

# Prepare the request body
$body = @{
    client_id = $CLIENT_ID
    client_secret = $CLIENT_SECRET
    grant_type = "authorization_code"
    code = $AuthCode
    redirect_uri = $REDIRECT_URI
    user_type = $UserType.ToLower()
}

Write-Host "Making direct call to HighLevel token endpoint..." -ForegroundColor Yellow

try {
    $response = Invoke-RestMethod -Uri $TOKEN_ENDPOINT -Method POST -Body $body -ContentType "application/x-www-form-urlencoded"
    
    Write-Host "SUCCESS: Token exchange worked!" -ForegroundColor Green
    Write-Host "  Access Token: $($response.access_token.Substring(0,20))..." -ForegroundColor Gray
    Write-Host "  Token Type: $($response.token_type)" -ForegroundColor Gray
    Write-Host "  Expires In: $($response.expires_in) seconds" -ForegroundColor Gray
    if ($response.scope) {
        Write-Host "  Scopes: $($response.scope)" -ForegroundColor Gray
    }
    
    Write-Host ""
    Write-Host "CONCLUSION: The authorization code is VALID" -ForegroundColor Green
    Write-Host "If your OAuth server fails with the same code, the issue is in your server implementation." -ForegroundColor Yellow
    
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Write-Host "FAILED: HTTP $statusCode" -ForegroundColor Red
    
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $responseBody = $reader.ReadToEnd()
        Write-Host "  Response: $responseBody" -ForegroundColor Red
        
        if ($responseBody -like "*invalid_grant*") {
            Write-Host ""
            Write-Host "CONCLUSION: Authorization code is INVALID at HighLevel" -ForegroundColor Red
            Write-Host "Possible causes:" -ForegroundColor Yellow
            Write-Host "  1. Code already used (single-use only)" -ForegroundColor White
            Write-Host "  2. Code expired (short-lived)" -ForegroundColor White
            Write-Host "  3. Redirect URI mismatch with HighLevel app settings" -ForegroundColor White
            Write-Host "  4. Wrong client_id/secret for the app that issued this code" -ForegroundColor White
            Write-Host "  5. Wrong user_type for this install type" -ForegroundColor White
        }
    } else {
        Write-Host "  Error: $($_.Exception.Message)" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "Next Steps:" -ForegroundColor Cyan
Write-Host "1. If this test SUCCEEDS but your OAuth server FAILS:" -ForegroundColor White
Write-Host "   - Compare server logs to see what differs" -ForegroundColor White
Write-Host "   - Check for double token exchange attempts" -ForegroundColor White
Write-Host "   - Verify server sends exact same parameters" -ForegroundColor White
Write-Host "2. If this test FAILS:" -ForegroundColor White
Write-Host "   - Get a fresh authorization code from a new install" -ForegroundColor White
Write-Host "   - Verify HighLevel app redirect URI matches exactly" -ForegroundColor White
Write-Host "   - Check client_id/secret match the app that issued the code" -ForegroundColor White

Write-Host ""
Write-Host "Usage Examples:" -ForegroundColor Cyan
Write-Host "  .\oauth_golden_test.ps1 -AuthCode 'abc123' -UserType 'location'" -ForegroundColor Gray
Write-Host "  .\oauth_golden_test.ps1 -AuthCode 'xyz789' -UserType 'company'" -ForegroundColor Gray