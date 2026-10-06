---
title: "Publication approval cards"
status: partial
workstream: publish-pages
issues: []
---
# Publication approval cards

When an agent prepares a publication, the boxholder should open that publication's card to review its candidate and control serving. The card is a stable reference to the publication; server-owned binding and serving state remain the authority.

**Issues addressed:** none; no matching open issue was found.

## Smallest fix and budget

The smallest fix is a new `publication` card type with required `pubId`, a trusted renderer that resolves the id through the existing publications API, and preparation that creates the reference card. Estimate: about 500 changed source lines and 350 test lines, plus about 100 authored documentation/plan lines; generated card docs are separate. This replaces duplicated approval controls with card navigation while preserving existing review actions and server checks.

## Stated preferences this plan trades against

The card schema adds a new vocabulary, so follow `beebox/docs/cards/schemas.md` and the additive-schema rule in `bbx-guide-schemas`. The Bee Box instruction to keep work scoped means publication definitions and serving authority stay unchanged. Existing user preference keeps host configuration Admin-owned and publication approval member-owned; this change preserves that boundary (`beebox/docs/security-report.md:179`).

## What already exists

- `beebox/src/publish/publication-definition.ts:14-50` (moved to `beebox/src/publish/prepare/definition.ts`) validates agent-owned build settings including `pubId`; reuse it without changing its JSON shape.
- `beebox/src/publish/managed-publication-queries.ts:19-57` returns publication rows keyed by server binding `pubId`; use that result for renderer state.
- `beebox/src/webapp/trpc/routers/publications.ts:35-41,78-99` enforces signed-in user-only approval, preview, enable, and disable. Preserve these procedures and their inputs.
- `beebox/src/frontend/src/pages/PublicationsPage.tsx:27-75` already renders candidate review and controls from server results; extract/reuse this UI in the trusted renderer.
- `beebox/src/frontend/src/lib/view-url.ts:149-160` serializes canonical card view targets. Use the existing card route and serializer.
- `beebox/src/core/card-io.ts:361-384` parses and serializes cards. Use schema-aware creation and fail closed on path collisions.

## Prior art (external)

No external premise is needed; this uses existing Bee Box cards, tRPC, and routing.

## Ontology

- **Publication definition** (existing): `src/publications/<name>/publication.json`, identified by `pubId`; specifies desired build/audience settings, not approval authority (`publication-definition.ts:14-50`).
- **Publication reference card** (new): `publication` card with `pubId`, located at `_content/publications/<pubId>.publication.card`; a movable, editable UI address, not permission state.
- **Publication binding** (existing): server-owned box+`pubId` association and Cloudflare destination; authority used by the API (`core/secrets/cloudflare-publish.ts`).
- **Serving manifest/candidate** (existing): remote R2 state keyed by `pubId`; holds approved and pending serving state (`publish/managed-publications.ts:93-120`).
- **Approval renderer** (new): built-in trusted React renderer for `publication` cards; joins card `pubId` to current server query output and calls existing user-gated procedures.

## Tracks / scope

### Reference card and preparation

**What.** Add the `publication` schema and template helper. `pubId` is the only publication-specific field; title/body remain ordinary card presentation. Preparation creates `_content/publications/<pubId>.publication.card` if absent and returns its box-relative path and canonical URL. An existing path may be reused only when it parses as a `publication` card with the same `pubId`; never overwrite a conflicting or edited card.

**Why this needs to change.** `publication.json` is a build definition, while `/publications` is currently a standalone interface. Neither gives each publication an addressable card surface.

**Direction.** Register the additive schema in `src/schemas/registry.ts` (moved to `beebox/src/schemas.ts`); validate `pubId` with the existing exported schema. Create and validate the ref immediately after resolving the validated definition, before binding reservation or any Cloudflare/R2 writes; if later publishing fails, the harmless address card can remain. Do not copy tier, audience, revision, hostname, connection, status, or permission into the card.

**Vocabulary lock-ins.** Type `publication`, required field `pubId`, card path `_content/publications/<pubId>.publication.card`, output `cardPath` and `approvalUrl`.

**First implementation chunk.** Add schema/registration/template plus an idempotent, collision-safe ensure helper. Add filesystem doctests for create, same-id reuse, mismatched card, and malformed existing file.

### Trusted card approval surface

**What.** Register a first-party renderer for `publication` cards. It queries `publications.list`, selects by `pubId`, and reuses the existing publication review and controls. The legacy `/publications` route remains a navigation-only list of card links, with an explicit ensure/open action when a server-known publication has no reference card.

**Why this needs to change.** A card address should be the review surface, while the approval decision remains server-validated.

