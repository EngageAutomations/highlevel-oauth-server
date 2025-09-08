# HighLevel OAuth Integration - Deployment Validation Script
# Version: 2.1.0
# Description: Post-deployment validation and testing script

param(
    [Parameter(Mandatory=$false)]
    [string]$DeploymentInfoFile = "deployment_info.json",
    
    [Parameter(Mandatory=$false)]
    [string]$S2SSecret,
    
    [Parameter(Mandatory=$false)]
    [switch]$SkipSecurityTests,
    
    [Parameter(Mandatory=$false)]
    [switch]$Verbose
)

# Color output functions
function Write-Success { param($Message) Write-Host "✅ $Message" -ForegroundColor Green }
function Write-Warning { param($Message) Write-Host "⚠️  $Message" -ForegroundColor Yellow }
function Write-Error { param($Message) Write-Host "❌ $Message" -ForegroundColor Red }
function Write-Info { param($Message) Write-Host "ℹ️  $Message" -ForegroundColor Cyan }
function Write-Step { param($Message) Write-Host "🔍 $Message" -ForegroundColor Magenta }
function Write-Detail { param($Message) if ($Verbose) { Write-Host "   $Message" -ForegroundColor Gray } }

# Global variables
$script:DeploymentInfo = $null
$script:ValidationResults = @{}

function Load-DeploymentInfo {
    Write-Step "Loading deployment information..."
    
    if (-not (Test-Path $DeploymentInfoFile)) {
        Write-Error "Deployment info file not found: $DeploymentInfoFile"
        Write-Info "Please run the deployment script first or provide the correct path"
        return $false
    }
    
    try {
        $script:DeploymentInfo = Get-Content $DeploymentInfoFile | ConvertFrom-Json
        Write-Success "Deployment info loaded successfully"
        Write-Detail "OAuth URL: $($script:DeploymentInfo.oauthUrl)"
        Write-Detail "API URL: $($script:DeploymentInfo.apiUrl)"
        Write-Detail "Deployment Time: $($script:DeploymentInfo.timestamp)"
        return $true
    } catch {
        Write-Error "Failed to parse deployment info: $($_.Exception.Message)"
        return $false
    }
}

function Test-HealthEndpoints {
    Write-Step "Testing health endpoints..."
    
    # Test OAuth server health
    Write-Info "Testing OAuth server health..."
    try {
        $response = Invoke-RestMethod -Uri "$($script:DeploymentInfo.oauthUrl)/health" -Method Get -TimeoutSec 15
        if ($response.status -eq "ok") {
            Write-Success "OAuth server health check passed"
            $script:ValidationResults.OAuthHealth = $true
            Write-Detail "Response: $($response | ConvertTo-Json -Compress)"
        } else {
            Write-Error "OAuth server health check failed: unexpected response"
            $script:ValidationResults.OAuthHealth = $false
            Write-Detail "Response: $($response | ConvertTo-Json)"
        }
    } catch {
        Write-Error "OAuth server health check failed: $($_.Exception.Message)"
        $script:ValidationResults.OAuthHealth = $false
    }
    
    # Test API server health
    Write-Info "Testing API server health..."
    try {
        $response = Invoke-RestMethod -Uri "$($script:DeploymentInfo.apiUrl)/health" -Method Get -TimeoutSec 15
        if ($response.status -eq "ok") {
            Write-Success "API server health check passed"
            $script:ValidationResults.ApiHealth = $true
            Write-Detail "Response: $($response | ConvertTo-Json -Compress)"
        } else {
            Write-Error "API server health check failed: unexpected response"
            $script:ValidationResults.ApiHealth = $false
            Write-Detail "Response: $($response | ConvertTo-Json)"
        }
    } catch {
        Write-Error "API server health check failed: $($_.Exception.Message)"
        $script:ValidationResults.ApiHealth = $false
    }
}

