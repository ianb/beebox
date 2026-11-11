# Audit: category `forms`

## Slice summary

- 19 guides read. `forms/forms.md` is split into 11 topic entries below.
- Real findings: ime-safe-enter-submit (4 of 4 flagged sites are real, 0 further missed), forms/labeling-state (3 groups), forms/autofill-hints (login email autocomplete, 7 identifier fields), forms/identity-security (no show-password toggle), brand-consistent-forms (CheckboxField and RadioGroup lack accent-color), forms/validation (1 minor).
- Already adopted: IME helper `beebox/src/frontend/src/lib/ime.ts` (checks `isComposing` and `keyCode === 229`), used in 5 handlers. `field-sizing: content` on the chat composer (decided in `beebox/docs/implemented-plans/small-dependency-sweep.md:31`).
- No static footprint in our code: payment, address, OTP, sliders, custom/base-select pickers, multi-page forms, analytics, `:autofill` styling.
- Most valuable fixes:
  1. IME: add the existing `isComposing` helper to the 4 Enter handlers (about 4 lines). An ESLint rule can hold the line.
  2. `FieldShell`/`RadioGroup`: link helper and error text to the control with `aria-describedby` (one primitive, every form benefits).
  3. Login/Setup email `autoComplete="username"`, a show-password toggle on `TextField type="password"`, and `accent-primary` on the checkbox/radio primitives.
- Safari 17.0 floor: the select guides (`base-select`, Safari 27) and `<input switch>` (Chrome unsupported) do not fit. `field-sizing` (Safari 26.2) is already adopted with a documented no-grow fallback.

---

## forms.md, split by topic

