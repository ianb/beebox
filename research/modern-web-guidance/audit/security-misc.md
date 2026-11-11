# Audit: security (17 guides) + built-in-ai, wasm, webmcp triage

## Slice summary

- Real findings exist in two guides: `security` (header and cookie hygiene) and, weakly, `trusted-types`.
- The frontend has 5 `dangerouslySetInnerHTML` sites (KaTeX, 3 QR SVGs, hljs). All feed generated or escaped markup, not user HTML. No `innerHTML` in the app; one in beebox-clerk (a static template). No DOMPurify in the web app. The markdown renderer rebuilds raw HTML as Markdoc nodes through an allow-list, so `setHTML()` has nothing to replace.
- Most valuable fixes, all server-side and small:
  1. The CSP is Report-Only, and `frame-ancestors` is ignored in Report-Only. No `X-Frame-Options` exists anywhere in the main app. The app is frameable today. Add `X-Frame-Options: SAMEORIGIN` plus a separately enforced `Content-Security-Policy: frame-ancestors 'self'`. (Note: the theme studio harness iframes the app itself, same-origin, so SAMEORIGIN is compatible.)
  2. Companion headers (HSTS, `Referrer-Policy`, `Permissions-Policy`) are not set by the app or nginx. `beebox/docs/implemented-plans/app-wide-csp.md:322` defers them explicitly ("other headers are a separate hardening pass"). Cloudflare may set HSTS at the edge; unverified.
  3. Session cookie is named `bbx_session` (no `__Host-`/`__Secure-` prefix). Other attributes (httpOnly, Lax, secure-on-https, path `/`) already match the guide.
- Reject: `validate-origins` (Origin API not in Firefox, needs Safari 26.5; our checks are same-origin and already strict), `restrict-outbound-connections` (Chrome 152 only), all passkey/signing/encryption guides (no such feature), `local-network-access`, `quick-sign-ins`, `verify-email-ownership`.
- Our `security-report.md` agrees with every finding here; it lists the CSP as Report-Only and the raw-HTML allow-list as the only XSS control.

## Security guides

### security
- Asks: Phase 1 hygiene (no `innerHTML` on untrusted input, `__Host-` cookies, `frame-ancestors` plus `X-Frame-Options`, strict `postMessage` origin checks); Phase 2 report-only rollout; Phase 3 enforced CSP, Trusted Types, COOP/CORP, HSTS, nosniff, Referrer-Policy, Permissions-Policy, Clear-Site-Data on logout.
- Applies here: yes — web app served by Fastify at a public origin with a session cookie.
- Findings: 8 checks, 4 real (headers and cookie name), rest already met.
  - `beebox/src/lib/csp.ts:44` `["frame-ancestors", "'self'"]` — real. It ships only as `Content-Security-Policy-Report-Only` (`beebox/src/webapp/server-root/root-routes.ts:120` `reply.header("Content-Security-Policy-Report-Only", policy)`), where `frame-ancestors` has no effect. No `X-Frame-Options` is set in `beebox/src/webapp` or `beebox/deploy/nginx/beebox.conf`. Result: the main app can be framed cross-origin. Only the `/browser/` proxy page (`proxy/response.ts:19`, enforced `frame-ancestors 'self'`) and frozen files are protected.
  - `beebox/deploy/nginx/beebox.conf` — only `add_header` lines are Cache-Control/Retry-After/X-Beebox-Deploy. No HSTS, `Permissions-Policy`, `Referrer-Policy`, COOP. real (needs check of what Cloudflare adds at the edge; the report notes Cloudflare Flexible SSL, `security-report.md:483`).
  - `beebox/src/webapp/auth.ts:26` `const COOKIE_NAME = "bbx_session";` — real but low value. `password-post.ts:161` and `google.ts:124` set `httpOnly: true, sameSite: "lax", path: "/"` and `secure` only when the public URL is https, so `__Host-` is not usable on http dev/localhost. A rename would also sign out every session and touch the hub, perf scripts (`page-load.ts:80`) and `bin/` tools.
  - `beebox/src/webapp/routes/auth/register.ts:161` `reply.clearCookie(COOKIE_NAME, { path: "/" })` — logout sends no `Clear-Site-Data`. Real but optional; the app stores no per-user cache keyed to session besides the SPA's own state.
  - `beebox/src/webapp/mobile-cookie.ts:46` `sameSite: "lax"` — meets guide (path-scoped `/${boxSlug}`, so `__Host-` would not apply).
  - postMessage: `beebox/src/frontend/src/lib/tab-arrangement-relay.ts:31`, `.../screenshot-relay.ts:68`, `beebox-clerk/src/entrypoints/box-relay.content.ts:144` all use `if (event.source !== window || event.origin !== location.origin) return;` and send to `location.origin`. Payloads are parsed (`parseRelayPageMessage`). not real (already meets §1.5). iOS bridge (`native-post.ts:56` `shell.webkit?.messageHandlers?.[channel]?.postMessage(payload)`) is a WKScriptMessageHandler call, no origin concept on the page side. not real.
  - `target="_blank"`: 20+ sites. Every one has `rel="noreferrer"` or `noopener noreferrer`, except `AppNav/nav.tsx:106` and `PdfPaneMenu.tsx:15`, which go through `dropdown-menu-item.tsx:91` (adds `rel` whenever `target` is set). Both are same-origin anyway. not real.
  - Inline script: `beebox/src/frontend/index.html` has an inline `<style>` only, no inline `<script>`; prod `script-src 'self'` already strict. Meets guide.
