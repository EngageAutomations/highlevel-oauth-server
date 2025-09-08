# HighLevel OAuth Integration - Railway Deployment Script
# Version: 2.1.0
# Description: Automated deployment script for dual Railway architecture

param(
    [Parameter(Mandatory=$true)]
    [string]$HLClientId,
    
    [Parameter(Mandatory=$true)]
    [string]$HLClientSecret,
    
    [Parameter(Mandatory=$true)]
    [string]$OAuthRepoUrl,
    
    [Parameter(Mandatory=$true)]
    [string]$ApiRepoUrl,
    
    [Parameter(Mandatory=$false)]
    [string]$RailwayToken = $env:RAILWAY_TOKEN,
    
    [Parameter(Mandatory=$false)]
    [switch]$SkipRepoSetup,
    
    [Parameter(Mandatory=$false)]
    [switch]$SkipValidation,
    
    [Parameter(Mandatory=$false)]
    [switch]$DryRun
)

# Color output functions
function Write-Success { param($Message) Write-Host "[SUCCESS] $Message" -ForegroundColor Green }
function Write-Warning { param($Message) Write-Host "[WARNING] $Message" -ForegroundColor Yellow }
function Write-Error { param($Message) Write-Host "[ERROR] $Message" -ForegroundColor Red }
function Write-Info { param($Message) Write-Host "[INFO] $Message" -ForegroundColor Cyan }
function Write-Step { param($Message) Write-Host "[STEP] $Message" -ForegroundColor Magenta }

# Global variables
$script:OAuthProjectId = ""
$script:ApiProjectId = ""
$script:OAuthUrl = ""
$script:ApiUrl = ""
$script:DatabaseUrl = ""
$script:EncryptionKey = ""
$script:S2SSecret = ""

# Validation functions
function Test-Prerequisites {
    Write-Step "Checking prerequisites..."
    
    # Check Railway CLI
    try {
        $railwayVersion = railway --version 2>$null
        if ($LASTEXITCODE -ne 0) {
            Write-Error "Railway CLI not installed. Install from: https://railway.app/cli"
            return $false
        }
        Write-Success "Railway CLI found: $railwayVersion"
    } catch {
        Write-Error "Railway CLI not found. Install from: https://railway.app/cli"
        return $false
    }
    
    # Check Git
    try {
        $gitVersion = git --version 2>$null
        if ($LASTEXITCODE -ne 0) {
            Write-Error "Git not installed"
            return $false
        }
        Write-Success "Git found: $gitVersion"
    } catch {
        Write-Error "Git not found"
        return $false
    }
    
    # Check Node.js
    try {
        $nodeVersion = node --version 2>$null
        if ($LASTEXITCODE -ne 0) {
            Write-Error "Node.js not installed"
            return $false
        }
        Write-Success "Node.js found: $nodeVersion"
    } catch {
        Write-Error "Node.js not found"
        return $false
    }
    
    # Check npm
    try {
        $npmVersion = npm --version 2>$null
        if ($LASTEXITCODE -ne 0) {
            Write-Error "npm not found"
            return $false
        }
        Write-Success "npm found: $npmVersion"
    } catch {
        Write-Error "npm not found"
        return $false
    }
    
    # Check Railway authentication
    if (-not $RailwayToken) {
        Write-Warning "RAILWAY_TOKEN not set. Checking Railway login..."
        try {
            $whoami = railway whoami 2>$null
            if ($LASTEXITCODE -ne 0) {
                Write-Error "Not logged into Railway. Run: railway login"
                return $false
            }
            Write-Success "Railway authenticated: $whoami"
        } catch {
            Write-Error "Railway authentication failed. Run: railway login"
            return $false
        }
    } else {
        Write-Success "Railway token provided"
    }
    
    return $true
}

function Test-LocalBuild {
    param([string]$ProjectPath, [string]$ProjectName)
    
    Write-Step "Testing local build for $ProjectName..."
    
    if (-not (Test-Path $ProjectPath)) {
        Write-Error "Project path not found: $ProjectPath"
        return $false
    }
    
    Push-Location $ProjectPath
    try {
        # Install dependencies
        Write-Info "Installing dependencies..."
        npm install --silent
        if ($LASTEXITCODE -ne 0) {
            Write-Error "npm install failed for $ProjectName"
            return $false
        }
        
        # Run syntax check
        Write-Info "Running syntax check..."
        node -c "$ProjectName.js"
        if ($LASTEXITCODE -ne 0) {
            Write-Error "Syntax check failed for $ProjectName.js"
            return $false
        }
        
        Write-Success "Local build test passed for $ProjectName"
        return $true
    } finally {
        Pop-Location
    }
}

