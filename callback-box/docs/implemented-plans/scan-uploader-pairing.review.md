# Codex cross-model review — scan-uploader-pairing (2026-08-01)

Reviewer: OpenAI codex CLI (read-only repo access, high reasoning), against
the plan's first draft (which proposed an unauthenticated pairing-code
protocol modeled on mobile pairing). Verdict: "not implementation-ready —
overbuilds the first release and leaves two protocol blockers unresolved."

## Findings and dispositions

1. **Blocker — pair route can't be unauthenticated inside the scan scope.**
   The upload routes' nested plugin applies a scope-wide scan-auth hook
   (`routes/scan-upload.ts:264,280`); the rate-limit key itself calls
   `requireScanAuth` (`scan-upload.ts:88`); the scope also carries the
   non-annex 503 hook; the hub's scan gate accepts only the two bearer
   paths (`hub/scan-gate.ts:29`) and exempts only mobile redemption
   (`hub-server.ts:491`). An unauthenticated pair POST would 401 before
   its handler, and only an end-to-end hub→child test would catch it.
   **Disposition: MOOT** — the pairing protocol was dropped entirely
   (boxholder decision); the revised plan has zero server routes.

2. **Blocker — duplicate-name 409 burns the single-use code.** Mobile
   consumes the ticket before persisting the credential
   (`core/mobile/pairing.ts:118`); scan-token duplicate names surface later
   under the store lock (`core/scan/tokens.ts:123`), so the planned
   CLI retry-with-suffix would meet an already-consumed code.
   **Disposition: MOOT** — same reason.

3. **High — over-engineering: solves clipboard exposure before the real
   setup problem.** Suggested minimal v1: existing owner-only mint +
   settings surface + local `configure --token-stdin`.
   **Disposition: ADOPTED** — this is the revised plan's shape. The
   pairing protocol moved to NOT in scope with an explicit revisit
   trigger.

4. **High — server-controlled `boxSlug` becoming a local filesystem path
   without validation.** **Disposition: ADDRESSED at the root** — in the
   revised design no server response carries any path component; the
   token filename derives only from the locally parsed, locally validated
   slug (Track B direction + failure-modes row).

5. **High — "last uploaded" would be materially false**, since
   `TokenStore.verify` stamps `lastUsedAt` on every authenticated request
   (`core/token-store.ts:209`), including the empty verification `check`.
   **Disposition: ADOPTED** — the UI labels the column "last request";
   true last-upload tracking is NOT in scope with the server-change
   rationale.

6. **High — claimed config save/validation reuse does not exist.**
   `scan-uploader/src/config.ts` is a strict reader only (ENOENT is an
   error, unknown keys pass, no writer/serializer/atomic write); a naive
   re-serialize would drop unknown keys; the reader could not reject a
   `"FILL-ME-IN"` placeholder. **Disposition: ADOPTED** — the revised
   Track B designs the writer as net-new: raw-JSON in-place edit
   preserving unknown keys, atomic rename, post-write strict-read
   assertion, refusal on unparseable input, and no placeholder values
   ever written.

7. **Medium — filtered workspace install is not a credible stand-alone
   story**; suggested publishing or serving the built `.mjs` from the
   settings page. **Disposition: DECIDED AGAINST (scope)** — boxholder
   chose to keep clone + filtered install (2026-08-01); recorded in NOT
   in scope with the revisit trigger (a non-developer uploader machine).
   The smoke script remains the executable verification of the filter
   claim, now asserting `better-sqlite3` is not built.

8. **Medium — planned tests missed the hub/Fastify integration boundary
   and the UI clipboard failure** (`CompanionPairingSection.tsx:102` has
   no rejection handling; copying it would copy the gap).
   **Disposition: half MOOT, half ADOPTED** — the integration-boundary
   risk died with the server routes; the revised Track A adds explicit
   clipboard-rejection handling and a browse-pass verification step.

## Citation corrections it caught

- The prompt's `routes/scan-auth.ts` guess: the real file is
  `src/webapp/scan-auth.ts`.
- The draft's claim that `scan-upload.ts:226-298` establishes sibling
  mounting: the sibling-scope registration actually lives at
  `server-box-scope.ts:291`.

## Net effect on the plan

Tracks collapsed from four to three; all server-side work (new core
module, raw route, tRPC mutation, hub exemption, dedicated limiter)
deleted; the config writer promoted from "reused" to designed; two
honesty fixes (last-request labeling, clipboard failure) added.