- Our guidance: agrees — `beebox/docs/content-security-policy.md` ("currently Report-Only"); `beebox/docs/implemented-plans/app-wide-csp.md:322` defers helmet-style companion headers on purpose; `beebox/docs/security-report.md:468` records the HTML allow-list as the XSS control.
- Fix size: header work is 1 file (`registerCspReportingHeaders` in `root-routes.ts` or a new sibling `onSend` hook) plus `test/lib/csp.test.ts`-style test. Risk: `X-Frame-Options: SAMEORIGIN` breaks nothing known (theme studio and PDF/frozen frames are same-origin; box browser proxy already sets its own). HSTS needs a short max-age first and a check that Tailscale/localhost http use is unaffected (browsers ignore HSTS on http). Verify with `curl -I` against the dev router and `bin/browse`.
- Lint-able: no (headers are runtime config). A unit test asserting the headers on the HTML route covers it.
- Browser: all headers are Baseline widely available; Safari 17.0 ok. `__Host-` prefix is Baseline.
- Lean: adopt with changes — add enforced `frame-ancestors`+`X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` (camera/mic needed for capture: allow self), HSTS after checking Cloudflare. Skip cookie rename and Clear-Site-Data. Promoting full CSP to enforcing is already a tracked gated step.

### sanitize-untrusted-html
- Asks: Use `Element.setHTML()` (Sanitizer API) or DOMPurify instead of `innerHTML` for untrusted HTML.
- Applies here: partly — we never insert untrusted HTML strings in the web app.
- Findings: 7 candidate sites; 0 real.
  - `beebox/src/frontend/src/components/Markdown/Math.tsx:75` `dangerouslySetInnerHTML={{ __html: result.html }}` — not real (KaTeX output, `trust: false`; comment states it).
  - `beebox/src/frontend/src/components/settings/CompanionPairingSection.tsx:179` / `:193` `dangerouslySetInnerHTML={{ __html: qrSvg(...) }}` — not real (our own QR generator, numeric content).
  - `beebox/src/frontend/src/components/themes/ThemedFileCard/view/CardPrintFooter.tsx:26` `dangerouslySetInnerHTML={{ __html: qr }}` — not real (same generator).
  - `workstreams-app/src/frontend/components/CodeBlock.tsx:98` `dangerouslySetInnerHTML={{ __html: html }}` — not real (highlight.js escapes source; dev dashboard, Chrome only).
  - `beebox-clerk/src/entrypoints/box-relay.content.ts:86` `panel.innerHTML = \`<style>…\`` — not real (static template; message text goes through `textContent` via the `<p>` element).
  - `beebox-clerk` uses Defuddle + DOMPurify for page capture (`beebox-clerk/AGENTS.md:24`), on the extension side; Chrome only, and `setHTML` is in Chrome 146+ but DOMPurify is already in place and works.
  - Markdown raw HTML: `beebox/src/shared/markdoc-config/html-policy.ts` rebuilds fragments as Markdoc nodes, so no HTML string reaches the DOM. Nothing for `setHTML` to do.
  - Stock views and `box-docs/views.md`: no `dangerouslySetInnerHTML`, `innerHTML` or `DOMPurify` anywhere in `beebox/src/schemas`, `beebox/src/plugins`, `beebox/box-docs`. React escapes.
- Our guidance: agrees — `security-report.md:468` describes the allow-list design that avoids `innerHTML`.
- Fix size: none.
- Lint-able: eslint — a `react/no-danger` rule would flag the 5 sites; they would each need one justified disable. Not worth adding given they are all generated markup (our rule on suppressions requires a concrete justification; the comments already give it). Leave.
- Browser: `setHTML` Chrome 146, Firefox 148, no Safari. Would need DOMPurify fallback; not adoptable for the iOS client.
- Lean: reject — no untrusted-HTML sink exists, and Safari lacks the API.

