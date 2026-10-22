// # Template File Install
//
// `installTemplateFile` is the shared write-path for every template-managed file in a box (procedures, guides, schedules, briefing, root landmark, personality). It tracks the hash of the last template we cleanly wrote into `_config/template-versions.json` and uses that to decide whether a new template can safely overwrite the local copy.
//
// The four outcomes:
//
// - `fresh` — file didn't exist; write template, record hash
// - `unchanged` — local already matches the new template; no write
// - `overwritten` — local matches the previously recorded hash (user hasn't touched it since last install) → safe to overwrite
// - `parked` — local diverges from both the new template and the recorded hash → write the new template to `_config/_template-updates/<relpath>` for the user to review
//
// `pruneStaleTemplateUpdates` sweeps parked files older than 30 days (configurable) so the review pile doesn't accumulate cruft indefinitely.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { isoDate } from "@ianbicking/tap-check/check";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import {
  hasRecordedTemplateVersion,
  installTemplateFile,
  pruneStaleTemplateUpdates,
  listParkedTemplateUpdates,
  readVersions,
  type InstallTemplateOptions,
} from "../../src/core/install-template-file.js";

const REL = "_config/x.card";
const DAY = 24 * 60 * 60 * 1000;

async function makeBox() {
  return fs.mkdtemp(path.join(os.tmpdir(), "bbx-install-tpl-"));
}

// Write a file under the box, creating its directory.
async function put({ box, rel, content }: { box: string; rel: string; content: string }) {
  await fs.mkdir(path.dirname(path.join(box, rel)), { recursive: true });
  await fs.writeFile(path.join(box, rel), content);
}
const get = (box: string, rel: string) => fs.readFile(path.join(box, rel), "utf-8");
const exists = (target: string) => fs.access(target).then(() => true).catch(() => false);
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

// Install `templateContent` at `rel` (default `_config/x.card`).
const install = ({ box, templateContent, ...extra }: { box: string; templateContent: string } & Partial<Omit<InstallTemplateOptions, "boxRoot" | "templateContent">>) =>
  installTemplateFile({ boxRoot: box, relPath: extra.relPath ?? REL, templateContent, ...extra });

// A box whose x.card was installed as v1, edited by the user, then offered v2
// (so v2 is parked).
async function parkedBox() {
  const box = await makeBox();
  await install({ box, templateContent: "v1\n" });
  await put({ box, rel: REL, content: "user edit\n" });
  await install({ box, templateContent: "v2\n" });
  return box;
}

// Park a stale (40-day-old) mirror of `rel`; `target` also creates the on-disk copy it mirrors.
async function mirror({ box, rel, ageDays, target }: { box: string; rel: string; ageDays: number; target: boolean }) {
  const file = path.join(box, "_config/_template-updates", rel);
  await put({ box, rel: path.relative(box, file), content: "parked\n" });
  if (target) await put({ box, rel, content: "local\n" });
  const when = new Date(Date.now() - ageDays * DAY);
  await fs.utimes(file, when, when);
  return file;
}

// ## Fresh install
//
// A file that doesn't exist gets written and recorded:
void test("A file that doesn't exist gets written and recorded:", async (t) => {
  const box = await makeBox();
  const result = await install({ box, templateContent: "v1\n", relPath: "_config/calendar.guide.card" });
  t.check({ result, content: await get(box, "_config/calendar.guide.card"), recorded: Object.keys(await readVersions(box)) }, {
    result: { outcome: "fresh", writtenAt: "_config/calendar.guide.card" },
    content: `v1
`,
    recorded: [
      "_config/calendar.guide.card",
    ],
  });
});

// ## Unchanged and overwritten
//
// Re-running with the same template content is a no-op (`unchanged`). When the
// local file still matches the last recorded hash (the boxholder hasn't touched
// it since we installed it), a new template version pushes through cleanly
// (`overwritten`):
void test("Re-running with the same template content is a no-op (unchanged).", async (t) => {
  const box = await makeBox();
  await install({ box, templateContent: "v1\n" });
  const same = await install({ box, templateContent: "v1\n" });
  const next = await install({ box, templateContent: "v2\n" });
  t.check({ same, next, content: await get(box, REL) }, {
    same: { outcome: "unchanged" },
    next: { outcome: "overwritten", writtenAt: REL },
    content: `v2
`,
  });
});

