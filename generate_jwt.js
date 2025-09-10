const crypto = require('crypto');

// S2S Secret from deployment instructions
const S2S_SECRET = 'Nzk4YjBmNTItZTlmMS00OGQ4LWI3YWMtMWQ0MzQxMTY3NTEx';

// Simple JWT creation (header.payload.signature)
function createJWT() {
    const header = {
        "alg": "HS256",
        "typ": "JWT"
    };
    
    const payload = {
        "service": "oauth-server",
        "iat": Math.floor(Date.now() / 1000),
        "exp": Math.floor(Date.now() / 1000) + 3600 // 1 hour
    };
    
    const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    
    const signature = crypto
        .createHmac('sha256', S2S_SECRET)
        .update(`${encodedHeader}.${encodedPayload}`)
        .digest('base64url');
    
    return `${encodedHeader}.${encodedPayload}.${signature}`;
}

const jwt = createJWT();
console.log('Bearer ' + jwt);