### trusted-types
- Asks: Enforce `require-trusted-types-for 'script'` after routing DOM sinks through policies, rolled out via Report-Only first.
- Applies here: partly — the goal fits, but the framework and extension boundary limit it.
- Findings: 5 string sinks in app code (the `dangerouslySetInnerHTML` sites above); React DOM itself writes `innerHTML` only for `dangerouslySetInnerHTML` and SVG/`<style>` edge cases; 0 `eval` (note `beebox/src/frontend/src/lib/zod-jitless.ts` explicitly avoids `new Function`).
  - Prod CSP (`csp.ts`) has no `require-trusted-types-for` directive, not even Report-Only. real (a free data-gathering step).
  - Box views are compiled ES modules from agents, run same-origin (`content-security-policy.md`). A box view that sets `innerHTML` would be reported.
  - p5 figures that use `eval`/`new Function` would be reported (already known from `content-security-policy.md`).
- Our guidance: silent on Trusted Types. `content-security-policy.md` covers script-src only.
- Fix size: add `["require-trusted-types-for", "'script'"]` to the Report-Only policy in `beebox/src/lib/csp.ts` plus the csp test. One line, zero blocking risk; the digest (`pnpm csp-digest`) would then show which sinks fire. Enforcement later would need a policy for KaTeX/QR/hljs outputs.
- Lint-able: no (CSP header).
- Browser: Baseline since 2026-02-24; Chrome 83, Safari 26, Firefox 148. Safari 17.0 does not enforce, so on iOS it does nothing. Header is ignored harmlessly there.
- Lean: adopt with changes — add it to Report-Only only, as a cheap measurement. Do not enforce yet.

### validate-origins
- Asks: Compare origins with the `Origin` API (`Origin.from`, `isSameOrigin`, `isSameSite`) instead of string compares.
- Applies here: partly — we have 3 `postMessage` receivers and a few URL checks.
- Findings: 6 candidate sites; 0 real.
  - `tab-arrangement-relay.ts:31`, `screenshot-relay.ts:68`, `box-relay.content.ts:144` — `event.origin !== location.origin` compares two serialized origins of a non-opaque page. Safe; the guide's "null === null" case needs a sandboxed iframe sender, which we do not have. not real.
  - `beebox/src/webapp/routes/browser/proxy/person-gate.ts` `isSameOrigin` (server-side, own helper) — not real; Node, not browser.
  - `beebox/src/frontend/src/lib/off-machine-origin.ts` hostname checks for localhost — not real; these test hostnames, not origins.
- Our guidance: agrees — `beebox-clerk/src/domain/relay-messages.ts:5` "strict origin + source" checks.
- Fix size: none.
- Lint-able: no.
- Browser: Chrome 145, Safari 26.5; no Firefox. Not at Safari 17.0.
- Lean: reject — no gain over current checks, and not available on the iOS floor.

### secure-external-subresources
- Asks: Add SRI (`integrity`), `crossorigin`, `referrerpolicy` to third-party scripts/styles/fonts; use CSS `integrity()`/`cross-origin()`/`referrer-policy()` in `url()`.
- Applies here: no — the app loads no external script, stylesheet or font (`index.html` has no `http` links; `font-src 'self'`, `script-src 'self'`).
- Findings: 3 `<img src={…}>` of external pictures (`Avatar.tsx:55` already has `referrerPolicy="no-referrer"`); the YouTube iframe (`VideoEmbed.tsx:21`) has no `referrerpolicy`. Real but trivial: add `referrerPolicy="strict-origin-when-cross-origin"` to it (YouTube requires a referrer for embeds; do not use `no-referrer`).
- Our guidance: silent.
- Fix size: 1 attribute in `VideoEmbed.tsx`; verify by playing an embed in browse. Document-level `Referrer-Policy` is covered under `security`.
- Lint-able: eslint — `react/iframe-missing-sandbox` exists but requires `sandbox`, which YouTube embeds need relaxed; skip.
- Browser: SRI and `referrerpolicy` attribute are Baseline widely available. CSS `integrity()` Chrome 150 only; not needed.
- Lean: n/a for SRI; adopt the one attribute under `security`.

### restrict-outbound-connections
- Asks: Send a `Connection-Allowlist` header to lock all outbound connections of the document.
- Applies here: partly — we already declare `connect-src` for Deepgram/OpenAI (`csp.ts:36`) but only Report-Only.
- Findings: 0 code sites; header-only.
- Our guidance: agrees with the intent — "every origin/scheme is traced to a real browser connection" (`csp.ts:5`).
- Fix size: would be one more header line, but no enforcement benefit while CSP itself is Report-Only.
- Lint-able: no.
- Browser: Chrome/Edge 152 only; no Safari, Firefox. Cannot be a control for the iOS client.
- Lean: reject — wait until CSP enforces and the header reaches Safari.

