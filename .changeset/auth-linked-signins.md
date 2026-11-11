---
'@delightstack/auth': minor
---

Linked sign-in methods that hold up:

- **Add another email to an account.** New routes: `POST /user/signin-method/email` and `POST /user/signin-method/email/confirm`. On the client: `user.addEmailSignInMethod(email, password?)` and `user.confirmEmailSignInMethod(code)`. Pass a password and the new address signs in with it once confirmed; without one, it signs in with a one-time code until a password is set. A one-time code goes to the new address, and the address becomes a verified email sign-in only when that code comes back. Until then nothing is written to `user_auth`, so an unconfirmed address can't block anyone's sign-up or be used to sign in.
- **Removing a sign-in method checks its owner (security fix).** `DELETE /user/signin-method/:id` removed any user's method by id. It now answers 404 for a method that isn't the caller's, and refuses the method the current session signed in with. `revokeSignInMethod(id, owner_user_id)` also signs out every session that used the removed method.
- **Passkeys no longer break password and code sign-in.** A passkey's `user_auth` row carries the account's email, so looking an address up by email could land on the passkey's row instead of the password's. Email lookups now skip passkey and OAuth rows.
- **An OAuth sign-in claims an unconfirmed email sign-up instead of duplicating it.** It previously made a second, empty account. When the account's sign-ins were never confirmed, its unproven credentials (password, unconfirmed passkeys, sessions) are wiped as it's claimed, so registering someone else's address first gets an attacker nothing.
- **Sign-in code requests for an unknown address now answer 204** without sending anything. They used to fail with a 500, which told a caller who has an account.
- **Password reset works for any email sign-in, not only one that already has a password.** A reset is how an address that signs in by code, or was added later, gets its first password.