// ## Parked — local has been edited; new template diverted to _template-updates/
//
// When the local file differs from the recorded hash, we don't overwrite — we park the new template for the user to review. The user's edit is preserved, and the new template sits in `_template-updates/` mirroring the original relpath verbatim, so the copy-back-to-accept path is obvious:
void test("When the local file differs from the recorded hash, we don't overwrite — we p...", async (t) => {
  const box = await makeBox();
  await install({ box, templateContent: "v1\n" });
  await put({ box, rel: REL, content: "user edit\n" });
  const result = await install({ box, templateContent: "v2\n" });
  t.check({ result, local: await get(box, REL), parked: await get(box, result.writtenAt ?? "") }, {
    result: { outcome: "parked", writtenAt: "_config/_template-updates/_config/x.card" },
    local: `user edit
`,
    parked: `v2
`,
  });

  // And the recorded hash is **not** updated (so if the user copies the parked version into place later, the next install can recognise it and overwrite cleanly):

  const entryBefore = (await readVersions(box))[REL];
  t.check(entryBefore, { sha256: sha("v1\n"), "installed-at": isoDate(), stock: "v1\n", pending: sha("v2\n") });

  await install({ box, templateContent: "v2\n" });
  t.check((await readVersions(box))[REL], entryBefore);
});

// ## Listing parked updates — the drift signal
//
// `listParkedTemplateUpdates` returns the original relpaths that currently have a
// parked update, so `bbx status` / `/healthz` can surface template drift. A clean box
// reports nothing; after the box diverges and a new template parks, the original
// relpath (not the mirrored `_template-updates/` path) is listed:
void test("listParkedTemplateUpdates returns the original relpaths that currently have a...", async (t) => {
  const box = await makeBox();
  await install({ box, templateContent: "v1\n" });
  const clean = await listParkedTemplateUpdates(box);
  await put({ box, rel: REL, content: "user edit\n" });
  await install({ box, templateContent: "v2\n" });
  t.check(({ clean, parked: await listParkedTemplateUpdates(box) }), {
    clean: [],
    parked: [
      "_config/x.card",
    ],
  });
});

// ## Bootstrap — pre-existing file with no recorded hash
//
// A box that was installed before the version tracker existed has files but no `template-versions.json` entry. If local matches the new template, we silently adopt the hash. If local doesn't match (could be user-edited or an old template version we can't recognise), we park — the conservative call:
void test("A box that was installed before the version tracker existed has files but no...", async (t) => {
  const box = await makeBox();
  await put({ box, rel: REL, content: "v1\n" });
  const matching = await install({ box, templateContent: "v1\n" });
  const adopted = (await readVersions(box))[REL];

  const other = await makeBox();
  await put({ box: other, rel: REL, content: "mystery content\n" });
  const mystery = await install({ box: other, templateContent: "v2\n" });
  t.check({ matching, adopted, mystery }, {
    matching: { outcome: "unchanged" },
    adopted: { sha256: sha("v1\n"), "installed-at": isoDate(), stock: "v1\n" },
    mystery: { outcome: "parked", writtenAt: "_config/_template-updates/_config/x.card" },
  });
});

// `priorStockHashes` names stock content shipped before this file was tracked, so
// a box still carrying it takes the update instead of parking — the case that
// otherwise leaves the longest-running boxes silently frozen on old templates. A
// hash that isn't listed still parks: the mechanism widens what counts as
// recognised stock, it doesn't stop protecting edited files.
void test("priorStockHashes names stock content shipped before this file was tracked, so...", async (t) => {
  const run = async (local: string) => {
    const box = await makeBox();
    await put({ box, rel: REL, content: local });
    const result = await install({ box, templateContent: "v2\n", priorStockHashes: [sha("old stock\n")] });
    return { result, local: await get(box, REL) };
  };
  t.check([await run("old stock\n"), await run("someone's edit\n")], [
    { result: { outcome: "overwritten", writtenAt: REL }, local: "v2\n" },
    { result: { outcome: "parked", writtenAt: "_config/_template-updates/_config/x.card" }, local: "someone's edit\n" },
  ]);
});