**Direction.** Keep the existing user-only procedure gates and expected candidate revision. The renderer must show unavailable for invalid, cross-box, or unregistered ids; a stale candidate refreshes from the server. Aliases with the same `pubId` resolve to the same publication; no uniqueness enforcement is added.

**Vocabulary lock-ins.** Card contents are lookup identity and display text only. Existing publications with no ref card remain reachable from the compatibility list, whose explicit action asks the server to ensure a card.

**First implementation chunk.** Extract the current card controls, add the built-in renderer, wire canonical card URLs into preparation/list navigation, and retain the `/publications` route without duplicating its controls.

## Could this be simpler?

Leaving the standalone page unchanged and adding links to it from publication cards is simpler, but it makes the card a wrapper around the separate permission surface and keeps two addresses for the same task. A trusted card renderer reuses the existing server API controls and meets the user's requested card-centered workflow without moving authority into box-editable data.

## Subplans

None; card shape and authority boundary are settled above.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A card path exists with a different type or pubId | Filesystem and preflight doctests | Index treats it as unavailable; prepare refuses before remote writes and gives the exact path plus move/rename or restore-pubId repair guidance | Clear |
| A card id is not registered to this box | Existing binding check; add renderer/API coverage | Show unavailable; action endpoint fails closed | Clear |
| Candidate changes after review loads | Managed publication and renderer doctests | ExpectedRevision blocks stale actions; renderer refreshes the publication query and keeps the error visible so the member can review the latest candidate | Clear |
| Agent or open actor tries a permission action | Existing router doctest | User-only procedure rejects | Clear |
| Two aliases refer to one pubId | New renderer/list coverage | Both resolve to the same server row | Clear |

## Agent-flow / user-flow edge cases

- Wrong tag/field: addressed by a dedicated schema and agent instructions; renderer refuses absent/invalid `pubId`.
- Stale ref: addressed; path is an address, `pubId` is identity, and the renderer shows unavailable if binding is absent.
- Two agents touching one card: ensure uses create-only semantics and rechecks after an existing path; concurrent creation does not overwrite.
- Hand-edit drift: title/body may be edited; mismatched ids or type fail closed. No settings are read from this card.
- Fabricated free-form value: `pubId` is syntactically validated and still must resolve through a box-scoped server binding.
- Validation UX: schema errors identify the required `pubId`; collision error identifies the path.
- Partial transition: old publications without cards remain visible in `/publications` and offer explicit card creation/opening; no list-query write side effect.

## NOT in scope

- Changing `publication.json` or migrating existing definitions: it remains the build configuration.
- Moving approval, serving, destination, or access state to card frontmatter: cards are editable box data.
- Reassigning Cloudflare hostnames or changing Admin setup: existing publication security boundaries remain.
- Removing `/publications` immediately: CLI and existing links need a compatibility route during adoption.
- Giving custom box-authored view code publishing authority: the server continues to check for a signed-in member on every permission change, regardless of the renderer that initiated it.

## Open design questions

None. The card type, location, identity, and authority boundary were confirmed before implementation.

## Knowledge audits

Updated the existing direct publishing audit to cover publication-card lookup identity and server-owned approval. The filtered audit was attempted on 2026-09-26 but stopped before prompting because the isolated box guard found `node_modules/beebox/box-docs/README.md` crossing a symlink. The YAML records this honestly; no box-agent knowledge result is claimed.

## What will hold this after it ships

Schema and filesystem doctests cover frontmatter and collision safety; the managed-publications doctest covers explicit ensure, lookup identity, preflight rejection before remote writes, and user-only permission gates. Frontend doctests cover card rendering and stale-action refresh. `lint:changed`, package typecheck, targeted publication/CLI doctests, and `doc-check` pass. A `test:changed` attempt selected 277 unrelated doctests and was interrupted at test 56; it is not counted as verification. Browser inspection confirmed the review surface requires a signed-in member, but a populated signed-in approval session was not available.

## Implementation order

1. Add the schema and collision-safe reference-card creation; cover it with doctests.
2. Extract/reuse current publication controls in a trusted card renderer; retain the compatibility list as links plus explicit ensure/open action.
3. Update CLI preparation output and box publishing guidance to point at the direct card approval URL.
4. Update the existing knowledge audit, run selected checks, and request cross-model review. Cross-model review verified the card preflight, mismatch handling, stale-action refresh, and Cloudflare response-envelope fix.

## Rollout shape

No data migration is needed. New cards appear on preparation; existing publications can create one through an explicit action in the compatibility list. Implementation and review are complete. The targeted schema/service/CLI doctests, lint, typechecks, generated-doc check, and cross-model review pass. The focused knowledge audit and full populated-member browser flow remain unverified for the reasons recorded above.
