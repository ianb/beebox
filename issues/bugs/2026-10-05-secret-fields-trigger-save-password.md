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

## Direction to verify

- Do not use `type="password"`. Use a text input with `autocomplete="off"`,
  `spellcheck={false}`, `autoCapitalize="off"`, and mask the value with CSS
  (`-webkit-text-security: disc`, supported in Chrome and Safari). A
  show/hide toggle can remove the mask.
- Check whether submitting through `fetch` without a native form `submit`
  event also avoids the prompt.
- Verify in a real Chrome and Safari profile with the built-in password
  manager on (the headless test browser does not show the save prompt), and
  confirm screen readers still announce the field sensibly.
