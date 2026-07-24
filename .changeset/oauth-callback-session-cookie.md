---
'@delightstack/auth': patch
---

Fix OAuth sign-in leaving the browser signed out. The handler only set the session cookie when a route returned a JSON body containing `jwt`, but the OAuth callback finishes with a redirect — so the session it had just created was thrown away and the user landed back on the app unauthenticated. Route handlers now get an `applySession(jwt, decoded_jwt)` callback (session cookie + saved-preferences restore, the same path the JSON responses take) and the OAuth callback calls it before redirecting.