### forms/structure
- Asks: Wrap controls in `<form>` with `type="button"` on helper buttons, `<fieldset>`/`<legend>` for groups, `<search>` for search, `name` on controls, no div/span controls, no auto-submit on select change.
- Applies here: partly — 14 `<form>` elements cover the real forms; the other inputs are standalone by design.
- Findings: 6 candidate sites; 1 real.
  - `beebox/src/frontend/src/components/admin/AllowedEmailsSection.tsx:191` `onKeyDown={(event) => { if (event.key === "Enter") {` — real (an input outside a `<form>` with hand-rolled Enter submit; a `<form onSubmit>` would give native Enter handling, native IME safety and remove the handler; same at `GmailFiltersSection/views.tsx:64`)
  - `beebox/src/frontend/src/components/ui/Button.tsx:235` `type = "button",` — not real (default is `button`; no raw `<button>` sits inside any of the 14 forms, checked)
  - `beebox/src/frontend/src/components/ui/fields/radio.tsx:60` `role="radiogroup"` with `aria-labelledby` — not real (equivalent to fieldset/legend for assistive tech; deliberate)
  - `beebox/src/frontend/src/components/ui/Toggle.tsx:39` `role="switch"` on a `<button>` — not real (native-semantics button; see forms/switch)
  - `workstreams-app/src/frontend/components/IssuesPane/IssueControls.tsx:73` `<select ... onChange={(event) => choose(event.target.value)}` — not real (guide's "no auto-submit" targets page forms; this is an immediate-apply dashboard control)
  - `TextField` passes no `name` — not real (ids are stable `bbx-*`, which is what password managers need)
- Our guidance: agrees — `beebox/frontend.md:158` "A toggle or disclosure keeps one name in both states and exposes the state"; `Toggle.tsx` comment: "iOS-style pill switch for immediate-apply settings".
- Fix size: 2 files (AllowedEmailsSection, GmailFiltersSection/views.tsx) wrap the input+Add button in `<form onSubmit>` and drop the `onKeyDown`. Low risk. Verify with a DOM test and a browse pass pressing Enter.
- Lint-able: no (judgment on what counts as a form).
- Browser: `<form>`, `<search>` Baseline widely (Safari 17.0 has `<search>`).
- Lean: adopt with changes — only the two Enter-handler sites; leave the rest.

### forms/labeling-state
- Asks: Associate every control with a visible `<label>`; link help and error text with `aria-describedby`; set `aria-invalid`; do not rely on placeholder; mark required visually and with `required`; announce errors with a live region.
- Applies here: yes.
- Findings: 9 candidate sites; 4 real.
  - `beebox/src/frontend/src/components/ui/fields/shell.tsx:35` `export function FieldShell(...)` renders the helper `<div className="text-xs ...">` and the error `<div ... role="alert">` — real (no `aria-describedby` anywhere in `ui/fields/`; the only `aria-describedby` in the frontend is `MarkdownCardView/Composition.tsx:156`). The error is announced once by `role="alert"`; the helper text, and the error on return to the field, are never read with the control. `useId()` is already imported in `field.tsx`, so the ids exist.
  - `beebox/src/frontend/src/components/ui/fields/radio.tsx:73` `{error !== undefined ? (<div className="text-danger-dark text-sm mt-1" role="alert">` — real (same gap on the radiogroup)
  - `beebox/src/frontend/src/components/chat/InteractiveChat-composer/view.tsx:106` `<textarea id=... enterKeyHint="send" ... placeholder="Type a message..."` — real (no label or `aria-label`; the name comes from the placeholder; same at `InteractiveChat-mobile-row.tsx:42`; the enclosing `<section aria-label="Compose message">` names the region only)
  - `beebox/src/frontend/src/components/DebugLog.tsx:230` `<input id="bbx-debug-log-filter" type="text" ... placeholder="Filter..."` — real (placeholder is the only name; dev-only surface)
  - `beebox/src/frontend/src/components/admin/CloudflarePublishConnectionsSection/view.tsx:267` `<input id={`bbx-admin-cf-publish-revoke-ack-${connection.name}`} type="checkbox"` with the sentence in a sibling `<Text>` — real (checkbox has no label association)
  - `workstreams-app/src/frontend/components/QuickOpen.tsx:77` `<input className="quick-open-input" type="text" ... placeholder=...` — not real (the enclosing `role="dialog" aria-label="Open a file"` and Chrome-only dev tool; low value)
  - `beebox/src/frontend/src/components/Markdown/body.tsx:265` `<input type="checkbox" checked={done === true} disabled readOnly` — not real (rendered task-list marker in prose, read-only)
  - Required marker: `shell.tsx:42` `<span className="text-danger ml-0.5" aria-hidden="true">*</span>` plus native `required` — not real (matches the guide's pattern)
  - `html lang` — not checked beyond `index.html`; not real for this slice
- Our guidance: partly silent — `beebox/frontend.md:154-158` covers accessible names for controls, but `personal-vibe-check/preset/react-rules.ts:21` sets `ignoreElements: ["audio", "canvas", "embed", "input", "textarea", ...]` for `control-has-associated-label`, so a raw `<input>` or `<textarea>` with no name passes lint.
- Fix size: `FieldShell` plus `RadioGroup`, ~15 lines: give helper/error elements ids derived from `fieldId` and pass `aria-describedby` to the control (TextField, TextareaField, NumberField, CheckboxField, SelectField, radio group). Medium-low risk; unit-test the rendered attributes; DOM tests that snapshot markup will change. Composer, DebugLog and Cloudflare checkbox: add `aria-label` or a `<label>`, 3 files.
- Lint-able: eslint — a rule requiring `aria-label`, `aria-labelledby` or an associated `<label>` on a raw `<input>`/`<textarea>` (hidden/file/checkbox in a wrapping label exempt). Removing `input`/`textarea` from `ignoreElements` is a lint-weakening-direction change (stricter), but `label-has-associated-control` semantic needs a custom rule since components use `htmlFor` indirectly. The `aria-describedby` linkage itself is a primitive change with no static footprint.
- Browser: ARIA attributes Baseline widely; Safari 17.0 ok.
- Lean: adopt — the `aria-describedby` linkage in `FieldShell`/`RadioGroup` is the highest-value item in this category.

### forms/autofill-hints
- Asks: Use `autocomplete`, `inputmode`, `enterkeyhint`; turn off autocorrect/autocapitalize/spellcheck on identifier fields; avoid `type="number"` for codes; do not split single values across boxes.
- Applies here: partly.
- Findings: 12 candidate sites; 9 real.
  - `beebox/src/frontend/src/pages/login/components/LoginFields.tsx:24` `<TextField id="bbx-login-email" label="Email" type="email" autoComplete="email" required` — real (the sign-in guide says use `username` for the sign-in email so password managers pair it with the password field)
  - `beebox/src/frontend/src/pages/login/SetupPage.tsx:168` `<TextField id="bbx-setup-email" label="Email" type="email" required value={email} onChange={onEmail} autoComplete="email" />` — real (same, sign-up guide also says `username`)
  - `beebox/src/frontend/src/components/admin/CloudflarePublishConnectionsSection/SharedPublicationHost.tsx:66` `<TextField id="bbx-admin-publish-shared-hostname" label="Hostname" ... required maxLength={253}` — real (identifier, no `spellCheck={false} autoCapitalize="none" autoCorrect="off"`)
  - `.../CloudflarePublishConnectionsSection/view.tsx:180` Connection name (`pattern="[a-z][a-z0-9-]{0,39}"`) — real (same)
  - `.../CloudflarePublishConnectionsSection/view.tsx:181` Cloudflare account ID — real (same)
  - `beebox/src/frontend/src/components/settings/DriveSection/DriveMountForms.tsx:60` Drive folder URL (no `type="url"`) and `:68` Box directory — real (2 sites)
  - `beebox/src/frontend/src/components/admin/SecretsSection/forms.tsx:103` secret Name `placeholder="e.g. weatherapi"` — real (identifier)
  - `beebox/src/frontend/src/components/admin/EncryptedBackupsSection.tsx:94` `autoComplete="url"` on a Repository (S3/SFTP destination) — not real as a gap (set; `autoComplete="url"` is acceptable)
  - Already correct: `ClaudeCodeSection.tsx:73-74`, `EncryptedBackupsSection.tsx:105-107`, `OpenRouterModelsSection/view.tsx:133-134`, `SecretsSection/forms.tsx:138-140`, `CloudflarePublishConnectionsSection/view.tsx:182` set `autoComplete="off" spellCheck={false} autoCapitalize=...` — not real
  - `inputMode`: 0 uses in the frontend; the only numeric field is `NumberField` (`field.tsx:162` `type="number"`, used for calendar settings `CalendarSection.tsx:138,147`) — not real (a countable quantity, not a code)
  - `enterKeyHint`: used on the composer only (`InteractiveChat-composer/view.tsx:110` `enterKeyHint="send"`; mobile row `:54` `enterKeyHint="enter"`) — not real
  - OTP or split-digit inputs: none — not real
- Our guidance: silent.
- Fix size: Login/Setup: 2 one-word edits, with a browse check on the password-manager prompt. Identifier fields: ~7 `TextField` call sites gain three attributes, or `TextField` gains an `identifier` boolean that sets them (one new prop, so check `restrict-component-classes`-style lint is unaffected). Admin and Settings pages are reached from the iOS app.
- Lint-able: baselined scan (needs judgment on which fields are identifiers); the `username` rule on type=email inside a form with a password field is deterministic but narrow.
- Browser: `autocomplete`, `inputmode`, `enterkeyhint` Baseline widely. `autocorrect`: guide says Baseline newly (2026-09-11); Safari 14.1 and iOS 14.5 support it; Chrome only from 153. Safari 17.0 ok; Chrome ignores it harmlessly (spellcheck and autocapitalize cover Chrome). React type name is `autoCorrect`.
- Lean: adopt with changes — do the login `username` change and the identifier attributes; skip the rest.

### forms/validation
- Asks: Use native constraints, `:user-invalid` not `:invalid`, validate on blur and clear on input, focus the first invalid field on submit, never disable submit to block validation.
- Applies here: partly — the app drives errors through the `error` prop on its field primitives, not through CSS pseudo-classes.
- Findings: 5 candidate sites; 1 real.
  - `beebox/src/frontend/src/components/settings/PasswordSection.tsx:55` `document.querySelector<HTMLInputElement>(`#${first}`)?.focus();` — not real (this is the guide's "route focus to first invalid on submit")
  - `beebox/src/frontend/src/components/admin/InviteSection.tsx:81` `onBlur={() => { if (!openInvite && email.length > 0 && !email.includes("@")) setEmailError(...)` — not real (validates on blur, clears at `:70`)
  - `PasswordSection.tsx:90-92` `onChange={setCurrentPassword}` etc. — real, minor (`errors` set at `:53` are not cleared when the person edits the field, so a stale "Passwords do not match." stays until the next submit)
  - `beebox/src/frontend/src/components/ui/fields/shell.tsx:10` `INPUT_BASE` has no `:user-invalid` styling — not real (no native-validation CSS path is used; adding one would give a second error style next to the `error` prop)
  - `Button ... disabled={!ready}` at `DriveMountForms.tsx:80` — not real (submit disabled until fields are filled; guide discourages this, but it is a single admin form and changing it adds an error path)
- Our guidance: silent.
- Fix size: PasswordSection: clear the matching key in each `onChange`, ~3 lines. Test with a DOM test.
- Lint-able: no.
- Browser: `:user-invalid` Baseline widely (Safari 16.5); not recommended here anyway.
- Lean: reject the CSS approach (no `:user-invalid`); adopt the clear-on-input tweak only if PasswordSection is touched.

### forms/responsive-typography
- Asks: 16px minimum font on controls (prevents iOS zoom), 48px tap targets, rem units, logical properties.
- Applies here: partly (the iOS app uses a WKWebView where the zoom matters).
- Findings: 4 candidate sites; 1 unverified.
  - `beebox/src/frontend/src/components/ui/fields/shell.tsx:10` `INPUT_BASE = "w-full border rounded px-3 py-2 bg-white text-warm-900 ..."` — not real (sets no text size, inherits the page size; not measured here)
  - `beebox/src/frontend/src/components/chat/InteractiveChat-helpers.ts:109` `const sizeClass = mobile ? "text-base min-h-[2lh]" : "text-sm min-w-0 min-h-[1lh]";` — not real (phone composer is 16px, `text-sm` is for the desktop row only)
  - `beebox/src/frontend/src/components/admin/ClaudeCodeSection.tsx:68` `className="flex-1 border border-warm-300 rounded px-2 py-1 text-sm font-mono"` — real, minor (14px input on an admin page the iOS app can open triggers zoom on focus); other `text-sm`/`text-xs` raw inputs: DebugLog `:236`
  - Logical properties: 0 uses; app is LTR-only — not real
- Our guidance: `beebox/frontend.md` is silent on input size; iOS tap-target size is covered under `ios-app/AGENTS.md` (not read for this slice).
- Fix size: raise 2 raw inputs to 16px on small screens (`text-base sm:text-sm`). Verify at phone width with `bin/browse`.
- Lint-able: baselined scan (a class scan for `text-xs`/`text-sm` on `<input>`).
- Browser: Baseline widely.
- Lean: adopt with changes — only the zoom fix on ClaudeCodeSection if the admin page is reached on a phone; reject the rest.

### forms/styling-controls
- Asks: `accent-color` for native checkbox/radio, visible `:focus-visible`, adequate border contrast, canonical visually-hidden recipe.
- Applies here: yes.
- Findings: 6 candidate sites; 2 real (see also brand-consistent-forms).
  - `beebox/src/frontend/src/components/ui/fields/field.tsx:225` `className="rounded border-warm-400 text-primary focus:ring-accent disabled:cursor-not-allowed"` on the checkbox — real (these classes belong to `@tailwindcss/forms`, which is not installed: `beebox/src/frontend/package.json:44` lists only `@tailwindcss/typography`, `tailwind.config.js:155` `plugins: [typography]`; so they style nothing and the checkbox renders in the browser default blue)
  - `radio.tsx:112` `className="text-primary focus:ring-accent"` — real (same)
  - `radio.tsx:144` `className="sr-only"` input in `RadioCards` — not real (Tailwind `sr-only` is the canonical recipe; focus ring is drawn on the card? card label has no `focus-within` style — checked: `baseClass` has none; keyboard focus on a radio card is invisible) — real, minor (visible focus missing on `RadioCards`)
  - `shell.tsx:10` `focus:outline-none focus:ring-2 focus:ring-accent focus:border-warm-900` — not real (replacement indicator present; guide allows)
  - `Toggle.tsx:31` button with no focus style — not real (relies on the global button focus-visible style; not measured)
  - `beebox/src/frontend/src/themes/card-themes.css:274` `.bbx-card-theme input[type="checkbox"] { accent-color: var(--bbx-pen); }` — not real (themed cards already do it)
- Our guidance: silent on checkbox colour. `beebox/src/frontend/src/components/ui/fields/shell.tsx:5-9` comment documents the field/ink/border contrast choice.
- Fix size: see brand-consistent-forms; add `focus-within:ring-2 focus-within:ring-accent` to the `RadioCards` label (1 line).
- Lint-able: baselined scan.
- Browser: `accent-color` Safari 15.4; the guide's table lists 26.2 for full support (WebKit bug on checkmark contrast). Safari 17.0 ok for the colour tint; check contrast of the checkmark in Safari.
- Lean: adopt with changes — focus-within on radio cards; accent colour via brand-consistent-forms.

### forms/js-ajax
- Asks: `isComposing` on Enter, `preventDefault` on AJAX submit, status via `role="status"`, `aria-expanded`/`aria-controls` on reveals.
- Applies here: yes.
- Findings: see `ime-safe-enter-submit` for Enter handlers (4 real). Others:
  - `beebox/src/frontend/src/components/settings/PasswordSection.tsx:82` `{message ? <div role="status">...` — not real (correct)
  - `beebox/src/frontend/src/components/box-screen/NewThoughtInput.tsx:60` `<p role="status" className="text-sm text-warm-700 empty:hidden">{status}</p>` — not real (correct)
  - All 14 `<form onSubmit>` handlers call `event.preventDefault()` — not real
  - A server-side fallback when JS fails — not real (SPA; no no-JS path exists or is wanted)
- Our guidance: silent on IME in `beebox/frontend.md`, `beebox/code-style.md`, `personal-vibe-check/conventions.md`, `beebox/box-docs/views.md`; the practice lives only in `lib/ime.ts` and its test `beebox/src/frontend/test/lib/ime.test.ts`.
- Fix size: n/a beyond IME.
- Lint-able: see ime-safe-enter-submit.
- Browser: n/a.
- Lean: adopt (IME portion only).

### forms/identity-security
- Asks: `current-password`/`new-password`, allow paste, show-password toggle with `aria-pressed`, CSRF, sanitizing, spam protection.
- Applies here: partly — login, setup, change-password forms exist; no payment, no open public forms.
- Findings: 6 candidate sites; 2 real.
  - `beebox/src/frontend/src/pages/login/components/LoginFields.tsx:29` `autoComplete="current-password"` — not real (correct); `SetupPage.tsx:177,186` `autoComplete="new-password"` and `PasswordSection.tsx:90-92` — not real (correct)
  - Paste blocked: `git grep onPaste` in login/settings pages — 0 sites on password fields — not real
  - `LoginFields.tsx:26-33` password `TextField` with no show/hide button — real (no show-password toggle on login, setup or change-password; `grep -i "show password"` finds nothing)
  - `SetupPage.tsx:183` "Confirm password" second field — real, low (the sign-up guide says do not double up inputs; first-run setup only; a show-password toggle would replace it)
  - `beebox/src/frontend/src/components/admin/EncryptedBackupsSection.tsx:104` `label="Recovery password"` `type="text"` — not real (deliberately visible so it can be written down; masked-by-default is not wanted)
  - Hidden `username` field on the change-password form (`PasswordSection.tsx:84`) so a password manager updates the right entry — real, low
- Our guidance: agrees on toggles — `beebox/frontend.md:158` "`aria-pressed` on a toggle button".
- Fix size: `TextField` with `type="password"` gains an optional reveal button (`type="button"`, `aria-pressed`, name "Show password", `aria-label` constant per frontend.md:158); 1 file (`field.tsx`) plus tests. Medium-low. Verify with browse on the login page at phone width.
- Lint-able: no.
- Browser: Baseline widely.
- Lean: adopt with changes — reveal toggle on the primitive; skip the second-field and hidden-username items.

### forms/address
- Asks: single name field, `street-address` textarea, `address-line1/2` tokens.
- Applies here: no — no address or name-split forms (`SetupPage.tsx:167` already has one `Name` field with `autoComplete="name"`).
- Lean: n/a.

### forms/analytics
- Asks: test with real devices and users, track funnels and discrete events without sensitive data in labels.
- Applies here: no — internal app, no analytics SDK in the frontend.
- Lean: n/a.

### forms/multi-page
- Asks: progress indication, back/forward without losing data, focus the new step heading, inert inactive steps.
- Applies here: no — no multi-step wizard (`QuestionForm` is single-page; setup is one form).
- Lean: n/a.

---

## ime-safe-enter-submit

### ime-safe-enter-submit
- Asks: Any custom `keydown` handler that acts on `Enter` (textarea or input) must skip while an IME composition is active (`event.isComposing`, plus `keyCode === 229` for Safari).
- Applies here: yes.
- Findings: 5 candidate Enter handlers on text controls in unprotected form; 4 real, 1 not.
  - `beebox/src/frontend/src/components/admin/AllowedEmailsSection.tsx:192` `if (event.key === "Enter") {` then `event.preventDefault(); void addEmail();` — real (adds an email to the allowed list mid-composition; `type="email"` makes IME input rare, but the handler is the same shape)
  - `beebox/src/frontend/src/components/admin/GmailFiltersSection/views.tsx:65` `if (e.key === "Enter") {` then `e.preventDefault(); onAdd();` — real (label names can be non-Latin)
  - `workstreams-app/src/frontend/components/IssuesPane/IssueControls.tsx:90` `if (event.key === "Enter") { event.preventDefault(); submit(event.currentTarget.value); }` — real; line 91 `if (event.key === "Escape") { event.preventDefault(); setDraft(null); }` has the same exposure (Escape cancels a composition and would also close the editor)
  - `workstreams-app/src/frontend/components/QuickOpen.tsx:81` `if (event.key === "Enter" && matches[0]) choose(matches[0].relPath);` — real (path search input; file names can be CJK)
  - `beebox/src/frontend/src/components/Markdown/Redacted.tsx:67` `if (e.key === "Enter" || e.key === " ") {` — not real (handler is on a `role="button"` span, not a text control)
  - Already protected via `isComposing` from `lib/ime.ts`: `NewThoughtInput.tsx:48`, `chat/everywhere/InteractiveChat/actions.ts:225` (the composer's `handleKeyDown`), `search/QuickSearchOverlay.tsx:46` (early return covers Enter at `:49`), `AppNav/PlacePill-landmarks.tsx:44` (covers Enter at `:51`) and `:137`.
  - Missed by the scanner: none. Complete search for `key === "Enter"`, `keyCode`, `onKeyPress`, `onKeyUp`, and `keydown` listeners across `beebox/src`, `beebox-clerk`, `workstreams-app/src` (excluding tests) finds exactly these Enter handlers; `beebox-clerk` has no keyboard handlers. `beebox/src/schemas`, `beebox/src/plugins` and `beebox/box-docs/views.md` have no Enter handling and the docs do not mention IME.
- Our guidance: silent in docs (`beebox/frontend.md`, `beebox/code-style.md`, `beebox/box-docs/views.md`); the helper's doc comment `lib/ime.ts:1-7` states the rule. Our helper already includes the Safari `keyCode === 229` fallback that the guide recommends (Strategy 1).
- Fix size: 2 beebox files import `isComposing` from `../../lib/ime` (`AllowedEmailsSection` at `components/admin/`, `GmailFiltersSection/views.tsx` one level deeper) and gate the branch: `if (event.key === "Enter" && !isComposing(event.nativeEvent))`. Alternative for the two admin inputs: wrap in a `<form onSubmit>` (see forms/structure), which needs no check. 2 workstreams-app files need the same helper: `workstreams-app` already imports types from `beebox/src/...` (`DocumentLifecyclePills.tsx:1`), so a runtime import of `../../../../beebox/src/frontend/src/lib/ime.js` is possible, or a local 3-line copy. Chrome-only there, where `isComposing` alone is enough, so a local `event.nativeEvent.isComposing` check also works. Risk very low. Verify: extend `beebox/src/frontend/test/lib/ime.test.ts`-style DOM tests with a composing Enter (`new KeyboardEvent("keydown", { key: "Enter", isComposing: true })`) and assert no submit.
- Lint-able: eslint — a custom rule in `personal-vibe-check/rules/` (currently only `restrict-component-classes.ts`): within a function passed to `onKeyDown` or to `addEventListener("keydown")`, if the body compares `.key === "Enter"` and does not call `isComposing(...)` or read `.isComposing`, report. Exempt handlers on elements with a `role` of button/link/option (the `Redacted` case) or on non-text elements; the rule cannot see which element a `TextField` renders, so a short allow-list or a disable comment with justification handles the residue.
- Browser: `isComposing` is Chrome 56, Firefox 31, Safari supports it too but with the WebKit event-order bug; our helper's `keyCode === 229` covers Safari 17.0. Guide labels Safari "Unsupported" in its table; our helper covers it either way.
- Lean: adopt — four one-line edits plus an optional lint rule.

---

## Autofill guides

### autofill-address-form
- Asks: Address form with `autocomplete` tokens (`address-line1`, `postal-code`), single name field, textarea for street address.
- Applies here: no — no address collection anywhere in the app or the stock views.
- Lean: n/a.

### autofill-highlight-inputs
- Asks: Restyle autofilled fields with `:autofill` (non-color indicator, keep focus outline).
- Applies here: no — no CSS overrides autofill styling (`git grep -n "autofill\|-webkit-autofill"` in the CSS and TSX finds none), and the default highlight is acceptable.
- Lean: n/a. (Browser note: `:autofill` Safari 15, Chrome 110, not Firefox.)

### autofill-payment-form
- Asks: Payment form with `cc-number`, `cc-exp`, `cc-csc`, billing/shipping tokens.
- Applies here: no — no payment forms.
- Lean: n/a.

### autofill-sign-in-form
- Asks: Sign-in form in its own `<form>` with `type="email"`, `autocomplete="username"` for the email, `current-password`, `required`, paste allowed, labelled submit button, sign-in fields at the top of the page.
- Applies here: yes — `beebox/src/frontend/src/pages/login/LoginPage.tsx:99` has the form.
- Findings: 6 candidate sites; 1 real.
  - `LoginFields.tsx:24` `autoComplete="email"` — real (guide says `username`; see forms/autofill-hints)
  - `LoginFields.tsx:29` `autoComplete="current-password"`, `required`, `type="email"`, `<form onSubmit>` at `LoginPage.tsx:99`, submit label `Sign in` (`LoginFields.tsx:36`) — not real (all correct)
  - No paste blocking — not real
  - No show-password toggle — see forms/identity-security
  - No `spellCheck={false}` on the email field — not real (the guide notes `autocorrect`/`autocapitalize` are off for `type="email"` anyway)
  - Google sign-in button alongside the form (`LoginPage.tsx:116`) — not real (matches the guide's federated-login advice)
- Our guidance: silent.
- Fix size: 1 word in `LoginFields.tsx`, plus `SetupPage.tsx:168`. Verify by autofilling in Chrome and Safari.
- Lint-able: baselined scan.
- Browser: Baseline widely.
- Lean: adopt with changes — the `username` token only.

### autofill-sign-up-form
- Asks: Same as sign-in, plus `new-password`, a single name field, a show-password toggle, no doubled inputs.
- Applies here: yes — `SetupPage.tsx` (first-run claim).
- Findings: 4 candidate sites; 2 real.
  - `SetupPage.tsx:168` `autoComplete="email"` — real (`username`)
  - `SetupPage.tsx:183` `<TextField id="bbx-setup-confirm-password" label="Confirm password"` — real, low (doubling; deliberate for a one-time first-run, and `new-password` suggestions fill both)
  - `SetupPage.tsx:167,177,186` `autoComplete="name"` and `"new-password"`, `minLength={8}`, `required` — not real (correct)
  - Submit label `Create account` (`SetupPage.tsx:194`) — not real (correct)
- Our guidance: silent.
- Fix size: 1 word; the confirm-field removal is a product choice.
- Lint-able: no.
- Browser: Baseline widely.
- Lean: adopt with changes — `username` token only.

## Select guides

### animated-select-picker
- Asks: Animate the `appearance: base-select` picker with `@starting-style` and `allow-discrete`.
- Applies here: no — no `base-select` usage and no custom picker; the app uses native `<select>` via `SelectField` (`field.tsx:291`) and `[color-scheme:light]` in `shell.tsx:10`.
- Browser: Chrome 135, Safari 27, no Firefox; Safari 17.0 does not support it.
- Lean: n/a.

### branded-select-styling
- Asks: Style the select and its picker with `appearance: base-select`, `::picker(select)`, `::picker-icon`.
- Applies here: no — native `<select>` styled by `inputClasses` in `shell.tsx`; about 16 `<select>`/`SelectField` sites (list: `AgentEngineSection/view.tsx:146`, `GmailFiltersSection/view.tsx:177`, `SecretsSection/connect.tsx:53`, `SecretsSection/grant.tsx:71,79`, `SharedPublicationHost.tsx:65`, `CaptureOverlay/DeviceSettings.tsx:25,39`, `beebox-clerk/src/ui/popup-app/actions-panel.tsx:261`, 7 in workstreams-app) all use plain options, so nothing needs a custom look.
- Browser: Safari 27 only; at the 17.0 floor the native picker shows (the guide's opt-in degrades to native). The two Chrome-only apps could adopt it with no fallback concern, with no gain.
- Lean: reject — no visual need, and it would add a Chrome-only style path next to the Safari native one.

### custom-select-picker-layouts
- Asks: Grid/flex layout inside the `base-select` picker for swatch or emoji pickers.
- Applies here: no — the one visual picker is `beebox/src/frontend/src/components/themes/ThemedFileCard/ThemeSwatchPicker.tsx`, a `role="group"` of swatch buttons, not a `<select>`; swapping it would need Safari 27.
- Lean: reject.

### rich-media-picker
- Asks: Rich HTML (icons, images) inside `<option>` with `base-select` and `<selectedcontent>`.
- Applies here: no — no select with rich options; `HistoryFilterBar.tsx:197` is a custom `aria-haspopup="listbox"` filter popover with checkboxes (multi-select), which a `<select>` cannot express.
- Browser: Safari 27; no fallback at 17.0.
- Lean: n/a.

### select-menu-interaction
- Asks: Required `<select>` with a disabled empty first option, error shown with `:user-invalid`, error linked via `aria-describedby`.
- Applies here: partly — `SelectField` supports `required` and `error` (`field.tsx:279-296`) but the error path is the `error` prop.
- Findings: 3 candidate sites; 0 real beyond forms/labeling-state (the missing `aria-describedby` on the error).
  - `beebox/src/frontend/src/components/admin/SecretsSection/grant.tsx:71` `<SelectField` — not real (valid options always preselected)
  - `field.tsx:295` `required={required}` — not real
  - `GmailFiltersSection/view.tsx:177` — not real
- Our guidance: silent.
- Fix size: none beyond the shared `aria-describedby` change.
- Lint-able: no.
- Browser: `:user-invalid` Safari 16.5.
- Lean: reject.

## Validation guides

### required-field-feedback
- Asks: Style required-empty fields only after interaction (`:user-invalid`), keep `aria-invalid` in sync from JS, give non-colour error cues.
- Applies here: partly — we use `required` natively and show errors through the `error` prop with `role="alert"` text (a non-colour cue), driven from React state.
- Findings: 4 candidate sites; 0 real.
  - `shell.tsx:42` `required ? <span ... aria-hidden="true">*</span>` — not real
  - `field.tsx:60` `aria-invalid={hasError ? true : undefined}` — not real (React state sets it with the error)
  - Native bubbles fire before our custom errors (no `noValidate` on any of the 14 forms) — not real (the browser's tooltip then the custom message; acceptable)
  - `INPUT_BASE` has `border-danger` on error — not real (error text beside it supplies the non-colour cue)
- Our guidance: silent.
- Fix size: none.
- Lint-able: no.
- Browser: Baseline widely (Safari 16.5).
- Lean: reject — the React-state path covers the same ground; a second `:user-invalid` path would give two error styles.

### validate-input-after-interaction
- Asks: Show errors after interaction via `:user-invalid`, optional `:user-valid`, password-rules list with pattern, error linked by `aria-describedby`.
- Applies here: partly — see required-field-feedback; the password rule in `SetupPage.tsx:174` is `minLength={8}`, not a complexity pattern.
- Findings: 3 candidate sites; 1 real (the shared `aria-describedby` gap in `FieldShell`) — see forms/labeling-state.
- Our guidance: silent.
- Fix size: covered by the `FieldShell` change.
- Lint-able: no.
- Browser: Safari 16.5.
- Lean: reject (as above); the `aria-describedby` part is adopted under forms/labeling-state.

## Other control guides

### brand-consistent-forms
- Asks: `accent-color` on native checkbox, radio, range, progress; pair with `color-scheme`; keep 3:1 contrast against the background.
- Applies here: yes.
- Findings: 6 candidate sites; 3 real.
  - `beebox/src/frontend/src/components/ui/fields/field.tsx:225` checkbox `className="rounded border-warm-400 text-primary focus:ring-accent ..."` — real (those are `@tailwindcss/forms` classes with no plugin installed; colour stays browser default). Add `accent-primary`.
  - `radio.tsx:112` `className="text-primary focus:ring-accent"` — real (same)
  - `radio.tsx:144` `RadioCards` uses `sr-only` radio and paints `border-primary bg-info-50` on the card — not real (card draws its own selected state)
  - `HistoryFilterBar.tsx:224` `className="accent-primary"`, `TodoItem.tsx:104` `accent-warm-500`, `Markdown/body.tsx:270` `accent-warm-500` — not real (already tinted)
  - `card-themes.css:274` `accent-color: var(--bbx-pen)` inside themed cards — not real
  - `CloudflarePublishConnectionsSection/view.tsx:267` raw checkbox, no tint — real (shares the labeling fix)
  - `<progress>`/`type="range"`: 0 uses — not real
- Our guidance: silent; `beebox/frontend.md:99` says field labels follow the card material, but nothing mentions control tint.
- Fix size: 2 primitives, 2 class edits (`accent-primary`); check checkmark contrast in Safari and on dark themes via `bin/theme-check`.
- Lint-able: baselined scan.
- Browser: `accent-color` Chrome 93, Firefox 92, Safari 26.2 per the guide table (Safari 15.4 supports the property but the guide cites a checkmark-contrast bug). At Safari 17.0 the tint applies; check the checkmark with `bin/browse`. No fallback needed (progressive enhancement).
- Lean: adopt — a two-class change that makes the control match the palette.

### form-fields-automatically-fit-contents
- Asks: `field-sizing: content` with min/max size on input, textarea and select; JS fallback where unsupported.
- Applies here: yes, already done for the composer.
- Findings: 4 candidate sites; 0 new real.
  - `beebox/src/frontend/src/components/chat/InteractiveChat-helpers.ts:113` `flex-1 resize-none box-content [field-sizing:content] max-h-[8lh] ...` — not real (adopted; replaced `react-textarea-autosize`)
  - No JS fallback for Safari before 26.2: the composer keeps its minimum height and scrolls — not real (decided in `beebox/docs/implemented-plans/small-dependency-sweep.md:31-33`: "On a browser without `field-sizing` (Safari before 26.2, older iOS web views), it stays at its minimum height and scrolls.")
  - `NewThoughtInput.tsx:41` `rows={2}` (via `TextareaField`), `QuestionForm/view.tsx:145,248` `rows={2}` — not real (fixed small notes; growth would add little)
  - `scrollHeight` use for textareas: 0 (all `scrollHeight` hits are chat scroll code)
- Our guidance: agrees — recorded decision in the plan above.
- Fix size: none.
- Lint-able: no.
- Browser: Baseline newly (2026-06-16); Chrome 123, Firefox 152, Safari 26.2. Safari 17.0 to 26.1 lacks it; the documented fallback is a fixed-height scrolling box.
- Lean: n/a — already adopted; the iOS 17 no-grow case is a recorded boxholder decision.

### slider
- Asks: Native `<input type="range">` with custom track/thumb via pseudo-elements and `progress()`/`attr()` fill.
- Applies here: no — no range inputs in the frontend, stock views, clerk or workstreams-app.
- Lean: n/a.

### switch
- Asks: `<input type="checkbox" switch>` for on/off controls, with a polyfill where unsupported.
- Applies here: partly — `beebox/src/frontend/src/components/ui/Toggle.tsx:39` is a `<button role="switch" aria-checked>` for immediate-apply settings.
- Findings: 1 candidate; 0 real.
  - `Toggle.tsx:36-41` `<button id={id} type="button" role="switch" aria-checked={checked} aria-label={label} ...>` — not real (native button with correct switch semantics; no form submission is needed because it applies immediately)
- Our guidance: agrees — `Toggle.tsx:21` comment "distinct from CheckboxField, which is form-bound"; `beebox/frontend.md:158` "`aria-checked` on a switch".
- Fix size: none.
- Lint-able: no.
- Browser: `switch` attribute Safari 17.4 only; Chrome, Edge and Firefox do not support it, and the workstreams/clerk apps are Chrome-only. Safari 17.0 (floor) also lacks it. A polyfill would be needed everywhere.
- Lean: reject — the existing role="switch" button works on every client and needs no polyfill.

### sms-otp-form
- Asks: Single `<input autocomplete="one-time-code" inputmode="numeric">`, WebOTP, origin-bound SMS format.
- Applies here: no — no SMS or OTP flow (`git grep -i "one-time-code\|otp"` finds none in app code).
- Lean: n/a.
