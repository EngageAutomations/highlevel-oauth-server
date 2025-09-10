# OAuth Fixed Test Suite
# Tests all implemented fixes from the error fix document

# Color definitions
$Green = "Green"
$Red = "Red"
$Yellow = "Yellow"
$Cyan = "Cyan"
$Gray = "Gray"

function Write-Section {
    param([string]$Title)
    Write-Host "`n=== $Title ===" -ForegroundColor $Yellow
}

function Write-TestResult {
    param(
        [string]$TestName,
        [bool]$Success,
        [string]$Details = ""
    )
    
    $status = if ($Success) { "✅ PASS" } else { "❌ FAIL" }
    $color = if ($Success) { $Green } else { $Red }
    
    Write-Host "$status $TestName" -ForegroundColor $color
    if ($Details) {
        Write-Host "   $Details" -ForegroundColor $Gray
    }
}

function Test-OAuthStartEndpoint {
    Write-Section "Testing OAuth Start Endpoint"
    
    try {
        $response = Invoke-RestMethod -Uri "https://api.engageautomations.com/oauth/start" -Method GET
        
        if ($response.authorize_url) {
            Write-TestResult "OAuth Start Endpoint" $true "Generated authorize URL successfully"
            
            # Validate URL structure
            $url = [System.Uri]$response.authorize_url
            $query = [System.Web.HttpUtility]::ParseQueryString($url.Query)
            
            $hasClientId = $query["client_id"] -ne $null
            $hasRedirectUri = $query["redirect_uri"] -ne $null
            $hasState = $query["state"] -ne $null
            $hasResponseType = $query["response_type"] -eq "code"
            
            Write-TestResult "Client ID Present" $hasClientId
            Write-TestResult "Redirect URI Present" $hasRedirectUri
            Write-TestResult "State Parameter Present" $hasState
            Write-TestResult "Response Type Correct" $hasResponseType
            
            return @{ Success = $true; AuthorizeUrl = $response.authorize_url }
        } else {
            Write-TestResult "OAuth Start Endpoint" $false "No authorize_url in response"
            return @{ Success = $false }
        }
    } catch {
        Write-TestResult "OAuth Start Endpoint" $false $_.Exception.Message
        return @{ Success = $false }
    }
}

function Test-HealthEndpoints {
    Write-Section "Testing Health Endpoints"
    
    $endpoints = @(
        @{ Name = "Health Check"; Url = "https://api.engageautomations.com/health" },
        @{ Name = "Metrics"; Url = "https://api.engageautomations.com/metrics" }
    )
    
    foreach ($endpoint in $endpoints) {
        try {
            $response = Invoke-RestMethod -Uri $endpoint.Url -Method GET
            Write-TestResult $endpoint.Name $true "Endpoint responding"
        } catch {
            Write-TestResult $endpoint.Name $false $_.Exception.Message
        }
    }
}

function Test-CodeDeduplication {
    Write-Section "Testing Code Deduplication"
    
    Write-Host "⚠️  Manual Test Required" -ForegroundColor $Yellow
    Write-Host "To test code deduplication:" -ForegroundColor $Gray
    Write-Host "1. Complete OAuth flow once successfully" -ForegroundColor $Gray
    Write-Host "2. Try to reuse the same authorization code" -ForegroundColor $Gray
    Write-Host "3. Should receive 'Authorization code already used' error" -ForegroundColor $Gray
}

function Test-StateVerification {
    Write-Section "Testing State Verification"
    
    Write-Host "⚠️  Manual Test Required" -ForegroundColor $Yellow
    Write-Host "To test state verification:" -ForegroundColor $Gray
    Write-Host "1. Use the authorize URL from /oauth/start" -ForegroundColor $Gray
    Write-Host "2. Manually modify the 'state' parameter in the callback URL" -ForegroundColor $Gray
    Write-Host "3. Should receive 'Invalid or expired state' error" -ForegroundColor $Gray
}

function Show-ManualTestInstructions {
    Write-Section "Manual Testing Instructions"
    
    $startResult = Test-OAuthStartEndpoint
    
    if ($startResult.Success) {
        Write-Host "🔗 Use this URL to test the complete OAuth flow:" -ForegroundColor $Green
        Write-Host $startResult.AuthorizeUrl -ForegroundColor $Cyan
        
        Write-Host "`n📋 Expected Behavior:" -ForegroundColor $Yellow
        Write-Host "✅ Should redirect to HighLevel with proper parameters" -ForegroundColor $Gray
        Write-Host "✅ After authorization, should callback with code and state" -ForegroundColor $Gray
        Write-Host "✅ Should verify state matches what was generated" -ForegroundColor $Gray
        Write-Host "✅ Should use lowercase user_type (location/company)" -ForegroundColor $Gray
        Write-Host "✅ Should prevent code reuse on second attempt" -ForegroundColor $Gray
        
        Write-Host "`n🔍 Check Railway logs for:" -ForegroundColor $Yellow
        Write-Host "- 'HANDLER: V2 main entered' with redacted code" -ForegroundColor $Gray
        Write-Host "- 'TOKEN EXCHANGE ATTEMPT' with lowercase user_type" -ForegroundColor $Gray
        Write-Host "- No 'TOKEN EXCHANGE ERROR' if successful" -ForegroundColor $Gray
        Write-Host "- 'CODE REUSE DETECTED' on second attempt" -ForegroundColor $Gray
    }
}

function Test-ErrorFixImplementation {
    Write-Section "Verifying Error Fix Implementation"
    
    # Check if the fixes are properly implemented by testing endpoints
    $fixes = @(
        @{ Name = "OAuth Start Endpoint"; Test = { Test-OAuthStartEndpoint } },
        @{ Name = "Health Endpoints"; Test = { Test-HealthEndpoints } }
    )
    
    foreach ($fix in $fixes) {
        try {
            & $fix.Test
        } catch {
            Write-TestResult $fix.Name $false $_.Exception.Message
        }
    }
}

# Main execution
Write-Host "🚀 OAuth Fixed Test Suite" -ForegroundColor $Green
Write-Host "Testing all implemented fixes from error document" -ForegroundColor $Gray

# Run automated tests
Test-ErrorFixImplementation
Test-CodeDeduplication
Test-StateVerification

# Show manual test instructions
Show-ManualTestInstructions

Write-Host "`n✨ Test Summary:" -ForegroundColor $Green
Write-Host "- All automated tests completed" -ForegroundColor $Gray
Write-Host "- Manual OAuth flow test required for full verification" -ForegroundColor $Gray
Write-Host "- Use the generated authorize URL above" -ForegroundColor $Gray
Write-Host "- Monitor Railway logs during testing" -ForegroundColor $Gray

Write-Host "`n📊 Next Steps:" -ForegroundColor $Yellow
Write-Host "1. Click the authorize URL above" -ForegroundColor $Gray
Write-Host "2. Complete the HighLevel OAuth flow" -ForegroundColor $Gray
Write-Host "3. Verify successful token exchange" -ForegroundColor $Gray
Write-Host "4. Test code reuse prevention" -ForegroundColor $Gray
Write-Host "5. Check Railway logs for proper error handling" -ForegroundColor $Gray