---
'@delightstack/auth': patch
---

Close an open redirect in the sign-in routes. The `?redirect=` parameter was passed through to the browser's `Location` untouched, so `/api/auth/signin/google?redirect=//evil.example.com` sent users to another origin the moment they finished signing in — on the app's own domain, with a real session, which is exactly the shape a phishing link wants. The parameter is now narrowed to a same-site path (absolute URLs, protocol-relative `//host`, and `/\host` all fall back to `/`) both when the state is signed and again when the callback consumes it.
