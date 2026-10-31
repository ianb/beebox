---
title: "Remove the command-line scan uploader; keep what Bee Box Desktop needs"
status: active
workstream: scan-uploader-removal
issues: []
---
# Remove the command-line scan uploader

Delete the stand-alone `scan-uploader/` client and the box surfaces that exist only for it. Bee Box Desktop stays as the only scan-upload client, so the server keeps everything that app calls.

**Issues addressed:** none closed. `issues/features/2026-10-07-mac-companion-app.md` stays open and is amended (it describes the removed script). Searched the open queue for `scan-uploader`: `issues/decisions/2026-10-05-target-specific-underserved-use-cases.md` mentions it in passing and needs no action.

Boxholder decision, 2026-10-30: *"Anything the mac app uses should stay, but I don't believe that admin interface is something it would use. Except maybe revokes or something, but not minting. The mac app pairing is the only active client, so only what is needed to support it."*

## Design

Small surface change. A person opening Settings → Scan uploaders today can mint a token and copy a setup command. After this change the section only lists the credentials on the box and revokes them. Situations:

- When a Mac is lost, or it was unpaired before it could revoke its credential, I want to revoke that credential, so it stops working. The list and Revoke button serve this. The Mac app already sends people there (`mac-app/Sources/BeeBoxMacCore/Uploads/UploadCoordinator.swift:367`: *"Revoke it in the box's Settings → Scan uploaders."*), so the heading keeps its name; installed 0.1.6 builds show that wording.
- When I want a new scanner connection, I use Preferences → Watched Folders on the Mac. Settings has no setup path. An empty list says so in one line.

## Smallest fix and budget

Smallest fix: delete the package and leave all box code. That leaves a Mint button whose setup command names a deleted script, so it does not satisfy the decision.

Chosen scope, one piece of work with four tracks. **BIG CHANGE** by line count: about 7,000 deleted lines, almost all from `scan-uploader/` (6,782 tracked lines). The boxholder directed removal of the whole package. Other source and test changes: about 400 lines. Authored docs: about 150 lines. The lockfile is generated.

## Stated preferences this plan trades against

- Boxholder wording above sets the boundary, and it outranks the earlier handoff's "remove the routes and tokens".
- `beebox/docs/plans/mac-app-shell.md:566` kept the script because *"it still serves machines without the app"*. The boxholder has reversed this: the Mac app is the only active client, and the script's install on the boxholder's Mac was deleted.
- Machines without the Mac app lose automated scan upload. Accepted by the decision.

## What already exists

- Mac wire use: `mac-app/Sources/BeeBoxMacCore/Scan/ScanWire.swift:62` *"api/scan/check"*, `:92` *"api/scan/files/\(hash)"*. Reuse unchanged.
- Mac credential use: `mac-app/Sources/BeeBoxMacCore/Uploads/ScanTokenClient.swift:41` *"scanTokens.create"*, `:52` *"scanTokens.revoke"*. Both stay. The app does not call `scanTokens.list`; the Settings list does.
- Mac identity headers: `ScanWire.swift:137-138` send `x-scan-contract` and `x-scan-client-build`. The box records them only for the health check being deleted.

## Prior art (external)

No decision depends on an external premise. Skipped.

## Ontology

No new nouns. "Scan token", "scan upload routes" and "contract" keep their code names. The provenance string `scan-upload/<token-name>` stays because existing cards hold it and `core/triage/duplicates.ts:186` reads it.

## Tracks / scope

**Track 1: package.** Delete `scan-uploader/` and `bin/scan-uploader`. Remove it from `pnpm-workspace.yaml:35`, `knip.ts:102`, `bin/test-roots.ts:40`, and `beebox/src/dev/doc-check/file-paths.ts:36`. Regenerate `pnpm-lock.yaml`.

**Track 2: box.**
- `ScanUploaderSection.tsx`: remove the mint form, token display and setup command. Keep the list and Revoke.
- `routers/health/checks/scan-uploaders.ts` and its test: delete. It cannot say a Mac is current: missing identity reads as healthy, and a sweep with no files sends no `check` (`ScanSweep.swift:90`).
- `core/scan/tokens.ts`: remove client identity reading, stamping and storage. Old `lastClient*` values in stored records are dropped by the zod object parse and are harmless. The Mac's `x-scan-*` headers are ignored, as any unknown header is.
- `routes/scan-upload/scan-auth.ts`: remove the owner browser-session path, which exists to exercise the routes by hand. A scan token is the only credential. Keep the test-only open-access construction if route tests need it.
- Settings row: show a failed revoke's error beside the row.
- Keep unchanged: scan routes, quarantine, promotion, `scan-gate.ts`, the router's auth exemption, `scanTokens.create/list/revoke`.
- Comments naming the deleted client change to the Mac app.

