import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { BoxExportError, exportBoxCards, formatBoxExportReport, mapStagedCardPath } from "./box-export.js";

const AUTHORSHIP = `authorship:
  people:
    - name: Ian Bicking
      role: author
      contribution: Directed and edited this card.
  ai:
    transcription: none
    drafting: none
    editing: none`;

function pageCard(params: { title: string; body: string; navigation?: boolean }): string {
  const navigation = params.navigation === true ? "\nnavigation: true" : "";
  return `---
title: ${params.title}
summary: Fixture summary.
${AUTHORSHIP}${navigation}
---
${params.body}
`;
}

function documentCard(): string {
  return `---
title: Confidence
summary: Fixture attachment.
${AUTHORSHIP}
kind: generated
status: ready
---
# Confidence

Attached context.
`;
}

interface Fixture {
  root: string;
  boxDir: string;
  stagingDir: string;
  destinationDir: string;
}

async function fixture(t: TestContext): Promise<Fixture> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "box-export-test-"));
  t.after(async () => fs.rm(root, { recursive: true, force: true }));
  const boxDir = path.join(root, "box");
  const stagingDir = path.join(boxDir, "_publish", "public-site");
  const destinationDir = path.join(root, "repository-cards");
  await fs.mkdir(path.join(boxDir, ".git"), { recursive: true });
  await fs.mkdir(path.join(stagingDir, "walkthrough.attach"), { recursive: true });
  await fs.mkdir(destinationDir, { recursive: true });
  await fs.writeFile(
    path.join(stagingDir, "index.site-page.card"),
    pageCard({ title: "Home", navigation: true, body: "# Home\n\n[Walkthrough](/walkthrough.site-page.card)" }),
  );
  await fs.writeFile(
    path.join(stagingDir, "walkthrough.site-page.card"),
    pageCard({
      title: "Walkthrough",
      body: "# Walkthrough\n\n[Confidence](/walkthrough.attach/confidence.doc.card)",
    }),
  );
  await fs.writeFile(
    path.join(stagingDir, "walkthrough.attach", "confidence.site-doc.card"),
    documentCard(),
  );
  return { root, boxDir, stagingDir, destinationDir };
}

test("site-doc maps to the public doc suffix and unsafe paths are refused", () => {
  assert.equal(mapStagedCardPath("walkthrough.attach/confidence.site-doc.card"), "walkthrough.attach/confidence.doc.card");
  assert.throws(() => mapStagedCardPath("../private.site-page.card"), BoxExportError);
  assert.throws(() => mapStagedCardPath("notes.doc.card"), /unsupported staged file/);
});

test("dry-run validates the real site graph, reports changes, and writes nothing", async (t) => {
  const setup = await fixture(t);
  await fs.writeFile(path.join(setup.root, "private-draft.site-page.card"), "not public");
  await fs.writeFile(path.join(setup.destinationDir, "retained.site-page.card"), "repository-only");

  const report = await exportBoxCards({ boxDir: setup.boxDir, destinationDir: setup.destinationDir });

  assert.equal(report.mode, "dry-run");
  assert.equal(report.pageCount, 3);
  assert.deepEqual(report.additions, [
    "index.site-page.card",
    "walkthrough.attach/confidence.doc.card",
    "walkthrough.site-page.card",
  ]);
  assert.deepEqual(report.retained, ["retained.site-page.card"]);
  assert.match(formatBoxExportReport(report), /result: dry run; nothing written/);
  await assert.rejects(fs.readFile(path.join(setup.destinationDir, "index.site-page.card")), /ENOENT/);
});

test("apply writes additions and updates, maps site-doc, and never deletes destination-only cards", async (t) => {
  const setup = await fixture(t);
  const retained = path.join(setup.destinationDir, "retained.site-page.card");
  await fs.writeFile(retained, "repository-only");
  await fs.writeFile(path.join(setup.destinationDir, "index.site-page.card"), "old home");

  const report = await exportBoxCards({ boxDir: setup.boxDir, destinationDir: setup.destinationDir, apply: true });

  assert.deepEqual(report.updates, ["index.site-page.card"]);
  assert.equal(report.written, 3);
  assert.equal(await fs.readFile(retained, "utf8"), "repository-only");
  assert.equal(await fs.readFile(path.join(setup.destinationDir, "index.site-page.card"), "utf8"),
    await fs.readFile(path.join(setup.stagingDir, "index.site-page.card"), "utf8"));
  assert.equal(await fs.readFile(path.join(setup.destinationDir, "walkthrough.attach", "confidence.doc.card"), "utf8"),
    documentCard());
  await assert.rejects(
    fs.readFile(path.join(setup.destinationDir, "walkthrough.attach", "confidence.site-doc.card")),
    /ENOENT/,
  );
});

test("malformed authorship and links outside the selected graph fail before writes", async (t) => {
  const setup = await fixture(t);
  const home = path.join(setup.stagingDir, "index.site-page.card");
  await fs.writeFile(home, (await fs.readFile(home, "utf8")).replace("    editing: none\n", ""));
  await assert.rejects(
    exportBoxCards({ boxDir: setup.boxDir, destinationDir: setup.destinationDir, apply: true }),
    /authorship\.ai\.editing/,
  );
  await assert.rejects(fs.readFile(path.join(setup.destinationDir, "index.site-page.card")), /ENOENT/);

  await fs.writeFile(home, pageCard({
    title: "Home",
    navigation: true,
    body: "# Home\n\n[Private](/private.doc.card)",
  }));
  await assert.rejects(
    exportBoxCards({ boxDir: setup.boxDir, destinationDir: setup.destinationDir }),
    /broken internal link/,
  );
});

test("staging symlinks and unsupported files fail closed", async (t) => {
  const setup = await fixture(t);
  await fs.symlink(
    path.join(setup.stagingDir, "index.site-page.card"),
    path.join(setup.stagingDir, "linked.site-page.card"),
  );
  await assert.rejects(
    exportBoxCards({ boxDir: setup.boxDir, destinationDir: setup.destinationDir }),
    /staging contains a symlink/,
  );
  await fs.unlink(path.join(setup.stagingDir, "linked.site-page.card"));
  await fs.writeFile(path.join(setup.stagingDir, "notes.txt"), "not a card");
  await assert.rejects(
    exportBoxCards({ boxDir: setup.boxDir, destinationDir: setup.destinationDir }),
    /unsupported staged file/,
  );
});
