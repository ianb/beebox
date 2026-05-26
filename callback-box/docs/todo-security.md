# Security TODOs

Known security gaps and future hardening work.

## Google OAuth: shared token with broad scopes

**Status:** Known limitation, accepted for now (single-owner system).

**Problem:** All boxes share a single Google OAuth token that has all scopes (calendar, gmail, drive). Per-box `googleServices` policy in `box.json` controls which services each box is *allowed* to call, but this is a soft boundary enforced in application code, not a hard security boundary.

**Risks:**
- A compromised or buggy connector in one box could access Google APIs not intended for that box (e.g., a calendar-only box could theoretically read Gmail if the code bypasses the policy check).
- The token is stored in a single centralized file (`CB_GOOGLE_TOKENS_FILE`). Compromise of that file grants access to all authorized Google services.
- Revoking Google access (via Google Account settings) affects ALL boxes simultaneously.

**Mitigations (future):**
- **Separate OAuth clients per scope tier:** Register multiple Google OAuth apps (e.g., "callback-calendar" with only calendar scopes, "callback-full" with all scopes). Boxes reference a specific client. This provides hard scope isolation at Google's level.
- **Incremental auth:** Use Google's incremental authorization to request only the scopes each box needs, rather than all scopes upfront.
- **Audit logging:** Log which box accessed which Google API, so unauthorized cross-box access is detectable.
- **Per-user tokens:** When multi-user support is added, tokens should be keyed by user email. Each user authorizes separately, and boxes use the token of the user who connected them.

## File permissions

The centralized token file (`CB_GOOGLE_TOKENS_FILE`) and any legacy `google.secret.json` files must be readable only by the `callback` user (`chmod 600`). The deploy scripts should enforce this.
