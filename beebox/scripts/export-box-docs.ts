#!/usr/bin/env tsx
/**
 * Print the engine's reference docs as JSON on stdout, for the public
 * agent-docs corpus (`site/docs.ts`). Read-only: unlike `build-box-docs.ts`
 * this writes nothing to the package. The fingerprint is the same one
 * `ensurePackageDocs` stores in `box-docs/.hash`, so the site's input manifest
 * can fold it in.
 *
 * Output shape: `{ fingerprint, docs: [{ filename, readWhen, content }] }`,
 * index excluded — the site builds its own.
 */

import { docsFingerprint, engineDocEntries, engineDocs } from "../src/core/docs-gen/package-docs.js";

const entries = engineDocEntries();
const out = {
  fingerprint: docsFingerprint(engineDocs()),
  docs: entries.map((e) => ({ filename: e.doc.filename, readWhen: e.readWhen, content: e.doc.content })),
};
process.stdout.write(`${JSON.stringify(out)}\n`);