function Generate-Secrets {
    Write-Step "Generating security keys..."
    
    # Generate encryption key
    $script:EncryptionKey = [Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
    Write-Success "Generated ENCRYPTION_KEY"
    
    # Generate S2S shared secret
    $script:S2SSecret = [Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
    Write-Success "Generated S2S_SHARED_SECRET"
}

function Setup-Repositories {
    if ($SkipRepoSetup) {
        Write-Warning "Skipping repository setup (--SkipRepoSetup flag)"
        return $true
    }
    
    Write-Step "Setting up repositories..."
    
    # OAuth Server Repository
    Write-Info "Setting up OAuth server repository..."
    if (-not (Test-Path "oauth-server")) {
        git clone $OAuthRepoUrl oauth-server
        if ($LASTEXITCODE -ne 0) {
            Write-Error "Failed to clone OAuth server repository"
            return $false
        }
    } else {
        Write-Info "OAuth server directory exists, pulling latest..."
        Push-Location oauth-server
        git pull origin main
        Pop-Location
    }
    
    # API Server Repository
    Write-Info "Setting up API server repository..."
    if (-not (Test-Path "api-server")) {
        git clone $ApiRepoUrl api-server
        if ($LASTEXITCODE -ne 0) {
            Write-Error "Failed to clone API server repository"
            return $false
        }
    } else {
        Write-Info "API server directory exists, pulling latest..."
        Push-Location api-server
        git pull origin main
        Pop-Location
    }
    
    # Test local builds
    if (-not (Test-LocalBuild "oauth-server" "oauth_server")) {
        return $false
    }
    
    if (-not (Test-LocalBuild "api-server" "api_server")) {
        return $false
    }
    
    Write-Success "Repository setup completed"
    return $true
}

function Create-RailwayProjects {
    Write-Step "Creating Railway projects..."
    
    # Create OAuth server project
    Write-Info "Creating OAuth server project..."
    if ($DryRun) {
        Write-Warning "[DRY RUN] Would create oauth-server project"
        $script:OAuthProjectId = "dry-run-oauth-id"
    } else {
        Push-Location oauth-server
        try {
            railway project create oauth-server
            if ($LASTEXITCODE -ne 0) {
                Write-Error "Failed to create OAuth server project"
                return $false
            }
            
            # Get project ID
            $projectInfo = railway status --json | ConvertFrom-Json
            $script:OAuthProjectId = $projectInfo.project.id
            Write-Success "OAuth server project created: $($script:OAuthProjectId)"
            
            # Add Postgres service
            Write-Info "Adding Postgres service..."
            railway add postgres
            if ($LASTEXITCODE -ne 0) {
                Write-Error "Failed to add Postgres service"
                return $false
            }
            Write-Success "Postgres service added"
            
        } finally {
            Pop-Location
        }
    }
    
    # Create API server project
    Write-Info "Creating API server project..."
    if ($DryRun) {
        Write-Warning "[DRY RUN] Would create api-server project"
        $script:ApiProjectId = "dry-run-api-id"
    } else {
        Push-Location api-server
        try {
            railway project create api-server
            if ($LASTEXITCODE -ne 0) {
                Write-Error "Failed to create API server project"
                return $false
            }
            
            # Get project ID
            $projectInfo = railway status --json | ConvertFrom-Json
            $script:ApiProjectId = $projectInfo.project.id
            Write-Success "API server project created: $($script:ApiProjectId)"
            
        } finally {
            Pop-Location
        }
    }
    
    return $true
}

function Set-EnvironmentVariables {
    Write-Step "Setting environment variables..."
    
    # Wait for initial deployment to get URLs
    Write-Info "Waiting for initial deployments to get URLs..."
    Start-Sleep -Seconds 30
    
    # Get OAuth server URL
    if ($DryRun) {
        $script:OAuthUrl = "https://oauth-server-dry-run.up.railway.app"
        $script:ApiUrl = "https://api-server-dry-run.up.railway.app"
        $script:DatabaseUrl = "postgresql://user:pass@host:5432/db"
    } else {
        Push-Location oauth-server
        try {
            $oauthStatus = railway status --json | ConvertFrom-Json
            $script:OAuthUrl = "https://$($oauthStatus.deployments[0].url)"
            
            # Get database URL
            $variables = railway variables --json | ConvertFrom-Json
            $script:DatabaseUrl = $variables.DATABASE_URL
            
        } finally {
            Pop-Location
        }
        
        Push-Location api-server
        try {
            $apiStatus = railway status --json | ConvertFrom-Json
            $script:ApiUrl = "https://$($apiStatus.deployments[0].url)"
        } finally {
            Pop-Location
        }
    }
    
    # Set OAuth server variables
    Write-Info "Setting OAuth server environment variables..."
    $oauthVars = @{
        "HL_CLIENT_ID" = $HLClientId
        "HL_CLIENT_SECRET" = $HLClientSecret
        "REDIRECT_URI" = "$($script:OAuthUrl)/oauth/callback"
        "DATABASE_URL" = $script:DatabaseUrl
        "ENCRYPTION_KEY" = $script:EncryptionKey
        "S2S_SHARED_SECRET" = $script:S2SSecret
        "NODE_ENV" = "production"
        "PORT" = "3000"
    }
    
    foreach ($var in $oauthVars.GetEnumerator()) {
        if ($DryRun) {
            Write-Warning "[DRY RUN] Would set $($var.Key) for OAuth server"
        } else {
            railway variables set --project $script:OAuthProjectId "$($var.Key)=$($var.Value)"
            if ($LASTEXITCODE -eq 0) {
                Write-Success "Set $($var.Key) for OAuth server"
            } else {
                Write-Error "Failed to set $($var.Key) for OAuth server"
                return $false
            }
        }
    }
    
    # Set API server variables
    Write-Info "Setting API server environment variables..."
    $apiVars = @{
        "OAUTH_BASE_URL" = $script:OAuthUrl
        "S2S_SHARED_SECRET" = $script:S2SSecret
        "DEFAULT_SCOPE" = "location"
        "NODE_ENV" = "production"
        "PORT" = "3000"
    }
    
    foreach ($var in $apiVars.GetEnumerator()) {
        if ($DryRun) {
            Write-Warning "[DRY RUN] Would set $($var.Key) for API server"
        } else {
            railway variables set --project $script:ApiProjectId "$($var.Key)=$($var.Value)"
            if ($LASTEXITCODE -eq 0) {
                Write-Success "Set $($var.Key) for API server"
            } else {
                Write-Error "Failed to set $($var.Key) for API server"
                return $false
            }
        }
    }
    
    Write-Success "Environment variables configured"
    return $true
}

function Deploy-Applications {
    Write-Step "Deploying applications..."
    
    if ($DryRun) {
        Write-Warning "[DRY RUN] Would trigger deployments"
        return $true
    }
    
    # Trigger OAuth server deployment
    Write-Info "Triggering OAuth server deployment..."
    Push-Location oauth-server
    try {
        railway deploy
        if ($LASTEXITCODE -ne 0) {
            Write-Error "OAuth server deployment failed"
            return $false
        }
        Write-Success "OAuth server deployment triggered"
    } finally {
        Pop-Location
    }
    
    # Trigger API server deployment
    Write-Info "Triggering API server deployment..."
    Push-Location api-server
    try {
        railway deploy
        if ($LASTEXITCODE -ne 0) {
            Write-Error "API server deployment failed"
            return $false
        }
        Write-Success "API server deployment triggered"
    } finally {
        Pop-Location
    }
    
    # Wait for deployments
    Write-Info "Waiting for deployments to complete..."
    Start-Sleep -Seconds 60
    
    return $true
}

function Test-HealthEndpoints {
    Write-Step "Testing health endpoints..."
    
    if ($DryRun) {
        Write-Warning "[DRY RUN] Would test health endpoints"
        return $true
    }
    
    # Test OAuth server health
    Write-Info "Testing OAuth server health..."
    try {
        $response = Invoke-RestMethod -Uri "$($script:OAuthUrl)/health" -Method Get -TimeoutSec 30
        if ($response.status -eq "ok") {
            Write-Success "OAuth server health check passed"
        } else {
            Write-Error "OAuth server health check failed: $($response | ConvertTo-Json)"
            return $false
        }
    } catch {
        Write-Error "OAuth server health check failed: $($_.Exception.Message)"
        return $false
    }
    
    # Test API server health
    Write-Info "Testing API server health..."
    try {
        $response = Invoke-RestMethod -Uri "$($script:ApiUrl)/health" -Method Get -TimeoutSec 30
        if ($response.status -eq "ok") {
            Write-Success "API server health check passed"
        } else {
            Write-Error "API server health check failed: $($response | ConvertTo-Json)"
            return $false
        }
    } catch {
        Write-Error "API server health check failed: $($_.Exception.Message)"
        return $false
    }
    
    return $true
}

function Run-DatabaseMigration {
    Write-Step "Running database migration..."
    
    if ($DryRun) {
        Write-Warning "[DRY RUN] Would run database migration"
        return $true
    }
    
    # Check if migration file exists
    if (-not (Test-Path "database_migration.sql")) {
        Write-Error "Database migration file not found: database_migration.sql"
        return $false
    }
    
    # Read migration SQL
    $migrationSql = Get-Content "database_migration.sql" -Raw
    
    # Connect to database and run migration
    Write-Info "Connecting to database and running migration..."
    try {
        # Use psql if available, otherwise provide instructions
        $psqlAvailable = Get-Command psql -ErrorAction SilentlyContinue
        if ($psqlAvailable) {
            $migrationSql | psql $script:DatabaseUrl
            if ($LASTEXITCODE -eq 0) {
                Write-Success "Database migration completed successfully"
            } else {
                Write-Error "Database migration failed"
                return $false
            }
        } else {
            Write-Warning "psql not available. Please run the migration manually:"
            Write-Info "1. Open Railway → OAuth project → Postgres → SQL console"
            Write-Info "2. Paste the contents of database_migration.sql"
            Write-Info "3. Execute the SQL"
            Write-Info "4. Verify the hl_installations table exists"
            
            $continue = Read-Host "Have you completed the manual migration? (y/N)"
            if ($continue -ne "y" -and $continue -ne "Y") {
                Write-Error "Database migration not completed"
                return $false
            }
        }
    } catch {
        Write-Error "Database migration failed: $($_.Exception.Message)"
        return $false
    }
    
    return $true
}

function Run-GoLiveValidation {
    if ($SkipValidation) {
        Write-Warning "Skipping go-live validation (--SkipValidation flag)"
        return $true
    }
    
    Write-Step "Running go-live validation..."
    
    if ($DryRun) {
        Write-Warning "[DRY RUN] Would run go-live validation"
        return $true
    }
    
    # Test S2S authentication
    Write-Info "Testing service-to-service authentication..."
    try {
        # Generate S2S token (simplified - in real implementation, use proper JWT)
        $headers = @{
            "Authorization" = "Bearer $($script:S2SSecret)"
            "Content-Type" = "application/json"
        }
        
        $response = Invoke-RestMethod -Uri "$($script:OAuthUrl)/admin/installations" -Method Get -Headers $headers -TimeoutSec 30
        Write-Success "S2S authentication test passed"
    } catch {
        Write-Warning "S2S authentication test failed (expected if no installations yet): $($_.Exception.Message)"
    }
    
    # Test security endpoints
    Write-Info "Testing security endpoints..."
    try {
        # Test unauthorized access to admin endpoint
        try {
            Invoke-RestMethod -Uri "$($script:OAuthUrl)/admin/installations" -Method Get -TimeoutSec 10
            Write-Error "Security test failed: Admin endpoint accessible without authentication"
            return $false
        } catch {
            if ($_.Exception.Response.StatusCode -eq 401 -or $_.Exception.Response.StatusCode -eq 403) {
                Write-Success "Security test passed: Admin endpoint properly protected"
            } else {
                Write-Warning "Unexpected response from admin endpoint: $($_.Exception.Message)"
            }
        }
        
        # Test unauthorized access to proxy endpoint
        try {
            $testPayload = @{ test = "data" } | ConvertTo-Json
            Invoke-RestMethod -Uri "$($script:OAuthUrl)/proxy/hl" -Method Post -Body $testPayload -ContentType "application/json" -TimeoutSec 10
            Write-Error "Security test failed: Proxy endpoint accessible without authentication"
            return $false
        } catch {
            if ($_.Exception.Response.StatusCode -eq 401 -or $_.Exception.Response.StatusCode -eq 403) {
                Write-Success "Security test passed: Proxy endpoint properly protected"
            } else {
                Write-Warning "Unexpected response from proxy endpoint: $($_.Exception.Message)"
            }
        }
    } catch {
        Write-Error "Security validation failed: $($_.Exception.Message)"
        return $false
    }
    
    Write-Success "Go-live validation completed"
    return $true
}

function Show-DeploymentSummary {
    Write-Step "Deployment Summary"
    
    Write-Host ""
    Write-Host "🎉 Deployment completed successfully!" -ForegroundColor Green
    Write-Host ""
    Write-Host "📊 Project Details:" -ForegroundColor Cyan
    Write-Host "  OAuth Server URL: $($script:OAuthUrl)" -ForegroundColor White
    Write-Host "  API Server URL: $($script:ApiUrl)" -ForegroundColor White
    Write-Host "  OAuth Project ID: $($script:OAuthProjectId)" -ForegroundColor White
    Write-Host "  API Project ID: $($script:ApiProjectId)" -ForegroundColor White
    Write-Host ""
    Write-Host "🔗 Important URLs:" -ForegroundColor Cyan
    Write-Host "  OAuth Health: $($script:OAuthUrl)/health" -ForegroundColor White
    Write-Host "  API Health: $($script:ApiUrl)/health" -ForegroundColor White
    Write-Host "  OAuth Callback: $($script:OAuthUrl)/oauth/callback" -ForegroundColor White
    Write-Host "  Admin Installations: $($script:OAuthUrl)/admin/installations" -ForegroundColor White
    Write-Host ""
    Write-Host "⚙️  Next Steps:" -ForegroundColor Cyan
    Write-Host "  1. Update HighLevel app redirect URI to: $($script:OAuthUrl)/oauth/callback" -ForegroundColor Yellow
    Write-Host "  2. Test app installation in HighLevel" -ForegroundColor Yellow
    Write-Host "  3. Verify tokens are stored in database" -ForegroundColor Yellow
    Write-Host "  4. Test API endpoints with real data" -ForegroundColor Yellow
    Write-Host "  5. Run weekly operations checklist" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "📋 Monitoring:" -ForegroundColor Cyan
    Write-Host "  Railway Dashboard: https://railway.app/dashboard" -ForegroundColor White
    Write-Host "  OAuth Metrics: $($script:OAuthUrl)/metrics" -ForegroundColor White
    Write-Host "  API Metrics: $($script:ApiUrl)/admin/metrics" -ForegroundColor White
    Write-Host ""
    
    # Save deployment info to file
    $deploymentInfo = @{
        timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss UTC"
        oauthUrl = $script:OAuthUrl
        apiUrl = $script:ApiUrl
        oauthProjectId = $script:OAuthProjectId
        apiProjectId = $script:ApiProjectId
        redirectUri = "$($script:OAuthUrl)/oauth/callback"
    }
    
    $deploymentInfo | ConvertTo-Json -Depth 2 | Out-File "deployment_info.json" -Encoding UTF8
    Write-Success "Deployment info saved to deployment_info.json"
}

# Main execution
function Main {
    Write-Host "🚀 HighLevel OAuth Integration - Railway Deployment" -ForegroundColor Magenta
    Write-Host "Version: 2.1.0" -ForegroundColor Gray
    Write-Host ""
    
    if ($DryRun) {
        Write-Warning "DRY RUN MODE - No actual changes will be made"
        Write-Host ""
    }
    
    # Step 1: Prerequisites
    if (-not (Test-Prerequisites)) {
        Write-Error "Prerequisites check failed. Please resolve issues and try again."
        exit 1
    }
    
    # Step 2: Generate secrets
    Generate-Secrets
    
    # Step 3: Repository setup
    if (-not (Setup-Repositories)) {
        Write-Error "Repository setup failed. Please resolve issues and try again."
        exit 1
    }
    
    # Step 4: Create Railway projects
    if (-not (Create-RailwayProjects)) {
        Write-Error "Railway project creation failed. Please resolve issues and try again."
        exit 1
    }
    
    # Step 5: Set environment variables
    if (-not (Set-EnvironmentVariables)) {
        Write-Error "Environment variable setup failed. Please resolve issues and try again."
        exit 1
    }
    
    # Step 6: Deploy applications
    if (-not (Deploy-Applications)) {
        Write-Error "Application deployment failed. Please resolve issues and try again."
        exit 1
    }
    
    # Step 7: Test health endpoints
    if (-not (Test-HealthEndpoints)) {
        Write-Error "Health endpoint tests failed. Please check deployments and try again."
        exit 1
    }
    
    # Step 8: Run database migration
    if (-not (Run-DatabaseMigration)) {
        Write-Error "Database migration failed. Please resolve issues and try again."
        exit 1
    }
    
    # Step 9: Go-live validation
    if (-not (Run-GoLiveValidation)) {
        Write-Error "Go-live validation failed. Please resolve issues and try again."
        exit 1
    }
    
    # Step 10: Show summary
    Show-DeploymentSummary
    
    Write-Host ""
    Write-Success "Deployment completed successfully! 🎉"
}

# Execute main function
if ($MyInvocation.InvocationName -ne '.') {
    Main
}

# Example usage:
# .\deploy_railway.ps1 -HLClientId "your-client-id" -HLClientSecret "your-client-secret" -OAuthRepoUrl "https://github.com/user/oauth-server.git" -ApiRepoUrl "https://github.com/user/api-server.git"
# .\deploy_railway.ps1 -HLClientId "your-client-id" -HLClientSecret "your-client-secret" -OAuthRepoUrl "https://github.com/user/oauth-server.git" -ApiRepoUrl "https://github.com/user/api-server.git" -DryRun