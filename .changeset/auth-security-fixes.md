---
"@delightstack/auth": patch
---

Security fixes: `decodeJwt` now verifies the key id and signature **before** checking expiry, so a forged token can no longer reach the session-refresh path (which trusts the token's `jti`) by claiming to be expired. The OAuth token exchange (`POST /oauth/token`) now authenticates the client — `client_secret` is verified and the auth code / refresh token must have been issued to the requesting `client_id`. Password reset and password change now properly `await` `checkPasswordStrength`, so weak or breached passwords are rejected again instead of the check being silently detached.