// `hasRecordedTemplateVersion` is how a caller scopes that allowlist to the
// bootstrap case. `installTemplateFile` accepts a prior-stock match whether or
// not a recorded hash exists — right for the guides, where a tracked box carrying
// a superseded version should still take the update, but wrong for a caller whose
// allowlist exists only for boxes that predate tracking. A box that took a clean
// install has a recorded version, so a caller that withholds the allowlist once a
// version is recorded parks a deliberate revert to old stock instead of stomping
// it:
void test("hasRecordedTemplateVersion is how a caller scopes that allowlist to the boots...", async (t) => {
  const box = await makeBox();
  await fs.mkdir(path.join(box, "_config"), { recursive: true });
  const before = await hasRecordedTemplateVersion(box, REL);
  await install({ box, templateContent: "v1\n" });
  const after = await hasRecordedTemplateVersion(box, REL);

  await put({ box, rel: REL, content: "old stock\n" });
  const tracked = await hasRecordedTemplateVersion(box, REL);
  const result = await install({ box, templateContent: "v2\n", ...(tracked ? {} : { priorStockHashes: [sha("old stock\n")] }) });
  t.check({ before, after, result, local: await get(box, REL) }, {
    before: false,
    after: true,
    result: { outcome: "parked", writtenAt: "_config/_template-updates/_config/x.card" },
    local: "old stock\n",
  });
});

// ## Normalize — timestamp-only diffs don't read as user edits
//
// Guide templates regenerate their `created-at` timestamps every install. With a `normalize` function we strip the volatile fields before hashing, so reinstalls don't think the user edited the file:
void test("Guide templates regenerate their created-at timestamps every install.", async (t) => {
  const box = await makeBox();
  const normalize = (s: string) => s.replace(/ts="[^"]*"/g, "");
  await install({ box, templateContent: "<guide ts=\"2026-01-01\"/>\n", relPath: "_config/g.card", normalize });
  const result = await install({ box, templateContent: "<guide ts=\"2026-05-24\"/>\n", relPath: "_config/g.card", normalize });
  t.check(result, { outcome: "unchanged" });
});

// ## Box-owned fields — a toggle doesn't freeze the box on old content
//
// Some card templates have fields the box owns as per-box *state* rather than definition — the canonical case is a schedule's `enabled`. `boxOwnedFields` strips those before the customised-or-not comparison, so a box that only toggled `enabled` still reads as unmodified stock and takes a definition update, with its own `enabled` carried onto the new version. Three cases, each starting from an installed v1 schedule:
//
// - the box only disables it, upstream ships v2: `overwritten`, with v2's definition and the box's `enabled: false` preserved (not parked, not re-enabled);
// - the box disables it AND edits the definition: still `parked` — real customization is never clobbered;
// - the box is already on current content and differs only by the toggle: `unchanged`, nothing rewritten.
void test("Some card templates have fields the box owns as per-box state rather than def...", async (t) => {
  const rel = "_config/schedules/s.scheduled-script.card";
  const card = ({ runs, description, extra }: { runs: string; description: string; extra?: string }) => `---\nruns: ${runs}\ndescription: ${description}\n${extra ?? ""}---\n`;
  const scenario = async ({ local, template }: { local: string; template: string }) => {
    const box = await makeBox();
    await install({ box, templateContent: card({ runs: "bbx sync", description: "v1" }), relPath: rel });
    await put({ box, rel, content: local });
    const result = await install({ box, templateContent: template, relPath: rel, boxOwnedFields: ["enabled"] });
    return { result, content: await get(box, rel) };
  };
  t.check(
    ({
      toggled: await scenario({ local: card({ runs: "bbx sync", description: "v1", extra: "enabled: false\n" }), template: card({ runs: "bbx sync", description: "v2" }) }),
      edited: await scenario({ local: card({ runs: "bbx sync --fast", description: "v1", extra: "enabled: false\n" }), template: card({ runs: "bbx sync", description: "v2" }) }),
      current: await scenario({ local: card({ runs: "bbx sync", description: "v1", extra: "enabled: false\n" }), template: card({ runs: "bbx sync", description: "v1" }) }),
    }),
    {
    toggled: {
      result: { outcome: "overwritten", writtenAt: rel },
      content: `---
runs: bbx sync
description: v2
enabled: false
---
`,
    },
    edited: {
      result: { outcome: "parked", writtenAt: `_config/_template-updates/${rel}` },
      content: `---
runs: bbx sync --fast
description: v1
enabled: false
---
`,
    },
    current: {
      result: { outcome: "unchanged" },
      content: `---
runs: bbx sync
description: v1
enabled: false
---
`,
    },
  },
  );
});

