---
title: "Entering a secret makes the browser offer to save it as a password"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder report
---

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

- **Plain text input.** A secret is "not secret like a password". The value
  field is an ordinary visible text input, not masked: no `type="password"`
  and no CSS masking. Keep `autocomplete="off"`, `spellcheck={false}`, and
  `autoCapitalize="off"` so the browser neither saves nor alters the key.
- **The boxholder can show a stored value.** Today a value is "never shown
  again" after saving. The boxholder wants a way to show it in Admin.
- **Not exposed to the agent.** Showing is a signed-in owner action in the
  UI. Agents keep their current access, which is through grants and never by
  reading values back.

The "show" part changes the security surface: a new owner-gated read of
secret values. It needs its own route review, an entry in
`beebox/docs/security-report.md` (security-report skill), and a decision on
details such as whether showing is logged (the secrets access log exists,
`beebox/src/core/secrets/access-log.ts`) and whether it requires a fresh
sign-in.

## Verify

- In a real Chrome and Safari profile with the built-in password manager on,
  setting a secret shows no save prompt. The headless test browser does not
  show the prompt.
- The other credential inputs (the Cloudflare token field above, any
  connector token field) get the same treatment.