### local-network-access
- Asks: Handle the Chrome permission prompt and `Permissions-Policy` tokens (`local-network`, `loopback-network`) when a public page fetches LAN or loopback addresses.
- Applies here: no — the web app and extension do not fetch LAN/loopback from a public page (`git grep` for `127.0.0.1|localhost|192.168` in `frontend/src` finds only hostname checks). beebox-clerk talks to a box origin the user enabled via extension host permissions, which bypass LNA prompts for extension pages. Tailscale boxes are reached as the page origin itself.
- Lean: n/a.

### passkeys
- Asks: Orientation: WebAuthn prerequisites (secure context, RP ID).
- Applies here: no — no WebAuthn in the repo (`git grep` for `PublicKeyCredential|navigator.credentials|webauthn` has no code hits). Auth is password + Google OAuth (`routes/auth/`). `security-report.md:662` says "MFA/passkeys" are an accepted gap.
- Lean: n/a.

### passkey-registration
- Asks: Server and client flow to register a passkey.
- Applies here: no — no passkey feature; adding one is a product decision outside this audit (recorded as an accepted gap, `security-report.md:662`).
- Lean: n/a.

### passkey-authentication
- Asks: Sign in with discoverable credentials and conditional UI (`autocomplete="username webauthn"`).
- Applies here: no — login fields use `autoComplete="email"` and `"current-password"` (`pages/login/components/LoginFields.tsx:24,29`). Those are already correct for password managers.
- Lean: n/a.

### passkey-management
- Asks: List, rename and delete passkeys; use Signal API to sync.
- Applies here: no — no passkeys.
- Lean: n/a.

### passkey-reauthentication
- Asks: Step-up with the signed-in user's passkeys before sensitive changes.
- Applies here: no — password change asks for the current password (`PasswordSection.tsx:90`), which is the equivalent step-up today.
- Lean: n/a.

### passkey-conditional-create
- Asks: Silently create a passkey after a password sign-in.
- Applies here: no — no passkeys.
- Lean: n/a.

### quick-sign-ins
- Asks: Use `navigator.credentials.get({ uiMode: "immediate" })` to sign in inline.
- Applies here: no — no passkeys; the password credential path is Chrome-only (Chrome 60, no Safari).
- Lean: n/a.

### verify-email-ownership
- Asks: Email Verification API (`autocomplete="email-verification-token"`) instead of emailed codes.
- Applies here: no — we send no verification email by design ("no outbound-mail identity", `security-report.md:542`); invites and reset links are operator-minted.
- Lean: n/a.

### client-side-encryption
- Asks: Use WebCrypto KEMs and AEAD to encrypt data in the browser.
- Applies here: no — no `crypto.subtle` use in `frontend/src`, `schemas`, `plugins`, clerk or workstreams-app. Backup encryption is server-side restic.
- Lean: n/a.

### digital-signatures
- Asks: Sign and verify data with WebCrypto (ML-DSA, Ed25519).
- Applies here: no — session signing is server-side HMAC (`signSession`); the browser signs nothing.
- Lean: n/a.

## Triage: built-in-ai

### language-detection, language-model, prompt-api, summarizer, translator
- Asks: Run on-device Gemini Nano tasks through `LanguageDetector`, `LanguageModel`/Prompt API, `Summarizer`, `Translator`.
- Applies here: no — the app uses server-side Claude/other models by design; none of these APIs exist on Safari or iOS (22 GB disk, 16 GB RAM, Chrome desktop only), and no code uses them (`git grep` for `LanguageModel|Summarizer|Translator|LanguageDetector|window.ai` finds nothing).
- Lean: n/a. (prompt-api.md and language-model.md are the same file content.)

## Triage: wasm

### cpp-on-the-web
- Asks: Emscripten flags for C/C++ to WebAssembly.
- Applies here: no — we compile no C/C++; `git grep` finds no `.wasm` or `WebAssembly` in app code. (CSP note: `script-src 'self'` would need `'wasm-unsafe-eval'` if a wasm module ever loads; `content-security-policy.md` already mentions the p5 WASM case.)
- Lean: n/a.

## Triage: webmcp

### webmcp, agentic-forms, agentic-javascript-tools
- Asks: Expose page functions and forms as tools to browser agents with `document.modelContext.registerTool()` or `toolname` attributes on forms. Chromium 146 flag-only early preview.
- Applies here: no — no use today; it is flag-gated, Chrome-only, and absent from Safari and the iOS WebView. Our agents reach the box through `bbx` and an HTTP API, not through the page. A possible future fit is beebox-clerk or box views exposing tools, but there is no demand and the API is unstable.
- Lean: n/a.
