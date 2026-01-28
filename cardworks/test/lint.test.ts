import { test } from "tap";
import { MemoryCardLoader } from "../src/loader/loader.js";
import { lintCard, lintAll, formatLintResults } from "../src/lint/index.js";
import { element } from "../src/schema/element.js";
import { z } from "zod";

const CardSchema = element("card", {
  children: z.array(element("title", { text: z.string() })),
});

test("lintCard: valid card returns no errors", async (t) => {
  const loader = new MemoryCardLoader("/project", {
    files: {
      "/project/Valid.card": `<card version="1.0.0"><title>Test</title></card>`,
    },
    schemas: [CardSchema],
  });

  const result = await lintCard(loader, "/project/Valid.card");

  t.equal(result.errors.length, 0);
  t.equal(result.warnings.length, 0);
});

test("lintCard: parse error is reported", async (t) => {
  const loader = new MemoryCardLoader("/project", {
    files: {
      "/project/Invalid.card": `<card version="1.0.0"><unclosed></card>`,
    },
  });

  const result = await lintCard(loader, "/project/Invalid.card");

  t.equal(result.errors.length, 1);
  t.equal(result.errors[0]?.type, "parse");
  t.ok(result.errors[0]?.message.includes("mismatch"));
});

test("lintCard: validation error is reported", async (t) => {
  const StrictSchema = element("card", {
    children: z.array(element("title", { text: z.string().min(10) })),
  });

  const loader = new MemoryCardLoader("/project", {
    files: {
      "/project/Invalid.card": `<card version="1.0.0"><title>Short</title></card>`,
    },
    schemas: [StrictSchema],
  });

  const result = await lintCard(loader, "/project/Invalid.card");

  t.equal(result.errors.length, 1);
  t.equal(result.errors[0]?.type, "validation");
});

test("lintCard: broken reference is reported", async (t) => {
  const loader = new MemoryCardLoader("/project", {
    files: {
      "/project/Main.card": `<card version="1.0.0">
  <link ref="./Missing.card"/>
</card>`,
    },
  });

  const result = await lintCard(loader, "/project/Main.card");

  t.equal(result.errors.length, 1);
  t.equal(result.errors[0]?.type, "reference");
  t.ok(result.errors[0]?.message.includes("does not exist"));
});

test("lintCard: version mismatch is reported as warning", async (t) => {
  const loader = new MemoryCardLoader("/project", {
    files: {
      "/project/Main.card": `<card version="1.0.0">
  <link ref="./Target.card@1.0.0"/>
</card>`,
      "/project/Target.card": `<card version="2.0.0"><title>Target</title></card>`,
    },
  });

  const result = await lintCard(loader, "/project/Main.card");

  t.equal(result.errors.length, 0);
  t.equal(result.warnings.length, 1);
  t.equal(result.warnings[0]?.type, "reference");
  t.ok(result.warnings[0]?.message.includes("Version mismatch"));
});

test("lintCard: checkRefs can be disabled", async (t) => {
  const loader = new MemoryCardLoader("/project", {
    files: {
      "/project/Main.card": `<card version="1.0.0">
  <link ref="./Missing.card"/>
</card>`,
    },
  });

  const result = await lintCard(loader, "/project/Main.card", { checkRefs: false });

  t.equal(result.errors.length, 0);
  t.equal(result.warnings.length, 0);
});

test("lintAll: lints all cards in project", async (t) => {
  const loader = new MemoryCardLoader("/project", {
    files: {
      "/project/cards/A.card": `<card version="1.0.0"><title>A</title></card>`,
      "/project/cards/B.card": `<card version="1.0.0"><title>B</title></card>`,
      "/project/cards/sub/C.card": `<card version="1.0.0"><title>C</title></card>`,
    },
    schemas: [CardSchema],
  });

  const summary = await lintAll(loader);

  t.equal(summary.filesChecked, 3);
  t.equal(summary.totalErrors, 0);
  t.equal(summary.totalWarnings, 0);
});

test("lintAll: reports errors across multiple files", async (t) => {
  const loader = new MemoryCardLoader("/project", {
    files: {
      "/project/Valid.card": `<card version="1.0.0"><title>Valid</title></card>`,
      "/project/Invalid.card": `<card version="1.0.0"><broken></card>`,
    },
  });

  const summary = await lintAll(loader);

  t.equal(summary.filesChecked, 2);
  t.equal(summary.totalErrors, 1);
  t.equal(summary.filesWithErrors, 1);
});

test("formatLintResults: formats clean results", async (t) => {
  const loader = new MemoryCardLoader("/project", {
    files: {
      "/project/Valid.card": `<card version="1.0.0"><title>Test</title></card>`,
    },
    schemas: [CardSchema],
  });

  const summary = await lintAll(loader);
  const output = formatLintResults(summary, { colors: false });

  t.ok(output.includes("1 files checked"));
  t.ok(output.includes("no issues found"));
});

test("formatLintResults: formats errors", async (t) => {
  const loader = new MemoryCardLoader("/project", {
    files: {
      "/project/Invalid.card": `<card version="1.0.0"><broken></card>`,
    },
  });

  const summary = await lintAll(loader);
  const output = formatLintResults(summary, { colors: false });

  t.ok(output.includes("Invalid.card"));
  t.ok(output.includes("error"));
  t.ok(output.includes("1 error"));
});

test("formatLintResults: basePath shortens paths", async (t) => {
  const loader = new MemoryCardLoader("/project", {
    files: {
      "/project/cards/Test.card": `<card version="1.0.0"><broken></card>`,
    },
  });

  const summary = await lintAll(loader);
  const output = formatLintResults(summary, { colors: false, basePath: "/project/" });

  // The file header should use shortened path
  t.ok(output.includes("cards/Test.card"));
  // The first line (header) should not have the full path
  const firstLine = output.split("\n")[0] ?? "";
  t.notOk(firstLine.includes("/project/"));
});