// ## Pruning stale parked files
//
// `pruneStaleTemplateUpdates` deletes files in `_config/_template-updates/` older than the threshold (default 30 days). Recent parks are left alone. Each mirror has its on-disk target present (the realistic case — a mirror is only ever parked because an on-disk copy diverged), so only *age* decides removal here:
void test("pruneStaleTemplateUpdates deletes files in config/template-updates/ older tha...", async (t) => {
  const box = await makeBox();
  const oldFile = await mirror({ box, rel: "old.card", ageDays: 40, target: true });
  const newFile = await mirror({ box, rel: "new.card", ageDays: 0, target: true });
  const removed = await pruneStaleTemplateUpdates(box, { now: Date.now() });
  t.check(({ removed, newSurvives: await exists(newFile), oldSurvives: await exists(oldFile) }), {
    removed: [
      "_config/_template-updates/old.card",
    ],
    newSurvives: true,
    oldSurvives: false,
  });
});

// When `_template-updates/` doesn't exist, prune is a silent no-op:
void test("When template-updates/ doesn't exist, prune is a silent no-op:", async (t) => {
  t.check(await pruneStaleTemplateUpdates(await makeBox()), []);
});

// Empty subdirectories are swept after files. A subdir that still holds a non-stale file (with its on-disk target present) is left in place — the sweep is best-effort and silent, so a non-empty directory is not an error:
void test("Empty subdirectories are swept after files.", async (t) => {
  const emptied = await makeBox();
  await mirror({ box: emptied, rel: "procedures/x.procedure.card", ageDays: 40, target: true });
  await pruneStaleTemplateUpdates(emptied);

  const mixed = await makeBox();
  await mirror({ box: mixed, rel: "procedures/old.procedure.card", ageDays: 40, target: true });
  await mirror({ box: mixed, rel: "procedures/fresh.procedure.card", ageDays: 0, target: true });
  const removed = await pruneStaleTemplateUpdates(mixed);
  t.check(
    ({
      emptiedDirSurvives: await exists(path.join(emptied, "_config/_template-updates/procedures")),
      removed,
      mixedDirSurvives: await exists(path.join(mixed, "_config/_template-updates/procedures")),
    }),
    {
    emptiedDirSurvives: false,
    removed: [
      "_config/_template-updates/procedures/old.procedure.card",
    ],
    mixedDirSurvives: true,
  },
  );
});

// ### Orphaned mirrors are reaped regardless of age
//
// A parked mirror whose on-disk `<relpath>` no longer exists (the copy was deleted, or a relpath-scheme migration renamed it) is drift-count noise — nothing for it to update. It's removed even when recent:
void test("A parked mirror whose on-disk <relpath> no longer exists (the copy was delete...", async (t) => {
  const box = await makeBox();
  await mirror({ box, rel: "procedures/gone.procedure.card", ageDays: 0, target: false }); // freshly parked, NO on-disk copy
  t.check(await pruneStaleTemplateUpdates(box, { now: Date.now() }), [
    "_config/_template-updates/procedures/gone.procedure.card",
  ]);
});

// ## Convergence clears the parked mirror
//
// Once a divergent box comes back into line with the template — the boxholder copies the parked update into place, or a migration strips the diverging field — the next `installTemplateFile` sees a match and clears the obsolete mirror. This is what keeps the drift count tracking *real* divergence instead of a pile of stale "update available" entries.
//
// The local reverting to the last cleanly-installed version (recorded hash = v1) makes a fresh v2 push a clean `overwritten`. An `unchanged` outcome clears it too — e.g. a migration edits the local file to match the current template:
void test("Once a divergent box comes back into line with the template — the boxholder c...", async (t) => {
  const reverted = await parkedBox();
  const parkedBefore = await listParkedTemplateUpdates(reverted);
  await put({ box: reverted, rel: REL, content: "v1\n" });
  const overwritten = await install({ box: reverted, templateContent: "v2\n" });

  const matched = await parkedBox();
  await put({ box: matched, rel: REL, content: "v2\n" });
  const unchanged = await install({ box: matched, templateContent: "v2\n" });

  t.check(
    ({
      parkedBefore,
      overwritten,
      afterOverwrite: await listParkedTemplateUpdates(reverted),
      unchanged,
      afterUnchanged: await listParkedTemplateUpdates(matched),
    }),
    {
    parkedBefore: [
      "_config/x.card",
    ],
    overwritten: { outcome: "overwritten", writtenAt: REL },
    afterOverwrite: [],
    unchanged: { outcome: "unchanged" },
    afterUnchanged: [],
  },
  );
});
