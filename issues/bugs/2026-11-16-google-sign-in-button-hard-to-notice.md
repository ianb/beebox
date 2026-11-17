---
title: "The Sign in with Google button on the login page is hard to notice"
workstream: unattached
area: beebox
labels: [login, ui]
filed-by: agent
discovered-by: Ian
discovered-in: main session — developer signing in, 2026-11-16
---

On the login page, the Google option is a plain white button with grey text and a thin border. It sits below the email and password form and a small "or". It is easy to miss.

The button is `beebox/src/frontend/src/pages/login/components/GoogleSignInButton.tsx`, and `LoginPage.tsx` places it.

## Possible changes

- Add the Google "G" logo. Google's sign-in branding guidelines specify the logo, colors, and text for this button, and people recognize the result.
- Put the Google button above the password form when both methods are available. Or make the divider between the two methods more visible.
