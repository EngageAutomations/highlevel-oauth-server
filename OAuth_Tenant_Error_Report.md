# OAuth Tenant Identifier Error Report

## Error Summary
**Error**: `{"error":"Missing tenant identifier","detail":"Provider did not supply tenant info; please re-install and explicitly choose Agency or a Location."}`

**Status**: UNRESOLVED - Error persists after multiple fix attempts

**Last Occurrence**: 2025-09-10T23:27:23Z (after latest deployment with scopes fix)

## Root Cause Analysis

The error occurs during OAuth callback processing when the system cannot determine the tenant context (Agency vs Location) for a HighLevel installation. The system attempts tenant introspection via the `/users/me` endpoint but continues to fail.

## Troubleshooting Timeline

### Phase 1: Initial User Type Fix
**Date**: Earlier deployment
**Issue**: OAuth callback required `user_type` parameter even when not provided by HighLevel
**Solution Applied**: 
- Modified `oauth_server.js` to make `user_type` optional in token form creation
- Added fallback logic to use tenant introspection when `user_type` is missing
**Result**: Partially resolved - eliminated user_type validation errors

### Phase 2: Version Header Fix
**Date**: Previous deployment (23:21:22)
**Issue**: HighLevel API calls missing required `Version` header
**Solution Applied**:
- Added `Version: '2021-07-28'` header to all HighLevel API calls
- Updated `/users/me` introspection call in `oauth_server.js` lines 1070-1110
**Result**: Header added but tenant introspection still failing

### Phase 3: OAuth Scopes Investigation
**Date**: Latest deployment (23:27:23)
**Issue**: "User id me not found" error suggested insufficient permissions
**Root Cause Discovered**: `HL_SCOPES` environment variable was not set in Railway
**Solution Applied**:
- Set `HL_SCOPES="contacts.readonly,locations.readonly,users.readonly,companies.readonly"`
- Redeployed OAuth server with updated scopes configuration
**Result**: Server deployed successfully but error persists

## Technical Details

### Current OAuth Flow Issues
1. **Token Exchange**: Successfully completes with HighLevel
2. **Tenant Introspection**: `/users/me` call fails with "User id me not found"
3. **Fallback Logic**: No alternative method to determine tenant context

### Code Locations Investigated
- `oauth_server.js` lines 1070-1150: Tenant introspection logic
- `oauth_server.js` lines 890-910: OAuth scope configuration
- `oauth_server.js` lines 1100-1150: Error handling and tenant validation

### Environment Configuration
- **HL_CLIENT_ID**: Set and working (token exchange succeeds)
- **HL_CLIENT_SECRET**: Set and working (token exchange succeeds)
- **HL_SCOPES**: Now set to required scopes
- **REDIRECT_URI**: Correctly configured
- **Database**: Properly initialized and accessible

## Current Hypothesis

Despite setting the required scopes, the `/users/me` endpoint continues to return "User id me not found". Possible causes:

1. **Scope Propagation Delay**: New scopes may not have propagated to active OAuth sessions
2. **HighLevel API Changes**: The `/users/me` endpoint may have changed requirements
3. **Token Context**: The access token may not have the correct context for user introspection
4. **Alternative Endpoint**: May need to use a different endpoint for tenant discovery

## Attempted Solutions Summary

| Phase | Issue | Solution | Status |
|-------|-------|----------|--------|
| 1 | Missing user_type validation | Made user_type optional | ✅ Fixed |
| 2 | Missing Version header | Added Version: '2021-07-28' | ✅ Fixed |
| 3 | Missing OAuth scopes | Set HL_SCOPES with required permissions | ❌ Still failing |

## Next Steps Recommendations

1. **Verify Scope Application**: Test with a fresh OAuth flow to ensure new scopes are applied
2. **Alternative Endpoints**: Research other HighLevel API endpoints for tenant discovery
3. **HighLevel Documentation**: Review latest API documentation for `/users/me` requirements
4. **Direct Token Inspection**: Examine the actual token payload and permissions
5. **HighLevel Support**: Consider reaching out to HighLevel support for API guidance

## Deployment History

- **23:21:22**: Version header fix deployment
- **23:27:23**: OAuth scopes fix deployment (current)

## Error Logs

```
TOKEN EXCHANGE ATTEMPT: {
  form_params: {
    client_id: '68474924a586bce22a6e64f7-mf8icnvr',
    client_secret: '[REDACTED]',
    grant_type: 'authorization_code',
    code: '[REDACTED]',
    redirect_uri: 'https://api.engageautomations.com/oauth/callback'
  },
  endpoint: 'https://services.leadconnectorhq.com/oauth/token'
}
warn: Tenant introspection failed: {"error":"User id me not found","service":"oauth-server","timestamp":"2025-09-10T23:24:27.476Z"}
```

## Impact Assessment

- **Severity**: HIGH - Prevents new OAuth installations
- **Affected Users**: All new HighLevel marketplace installations
- **Workaround**: None available - requires manual tenant specification
- **Business Impact**: Blocks customer onboarding through HighLevel marketplace

---
*Report Generated*: 2025-09-10T23:30:00Z  
*Status*: Investigation ongoing