function Test-MetricsEndpoints {
    Write-Step "Testing metrics endpoints..."
    
    # Test OAuth server metrics
    Write-Info "Testing OAuth server metrics..."
    try {
        $response = Invoke-RestMethod -Uri "$($script:DeploymentInfo.oauthUrl)/metrics" -Method Get -TimeoutSec 15
        if ($response) {
            Write-Success "OAuth server metrics endpoint accessible"
            $script:ValidationResults.OAuthMetrics = $true
            Write-Detail "Metrics data available"
        } else {
            Write-Warning "OAuth server metrics endpoint returned empty response"
            $script:ValidationResults.OAuthMetrics = $false
        }
    } catch {
        Write-Warning "OAuth server metrics endpoint failed: $($_.Exception.Message)"
        $script:ValidationResults.OAuthMetrics = $false
    }
    
    # Test API server metrics (if available)
    Write-Info "Testing API server metrics..."
    try {
        $response = Invoke-RestMethod -Uri "$($script:DeploymentInfo.apiUrl)/admin/metrics" -Method Get -TimeoutSec 15
        if ($response) {
            Write-Success "API server metrics endpoint accessible"
            $script:ValidationResults.ApiMetrics = $true
            Write-Detail "Metrics data available"
        } else {
            Write-Warning "API server metrics endpoint returned empty response"
            $script:ValidationResults.ApiMetrics = $false
        }
    } catch {
        Write-Warning "API server metrics endpoint failed (may require authentication): $($_.Exception.Message)"
        $script:ValidationResults.ApiMetrics = $false
    }
}

function Test-SecurityEndpoints {
    if ($SkipSecurityTests) {
        Write-Warning "Skipping security tests (--SkipSecurityTests flag)"
        return
    }
    
    Write-Step "Testing security endpoints..."
    
    # Test unauthorized access to admin endpoints
    Write-Info "Testing admin endpoint security..."
    try {
        Invoke-RestMethod -Uri "$($script:DeploymentInfo.oauthUrl)/admin/installations" -Method Get -TimeoutSec 10
        Write-Error "Security vulnerability: Admin endpoint accessible without authentication"
        $script:ValidationResults.AdminSecurity = $false
    } catch {
        $statusCode = $_.Exception.Response.StatusCode.value__
        if ($statusCode -eq 401 -or $statusCode -eq 403) {
            Write-Success "Admin endpoint properly protected (HTTP $statusCode)"
            $script:ValidationResults.AdminSecurity = $true
        } else {
            Write-Warning "Unexpected response from admin endpoint (HTTP $statusCode)"
            $script:ValidationResults.AdminSecurity = $false
        }
    }
    
    # Test unauthorized access to proxy endpoints
    Write-Info "Testing proxy endpoint security..."
    try {
        $testPayload = @{ test = "unauthorized" } | ConvertTo-Json
        Invoke-RestMethod -Uri "$($script:DeploymentInfo.oauthUrl)/proxy/hl" -Method Post -Body $testPayload -ContentType "application/json" -TimeoutSec 10
        Write-Error "Security vulnerability: Proxy endpoint accessible without authentication"
        $script:ValidationResults.ProxySecurity = $false
    } catch {
        $statusCode = $_.Exception.Response.StatusCode.value__
        if ($statusCode -eq 401 -or $statusCode -eq 403) {
            Write-Success "Proxy endpoint properly protected (HTTP $statusCode)"
            $script:ValidationResults.ProxySecurity = $true
        } else {
            Write-Warning "Unexpected response from proxy endpoint (HTTP $statusCode)"
            $script:ValidationResults.ProxySecurity = $false
        }
    }
}

function Test-AuthenticatedEndpoints {
    if (-not $S2SSecret) {
        Write-Warning "S2S secret not provided, skipping authenticated endpoint tests"
        Write-Info "Use -S2SSecret parameter to test authenticated endpoints"
        return
    }
    
    Write-Step "Testing authenticated endpoints..."
    
    # Create JWT token (simplified - in production use proper JWT library)
    $headers = @{
        "Authorization" = "Bearer $S2SSecret"
        "Content-Type" = "application/json"
    }
    
    # Test admin installations endpoint
    Write-Info "Testing admin installations endpoint..."
    try {
        $response = Invoke-RestMethod -Uri "$($script:DeploymentInfo.oauthUrl)/admin/installations" -Method Get -Headers $headers -TimeoutSec 15
        Write-Success "Admin installations endpoint accessible with authentication"
        $script:ValidationResults.AuthenticatedAccess = $true
        
        if ($response -is [array]) {
            Write-Detail "Found $($response.Count) installations"
        } else {
            Write-Detail "Installations response: $($response | ConvertTo-Json -Compress)"
        }
    } catch {
        $statusCode = $_.Exception.Response.StatusCode.value__
        if ($statusCode -eq 401 -or $statusCode -eq 403) {
            Write-Error "Authentication failed with provided S2S secret"
            $script:ValidationResults.AuthenticatedAccess = $false
        } else {
            Write-Warning "Unexpected response from authenticated endpoint (HTTP $statusCode): $($_.Exception.Message)"
            $script:ValidationResults.AuthenticatedAccess = $false
        }
    }
}