**Track 3: Mac app.** Remove `OldUploaderCheck`, the `oldUploaderWatching` problem and its tests: its only remedy is the deleted command. Fix comments naming deleted paths (`UploadTriggers.swift`, `ContractVersion.swift`, `FakeScanServer.swift`) and `mac-app/README.md`. No behavior change to uploads. A new release is not required for uploads to continue.

**Track 4: docs and guidance.**
- Root `AGENTS.md`: remove the uploader bullet; the Mac bullet names the contract.
- `scan-upload-contract.md`: one client, two spellings of the version, remove bundle-copy text and `X-Scan-Client-Built-At`. It absorbs the bump rule from `scan-uploader/AGENTS.md` if the contract doc lacks it.
- `docs/box/phone-photos.md`, `what-you-could-do.md`: use Bee Box Desktop's Watched Folders (osxphotos and token steps go).
- `src/schemas/capture-session.tsx:73`, `core/commands` provenance prose: "the Mac app" for new sessions; a `scan-upload/...` value on an old card means the same channel.
- `knowledge-audits.yaml`: `iphone-photos-album-setup` and `scan-session-provenance` match the new answers.
- `site/docs/capabilities/mac-app.md:86`, `mac-companion-app` issue. Implemented plans and generated data (`doc-graph`, `dev/`, `research/`) are history and stay, except where doc-check fails.

## Could this be simpler?

This plan is close to the simplest version that meets the decision. Removing Settings list and Revoke as well would leave stranded or lost-Mac credentials with no revocation path, and it was the one exception the boxholder allowed. The plan-review removed the health check and owner-session path, which an earlier draft kept.

## Subplans

None. The tracks fit one plan.

## Failure modes

| Failure | Handled | Person sees |
|---|---|---|
| A Mac keeps uploading during deploy | Routes, tokens and hub gate do not change | Nothing |
| Old tokens from the deleted install stay valid on production boxes | Not automatic: names are the boxholder's data, and a wrong revoke would stop a Mac | Listed in Settings; boxholder revokes |
| Mac revoke fails or is unpaired | Existing error text points to Settings, still present | Existing message |
| Old `built-at` in a token record | Ignored and dropped on next write | Nothing |
| A stale Mac build | No box signal after this change; a required-field change needs care per the contract | Nothing |
| Doc or lint path references a deleted file | `pnpm doc-check`, knip, typecheck | Failing check |

## Agent-flow / user-flow edge cases

Walked against code:
- Mac adds a folder: `addFolder` → `ensureScanToken` → `scanTokens.create` over device token → sweep → `check`/`PUT` → quarantine → promotion. No hop changes except removing the old-plist check.
- Box agent asked how to bring in album photos: reads `phone-photos.md`, explains the Mac app steps, and leaves them to the boxholder.
- A person looks for "mint" in Settings: the section's hint sends them to the Mac app.
- `/api/scan` called from an owner browser session now answers 401. No client depends on it.

## NOT in scope

- Scan import pipeline, `bbx scan-import`, `bbx upload`.
- Deleting or revoking any token on production; no migration, because no stored format becomes invalid.
- Renaming scan tokens, routes, `Settings → Scan uploaders`, or the provenance string.
- A Mac release. Upload behavior does not change.
- Rewriting history docs.

## Open design questions

None. The boundary is settled by the decision above.

## Knowledge audits

Run `iphone-photos-album-setup` and `scan-session-provenance` after the doc change: the guidance a box agent reads changes.

## What will hold this after it ships

`knip`, typecheck and doc-check catch references to deleted files. `test/webapp/routes/scan-upload.test.ts` and `mac-app/Tests/` keep the wire behavior covered. The contract's WIRE CONTRACT comments stay.

## Implementation order

1. Track 1, commit.
2. Track 2 with tests, commit.
3. Track 3 with `bin/apple-test`, commit.
4. Track 4, doc-check, knowledge audits, commit.
5. Cross-model diff review.

## Rollout shape

Merging to `main` deploys, so merging waits for the boxholder's yes. After deploy, boxholder revokes the two old tokens in Settings on the production boxes that hold them. The Mac app needs no action.
