/**
 * The pinned Docling release (D3) — the single source of truth for it.
 *
 * It lives alone in this file because two non-TypeScript readers need it and
 * must not carry their own copy: `deploy/setup-server.sh` (the model pre-fetch)
 * and `schedules/docling-update/run.ts` (the currency watch). Both parse this file
 * for the literal pattern `DOCLING_VERSION = "<version>"`, so keep the
 * declaration on one line and quoted.
 *
 * Why pinned at all: `uvx docling` unpinned resolves whatever is newest, so two
 * runs of the same document a month apart could differ in output *and* in which
 * flags exist — and extraction output is stored on a card, where that drift is
 * invisible until someone compares two cards.
 */

export const DOCLING_VERSION = "2.117.0";
