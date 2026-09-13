# Bee Box

Bee Box is a personal assistant and operating system: agents process inputs, take actions, or ask questions. The filesystem is state, Git is history, and `bbx` is the command-line interface.

Work only on the requested problem. Do not expand scope into adjacent cleanup, policy, schemas, UI, or workflows without the boxholder's approval. Read the relevant code, schema, and tests before changing a format or contract.

Never copy private box content or personal operational details into tracked source, docs, tests, or public issues. Follow the monorepo root's `private-issues/` boundary, and ask when publication safety is uncertain.

## Development

The monorepo root instructions own worktrees, the shared dev router, browser evidence, issues, privacy, landing, and deployment effects. Within this package:

- Use `pnpm test:changed`; it selects the tests implicated by the diff. Run a named doctest with `pnpm exec tap test/<path>.doctest.md`. The hourly schedule runs the full `pnpm test` suite on `main`; do not run it in a worktree without a concrete reason.
- `pnpm typecheck` checks the backend and the separate frontend tsconfig. Run `pnpm lint:changed` during iteration; use full `pnpm lint` when changing broadly imported code. The pre-commit hook runs typecheck and lint.
- Doctests are the default test form. Read the [syntax](../agent-doctest/docs/syntax.md) before authoring one; the broader [testing guide](docs/testing.md) explains test tiers and helpers. A selected failure is part of this change to investigate; do not dismiss it as pre-existing without evidence.
- Do not weaken or disable lint rules to pass. A true narrow false positive may use one `eslint-disable-next-line <rule> -- <concrete justification>`; other rule, severity, option, or suppression changes require explicit permission.
- Finish coordinated edits before responding to intermediate lint output, then resolve diagnostics introduced by or relevant to the change. Warnings, deprecations, and other unsolicited noise are actionable; routine success output belongs behind debug.

When committing, use plain `git commit` so hooks run, fix relevant failures, and leave no half-finished task changes. Never use `--no-verify`.

Production runs bundled `dist/cli.mjs`, not tsx. Resolve package assets through `PACKAGE_ROOT` in `src/lib/package-root.ts`. Deployment topology and rollback are in [deploy/README.md](deploy/README.md).

## Cards

Cards use YAML frontmatter plus a Markdown body and are named `Name.<type>.card`; the filename determines the schema. Attachments use the sibling `Name.attach/` scope. Schemas live in `src/schemas/`, and boxes may add schemas through the public `beebox/cards` API. For format or attachment work, read the [card format](docs/cards-as-markdown.md); for schema changes, the [schema workflow](docs/adding-schemas.md); for changes to existing on-disk data, the [migration runbook](docs/migrations.md). The implemented RFC is design history, not the live manual.

Cards validate on load. When mutating existing card text, parse, change, and reserialize it; serialization follows schema field order and need not preserve the original frontmatter order. `bbx validate` and the hooks installed by `bbx init` provide broader validation; see [card validation](docs/card-validation.md). Do not infer a card shape from an example when its schema is available.

Box Git trailers such as `Created-By` are structured metadata. Box commits use plain `git commit` so the installed pre-commit hook can run staged validation, link warnings, and the unlisted-binary guard.

## Source Layout

Open the owner for the area being changed:

- Backend domain and orchestration: `src/core/`; reactor details: [reactor design](src/core/reactor/DESIGN.md).
- Generic dependency-light helpers: `src/lib/`; browser/server shared code: `src/shared/`; CLI-domain helpers: `src/cli/lib/`; ambient declarations only: `src/types/`. The dependency rules and exact distinctions are in the [module map](docs/module-map.md).
- HTTP and tRPC: `src/webapp/`; use the [API guide](docs/adding-api-endpoints.md). tRPC is the default, including WebSocket subscriptions; raw Fastify routes are reserved for transports or authentication distinctions that do not fit tRPC.
- React UI: `src/frontend/`; read [frontend.md](frontend.md) before UI work. It owns primitives, semantic colors, source tagging, and the enforced `className` boundary.
- External dependencies: `src/services/`; read [services guidance](src/services/CLAUDE.md). Connectors live in `src/connectors/`; read [connector guidance](src/connectors/CLAUDE.md).
- Hub routing: `src/hub/`; read [hub guidance](src/hub/CLAUDE.md). Tests mirror source paths under `test/` and use helpers in `test/helpers/`.
- Schemas, scenarios, developer tooling, deployment code, and validator plugins live in `src/schemas/`, `src/scenario/`, `src/dev/`, `deploy/`, and `plugins/` respectively.

