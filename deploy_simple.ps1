# Simple HighLevel OAuth Deployment Script
# Using existing credentials from environment variables.txt

param(
    [string]$HLClientId = "68474924a586bce22a6e64f7-mf8icnvr",
    [string]$HLClientSecret = "54e5b66e-88a6-4f71-a8d1-b1c6e0270c88",
    [string]$RailwayToken = "42d84861-5a8e-4802-861e-d0afe86a66db"
)

Write-Host "[STEP] Starting HighLevel OAuth Integration Deployment" -ForegroundColor Magenta
Write-Host "[INFO] Using Client ID: $($HLClientId.Substring(0,8))..." -ForegroundColor Cyan

# Check prerequisites
Write-Host "[STEP] Checking prerequisites..." -ForegroundColor Magenta

try {
    $railwayVersion = railway --version 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[SUCCESS] Railway CLI found: $railwayVersion" -ForegroundColor Green
    } else {
        Write-Host "[ERROR] Railway CLI not found. Install from: https://railway.app/cli" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "[ERROR] Railway CLI not installed" -ForegroundColor Red
    exit 1
}

# Set Railway token
if ($RailwayToken) {
    $env:RAILWAY_TOKEN = $RailwayToken
    Write-Host "[SUCCESS] Railway token configured" -ForegroundColor Green
} else {
    Write-Host "[WARNING] No Railway token provided. Please login manually: railway login" -ForegroundColor Yellow
}

# Generate secure keys
$EncryptionKey = [System.Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes((New-Guid).ToString() + (New-Guid).ToString()))
$S2SSecret = [System.Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes((New-Guid).ToString()))

Write-Host "[SUCCESS] Generated encryption keys" -ForegroundColor Green

# Create OAuth server project
Write-Host "[STEP] Creating OAuth server project..." -ForegroundColor Magenta

try {
    # Create new Railway project for OAuth server
    railway login --browserless 2>$null
    
    # Note: In a real deployment, you would:
    # 1. Create GitHub repositories
    # 2. Push code to repositories
    # 3. Create Railway projects
    # 4. Connect repositories to Railway
    # 5. Set environment variables
    # 6. Deploy applications
    
    Write-Host "[INFO] OAuth Server Setup Required:" -ForegroundColor Cyan
    Write-Host "  1. Create GitHub repository: oauth-server" -ForegroundColor White
    Write-Host "  2. Push oauth_server.js and dependencies" -ForegroundColor White
    Write-Host "  3. Create Railway project and connect repo" -ForegroundColor White
    Write-Host "  4. Add PostgreSQL database" -ForegroundColor White
    
    Write-Host "[INFO] API Server Setup Required:" -ForegroundColor Cyan
    Write-Host "  1. Create GitHub repository: api-server" -ForegroundColor White
    Write-Host "  2. Push api_server.js and dependencies" -ForegroundColor White
    Write-Host "  3. Create Railway project and connect repo" -ForegroundColor White
    
    Write-Host "[INFO] Environment Variables to Set:" -ForegroundColor Cyan
    Write-Host "  OAuth Server:" -ForegroundColor White
    Write-Host "    HL_CLIENT_ID=$HLClientId" -ForegroundColor Gray
    Write-Host "    HL_CLIENT_SECRET=$HLClientSecret" -ForegroundColor Gray
    Write-Host "    ENCRYPTION_KEY=$EncryptionKey" -ForegroundColor Gray
    Write-Host "    S2S_SHARED_SECRET=$S2SSecret" -ForegroundColor Gray
    Write-Host "    REDIRECT_URI=https://api.engageautomations.com/oauth/callback" -ForegroundColor Gray
    
    Write-Host "  API Server:" -ForegroundColor White
    Write-Host "    OAUTH_BASE_URL=https://api.engageautomations.com" -ForegroundColor Gray
    Write-Host "    S2S_SHARED_SECRET=$S2SSecret" -ForegroundColor Gray
    Write-Host "    DEFAULT_SCOPE=location" -ForegroundColor Gray
    
} catch {
    Write-Host "[ERROR] Deployment setup failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Save deployment configuration
$deploymentConfig = @{
    timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    client_id = $HLClientId
    encryption_key = $EncryptionKey
    s2s_secret = $S2SSecret
    status = "configuration_ready"
    next_steps = @(
        "Create GitHub repositories",
        "Create Railway projects",
        "Set environment variables",
        "Deploy applications",
        "Configure HighLevel redirect URI",
        "Test OAuth flow"
    )
}

$deploymentConfig | ConvertTo-Json -Depth 3 | Out-File "deployment_config.json" -Encoding UTF8

Write-Host "[SUCCESS] Deployment configuration saved to deployment_config.json" -ForegroundColor Green
Write-Host "[INFO] Next: Follow the manual steps above or use the full deploy_railway.ps1 script" -ForegroundColor Cyan
Write-Host "[SUCCESS] Deployment preparation completed!" -ForegroundColor Green