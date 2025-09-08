# 🔒 Security Validation Checklist

## Overview
This document provides security validation criteria for the dual Railway OAuth implementation.

## ✅ Security Requirements Checklist

### 1. Token Security
- [ ] **Encryption at Rest**: All tokens stored with AES-256 encryption
- [ ] **Secure Key Management**: Encryption keys stored as Railway environment variables
- [ ] **Token Rotation**: Refresh tokens before expiration (implement 5-minute buffer)
- [ ] **No Token Logging**: Ensure tokens never appear in logs or error messages

### 2. Authentication & Authorization
- [ ] **Service-to-Service JWT**: Implement proper JWT validation between services
- [ ] **Scope Validation**: Verify requested scopes against allowed scopes
- [ ] **State Parameter**: Use cryptographically secure state parameter in OAuth flow
- [ ] **PKCE Implementation**: Consider PKCE for additional security (if supported by HighLevel)

### 3. Network Security
- [ ] **HTTPS Only**: All endpoints must use HTTPS in production
- [ ] **CORS Configuration**: Restrict CORS to necessary origins only
- [ ] **Rate Limiting**: Implement rate limiting on all public endpoints
- [ ] **Request Validation**: Validate all incoming requests and sanitize inputs

### 4. Proxy Security
- [ ] **Endpoint Allow-listing**: Restrict proxy to approved HighLevel endpoints only
- [ ] **Request Filtering**: Filter out sensitive headers and parameters
- [ ] **Response Sanitization**: Remove sensitive data from proxy responses
- [ ] **Audit Logging**: Log all proxy requests (without sensitive data)

### 5. Database Security
- [ ] **Connection Encryption**: Use SSL/TLS for database connections
- [ ] **Parameterized Queries**: Prevent SQL injection with prepared statements
- [ ] **Access Controls**: Limit database user permissions to minimum required
- [ ] **Backup Encryption**: Ensure database backups are encrypted

### 6. Environment Security
- [ ] **Secret Management**: No secrets in code or version control
- [ ] **Environment Separation**: Separate dev/staging/production environments
- [ ] **Access Logging**: Log access to sensitive operations
- [ ] **Error Handling**: Generic error messages to prevent information disclosure

## 🚨 Critical Security Fixes Needed

### High Priority
1. **Token Encryption**: Implement AES-256 encryption for stored tokens
2. **JWT Validation**: Add proper signature verification for service-to-service calls
3. **Endpoint Allow-listing**: Create and enforce proxy endpoint restrictions
4. **Rate Limiting**: Implement rate limiting to prevent abuse

### Medium Priority
1. **Audit Logging**: Add comprehensive audit trail
2. **Input Validation**: Strengthen input validation and sanitization
3. **Error Handling**: Implement secure error handling patterns
4. **CORS Hardening**: Restrict CORS to specific origins

## 🔧 Implementation Examples

### Token Encryption (Node.js)
```javascript
const crypto = require('crypto');

class TokenEncryption {
  constructor(encryptionKey) {
    this.key = Buffer.from(encryptionKey, 'base64');
  }

  encrypt(token) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipher('aes-256-gcm', this.key);
    cipher.setAAD(Buffer.from('oauth-token'));
    
    let encrypted = cipher.update(token, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  decrypt(encryptedToken) {
    const [ivHex, authTagHex, encrypted] = encryptedToken.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    
    const decipher = crypto.createDecipher('aes-256-gcm', this.key);
    decipher.setAAD(Buffer.from('oauth-token'));
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }
}
```

### JWT Service-to-Service Authentication
```javascript
const jwt = require('jsonwebtoken');

function generateServiceToken(service, secret) {
  return jwt.sign(
    { 
      service,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + (5 * 60) // 5 minutes
    },
    secret,
    { algorithm: 'HS256' }
  );
}

function validateServiceToken(token, secret) {
  try {
    return jwt.verify(token, secret, { algorithm: 'HS256' });
  } catch (error) {
    throw new Error('Invalid service token');
  }
}
```

### Endpoint Allow-list
```javascript
const ALLOWED_ENDPOINTS = [
  '/oauth/token',
  '/oauth/locationToken',
  '/contacts/',
  '/opportunities/',
  '/calendars/',
  '/users/',
  '/locations/'
];

function validateEndpoint(path) {
  return ALLOWED_ENDPOINTS.some(allowed => 
    path.startsWith(allowed) || 
    new RegExp(allowed.replace('/', '\\/').replace('*', '.*')).test(path)
  );
}
```

## 📊 Security Metrics

### Monitoring Requirements
- [ ] **Failed Authentication Attempts**: Track and alert on suspicious patterns
- [ ] **Token Usage Patterns**: Monitor for unusual token usage
- [ ] **Proxy Request Patterns**: Track proxy usage and detect anomalies
- [ ] **Error Rates**: Monitor error rates for security incidents

### Alerting Thresholds
- Failed auth attempts: > 10 per minute from same IP
- Token refresh failures: > 5% failure rate
- Proxy errors: > 2% error rate
- Database connection failures: Any failure

## 🔄 Security Review Process

### Pre-Deployment
1. Code security review
2. Dependency vulnerability scan
3. Environment variable audit
4. SSL/TLS configuration check

### Post-Deployment
1. Penetration testing
2. Security monitoring setup
3. Incident response plan activation
4. Regular security audits (monthly)

## 📋 Compliance Notes

### Data Protection
- Implement data retention policies
- Ensure GDPR compliance for EU users
- Document data processing activities
- Implement right to deletion

### Audit Requirements
- Maintain audit logs for 1 year minimum
- Include timestamp, user, action, result
- Secure log storage and access
- Regular log review and analysis

---

**Last Updated**: $(Get-Date)
**Review Frequency**: Monthly
**Next Review**: $(Get-Date).AddMonths(1)