Boxes live outside this repository. A box is one package and operational root with `shapeVersion: 3`; box code imports only public `beebox/{cards,schema,view-widgets}` specifiers, never engine internals. Read the [box layout](docs/box-layout.md) before changing its on-disk shape.

## Key Concepts

`bbx wakeup` preprocesses intake, runs housekeeping and wakeup scripts, syncs connectors, runs the reactor over pending jobs, finalizes outbound work, and pushes the box. Recurrence belongs to `bbx tick`; see the [scheduler](docs/scheduler.md). Services wrap external dependencies behind typed real and fake implementations. Connectors implement filesystem synchronization. Procedures are YAML-frontmatter workflows under a box's configuration; see the [procedure guide](docs/procedure-implementation.md).

## Behavioral Notes

- Follow [code-style.md](code-style.md). Preserve typed contracts and validate untrusted boundaries; do not add silent fallbacks for broken invariants.
- All box ref parsing and resolution goes through `parseRef` and `resolveRefPath` in `src/shared/ref-path.ts`. Never reproduce it with `path.resolve`, segment splitting, or manual fragment/query stripping. Resolution must fail closed when `..` escapes the box.
- Use `getBoxTime`/`getBoxTimeISO` for timestamps so frozen scenario time works. Long-running timeouts use `startAwakeTimeout`; ordinary wall-clock timers expire across macOS sleep.
- Cross-process locks go through `src/lib/file-lock.ts`; never call `proper-lockfile` directly or create ad hoc lock files. Follow the more specific Git and same-card locking contracts in [code-style.md](code-style.md).
- For frontend or iOS failures, inspect the box's `.beebox/client-debug.log`; `[ios]` identifies native entries. See the [client debug log](docs/client-debug-log.md).
- Never change credentials to unblock testing. Ask the boxholder at a login wall. `~/.bbx-auth.json` (or `BBX_AUTH_FILE`) is global across local boxes; `bbx auth set-password` revokes live sessions and cannot restore the old password. Mutating auth commands require `--agent-confirmed`, which means a human explicitly requested that credential change. Before writing any credential, token, or key, identify the actual store and scope. If a tool reports revocation, rotation, or invalidation, stop and verify what it affected.
- Keep shared source, prompts, schemas, rules, and docs generic. Use “the user” or “the boxholder”; personal names belong only where they are data. When an example needs names, use [the fictional roster](docs/example-names.md).

## Improving These Instructions

When a correction exposes missing durable guidance, put a short rule at the narrowest accurate owner: this file for package-wide constraints, a nested `CLAUDE.md` for an area, [code-style.md](code-style.md) or [frontend.md](frontend.md) for coding contracts, and `docs/` for conditional reference material. New infrastructure must have a discoverable current owner. Do not use historical plans as live manuals.

## Guides

Use the [topic index](docs/guides.md) to find a guide, and [docs/README.md](docs/README.md) for documentation organization and naming. Common entry points are [engineering principles](docs/engineering-principles.md), [testing](docs/testing.md), [cards](docs/cards-as-markdown.md), [API endpoints](docs/adding-api-endpoints.md), [box layout](docs/box-layout.md), [mobile contract](docs/mobile-contract.md), [secrets](docs/secrets.md), [server operations](docs/server-operations.md), and [deployment](deploy/README.md). Proposed work lives under `docs/plans/`; implemented plans and RFCs record history unless a current guide explicitly says otherwise.

@code-style.md
