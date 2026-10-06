---
title: "Entering a secret makes the browser offer to save it as a password"
workstream: secret-field-masking
needs: [manual-testing]
area: beebox
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder report
---

> **⏳ Awaiting manual testing** — fix landed in `956ce3b2b` (secret-field-masking); set a machine secret in real Chrome and Safari with the built-in password manager on and confirm neither offers to save it. Only the developer clears this.

When the boxholder sets a secret in Admin, the browser offers to save the
value as a password. A secret is a machine credential (an API key or token),
not a login. Saving it in the password manager stores the key in a second
place, tied to the box's host name.

## A fix was already attempted

The secret value field (`ValueField` in
`beebox/src/frontend/src/components/admin/SecretsSection/forms.tsx:121-150`)
keeps `type="password"` to mask the value and adds `autocomplete="new-password"`
plus the 1Password, LastPass, Bitwarden, and Dashlane ignore attributes. The
browser still prompts. Chrome's own password manager treats a
`type="password"` field in a submitted form as a credential, and
`new-password` invites "save" or "suggest a strong password" rather than
suppressing it.

The Cloudflare publishing token field has the same shape
(`beebox/src/frontend/src/components/admin/CloudflarePublishConnectionsSection/view.tsx:179`).
Search for other credential inputs (connector setup, any token field) and fix
them together.

## Boxholder decisions (2026-10-05)

- **Not a password field, but hidden by default.** A secret is "not secret
  like a password", so drop `type="password"`. But agents take screenshots of
  the app (`bin/browse` for tests and exhibits, Claude in Chrome in the
  boxholder's browser), and a visible value would enter agent context that
  way. So the input is a text field masked with CSS
  (`-webkit-text-security: disc`), with a show toggle for checking a pasted
  value. Keep `autocomplete="off"`, `spellcheck={false}`, and
  `autoCapitalize="off"`.
- **The boxholder can show a stored value.** Today a value is "never shown
  again" after saving. The boxholder wants a way to show it in Admin.
- **Not exposed to the agent.** Showing is a signed-in owner action in the
  UI. Agents keep their current access, which is through grants and never by
  reading values back. To keep screenshots from catching it: the stored value
  is not in the page until the owner clicks Show (fetched then), and it
  re-hides after about 30 s, on blur, and on navigation. The owner accepted
  refusing Show when `navigator.webdriver` is set, which blocks
  automation-driven browsers such as `bin/browse` (it cannot block Claude in
  Chrome, which runs in the boxholder's own browser).

The "show" part changes the security surface: a new owner-gated read of
secret values. It needs its own route review, an entry in
`beebox/docs/security-report.md` (security-report skill). Each successful Show
is logged in the existing access log; fresh sign-in is not required.

## Verify

- In a real Chrome and Safari profile with the built-in password manager on,
  setting a secret shows no save prompt. The headless test browser does not
  show the prompt.
- The other credential inputs (the Cloudflare token field above, any
  connector token field) get the same treatment.

## Manual testing

- With the built-in password manager enabled, set a machine secret in real
  Chrome and Safari profiles and confirm neither browser offers to save it as a
  password. Headless browser testing cannot verify this prompt behavior.

## Next-action note (2026-10-06)

Checked "fixed?": fixed in code by merge 956ce3b2b (secret-field-masking): text input with the CSS mask and `autoComplete="off"` in `SecretsSection/forms.tsx`, owner-only Show refused under `navigator.webdriver`, the Cloudflare token field, a security-report entry, and doctests. Only the browser prompt check remains, which needs a real browser; set `needs: [manual-testing]`.