function Test-DatabaseConnectivity {
    Write-Step "Testing database connectivity..."
    
    # Test through health endpoint that includes DB check
    Write-Info "Testing database through health endpoint..."
    try {
        $response = Invoke-RestMethod -Uri "$($script:DeploymentInfo.oauthUrl)/health" -Method Get -TimeoutSec 15
        if ($response.database -eq "connected" -or $response.db -eq "ok" -or $response.status -eq "ok") {
            Write-Success "Database connectivity confirmed through health endpoint"
            $script:ValidationResults.DatabaseConnectivity = $true
        } else {
            Write-Warning "Database status unclear from health endpoint"
            $script:ValidationResults.DatabaseConnectivity = $null
        }
    } catch {
        Write-Warning "Could not verify database connectivity: $($_.Exception.Message)"
        $script:ValidationResults.DatabaseConnectivity = $false
    }
}

function Test-OAuthCallback {
    Write-Step "Testing OAuth callback endpoint..."
    
    # Test that callback endpoint exists and responds appropriately
    Write-Info "Testing OAuth callback endpoint availability..."
    try {
        # Test with GET (should return method not allowed or redirect)
        Invoke-RestMethod -Uri "$($script:DeploymentInfo.redirectUri)" -Method Get -TimeoutSec 10
        Write-Warning "OAuth callback responded to GET request (unexpected)"
        $script:ValidationResults.OAuthCallback = $false
    } catch {
        $statusCode = $_.Exception.Response.StatusCode.value__
        if ($statusCode -eq 405 -or $statusCode -eq 400 -or $statusCode -eq 302) {
            Write-Success "OAuth callback endpoint exists and responds appropriately (HTTP $statusCode)"
            $script:ValidationResults.OAuthCallback = $true
        } else {
            Write-Warning "Unexpected response from OAuth callback (HTTP $statusCode)"
            $script:ValidationResults.OAuthCallback = $false
        }
    }
}

function Test-CORS {
    Write-Step "Testing CORS configuration..."
    
    # Test CORS headers
    Write-Info "Testing CORS headers..."
    try {
        $headers = @{
            "Origin" = "https://app.gohighlevel.com"
        }
        
        $response = Invoke-WebRequest -Uri "$($script:DeploymentInfo.oauthUrl)/health" -Method Options -Headers $headers -TimeoutSec 10
        
        $corsHeaders = $response.Headers
        if ($corsHeaders["Access-Control-Allow-Origin"] -or $corsHeaders["access-control-allow-origin"]) {
            Write-Success "CORS headers present"
            $script:ValidationResults.CORS = $true
            Write-Detail "CORS Origin: $($corsHeaders['Access-Control-Allow-Origin'] -or $corsHeaders['access-control-allow-origin'])"
        } else {
            Write-Warning "CORS headers not found"
            $script:ValidationResults.CORS = $false
        }
    } catch {
        Write-Warning "CORS test failed: $($_.Exception.Message)"
        $script:ValidationResults.CORS = $false
    }
}

function Show-ValidationSummary {
    Write-Step "Validation Summary"
    
    Write-Host ""
    Write-Host "📊 Validation Results:" -ForegroundColor Cyan
    
    $totalTests = 0
    $passedTests = 0
    $failedTests = 0
    $skippedTests = 0
    
    foreach ($test in $script:ValidationResults.GetEnumerator()) {
        $totalTests++
        $testName = $test.Key
        $result = $test.Value
        
        if ($result -eq $true) {
            Write-Host "  ✅ $testName" -ForegroundColor Green
            $passedTests++
        } elseif ($result -eq $false) {
            Write-Host "  ❌ $testName" -ForegroundColor Red
            $failedTests++
        } else {
            Write-Host "  ⚠️  $testName (skipped/unclear)" -ForegroundColor Yellow
            $skippedTests++
        }
    }
    
    Write-Host ""
    Write-Host "📈 Test Statistics:" -ForegroundColor Cyan
    Write-Host "  Total Tests: $totalTests" -ForegroundColor White
    Write-Host "  Passed: $passedTests" -ForegroundColor Green
    Write-Host "  Failed: $failedTests" -ForegroundColor Red
    Write-Host "  Skipped: $skippedTests" -ForegroundColor Yellow
    
    $successRate = if ($totalTests -gt 0) { [math]::Round(($passedTests / $totalTests) * 100, 1) } else { 0 }
    Write-Host "  Success Rate: $successRate%" -ForegroundColor $(if ($successRate -ge 80) { "Green" } elseif ($successRate -ge 60) { "Yellow" } else { "Red" })
    
    Write-Host ""
    
    if ($failedTests -eq 0) {
        Write-Host "🎉 All critical tests passed! Deployment is ready for production." -ForegroundColor Green
    } elseif ($failedTests -le 2 -and $passedTests -ge 5) {
        Write-Host "⚠️  Most tests passed, but some issues need attention before production." -ForegroundColor Yellow
    } else {
        Write-Host "❌ Multiple test failures detected. Please resolve issues before proceeding." -ForegroundColor Red
    }
    
    # Save validation results
    $validationReport = @{
        timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss UTC"
        deploymentInfo = $script:DeploymentInfo
        results = $script:ValidationResults
        summary = @{
            totalTests = $totalTests
            passedTests = $passedTests
            failedTests = $failedTests
            skippedTests = $skippedTests
            successRate = $successRate
        }
    }
    
    $validationReport | ConvertTo-Json -Depth 3 | Out-File "validation_report.json" -Encoding UTF8
    Write-Success "Validation report saved to validation_report.json"
}

function Show-NextSteps {
    Write-Host ""
    Write-Host "🔄 Next Steps:" -ForegroundColor Cyan
    
    if ($script:ValidationResults.OAuthHealth -and $script:ValidationResults.ApiHealth) {
        Write-Host "  1. ✅ Update HighLevel app redirect URI to:" -ForegroundColor Green
        Write-Host "     $($script:DeploymentInfo.redirectUri)" -ForegroundColor White
        Write-Host "  2. 🧪 Test app installation in HighLevel marketplace" -ForegroundColor Yellow
        Write-Host "  3. 🔍 Verify tokens are stored in database after installation" -ForegroundColor Yellow
        Write-Host "  4. 📡 Test API endpoints with real HighLevel data" -ForegroundColor Yellow
        Write-Host "  5. 📋 Run weekly operations checklist" -ForegroundColor Yellow
        Write-Host "  6. 🔔 Set up monitoring and alerting" -ForegroundColor Yellow
    } else {
        Write-Host "  1. ❌ Fix health endpoint issues before proceeding" -ForegroundColor Red
        Write-Host "  2. 🔍 Check Railway deployment logs for errors" -ForegroundColor Yellow
        Write-Host "  3. ✅ Verify environment variables are set correctly" -ForegroundColor Yellow
        Write-Host "  4. 🔄 Re-run this validation script after fixes" -ForegroundColor Yellow
    }
    
    Write-Host ""
    Write-Host "📚 Documentation:" -ForegroundColor Cyan
    Write-Host "  • Go-Live Checklist: Go_Live_Checklist.md" -ForegroundColor White
    Write-Host "  • Weekly Operations: Weekly_Operations_Report_Template.md" -ForegroundColor White
    Write-Host "  • Day-2 Operations: Day2_Operations_Checklist.md" -ForegroundColor White
    Write-Host ""
}

# Main execution
function Main {
    Write-Host "🔍 HighLevel OAuth Integration - Deployment Validation" -ForegroundColor Magenta
    Write-Host "Version: 2.1.0" -ForegroundColor Gray
    Write-Host ""
    
    # Initialize validation results
    $script:ValidationResults = @{}
    
    # Step 1: Load deployment info
    if (-not (Load-DeploymentInfo)) {
        Write-Error "Cannot proceed without deployment information"
        exit 1
    }
    
    # Step 2: Test health endpoints
    Test-HealthEndpoints
    
    # Step 3: Test metrics endpoints
    Test-MetricsEndpoints
    
    # Step 4: Test security
    Test-SecurityEndpoints
    
    # Step 5: Test authenticated endpoints
    Test-AuthenticatedEndpoints
    
    # Step 6: Test database connectivity
    Test-DatabaseConnectivity
    
    # Step 7: Test OAuth callback
    Test-OAuthCallback
    
    # Step 8: Test CORS
    Test-CORS
    
    # Step 9: Show summary
    Show-ValidationSummary
    
    # Step 10: Show next steps
    Show-NextSteps
}

# Execute main function
if ($MyInvocation.InvocationName -ne '.') {
    Main
}

# Example usage:
# .\validate_deployment.ps1
# .\validate_deployment.ps1 -S2SSecret "your-s2s-secret" -Verbose
# .\validate_deployment.ps1 -DeploymentInfoFile "custom_deployment.json" -SkipSecurityTests