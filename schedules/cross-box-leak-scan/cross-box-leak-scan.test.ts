/**
 * Unit coverage for `static-sweep.ts`'s matchers against fixture source
 * strings (no real beebox files — the real files are exercised by running
 * the sweep directly, see the schedule's own verification). Split from
 * `host-audit.test.ts` (which covers `host-audit.ts` and `run.ts`'s pure
 * helpers) to stay under the repo's per-file line budget.
 *
 *   node --import tsx --test schedules/cross-box-leak-scan/*.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { scanZodStringFields, scanRawRequestAccess, scanCoreBoxRootJoins } from "./static-sweep.js";
// ─── static-sweep ───────────────────────────────────────────────────────

test("scanZodStringFields: flags a bare path-like z.string().optional()", () => {
  const src = `
    reserveSession: publicProcedure
      .input(z.object({
        sessionId: sdkSessionIdSchema,
        contextDir: z.string().optional(),
        model: z.string().optional(),
      }))
  `;
  const findings = scanZodStringFields(src, "trpc/routers/chat-control-procedures.ts");
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.text, "contextDir: z.string().optional(),");
});

test("scanZodStringFields: does not flag a refined field, even split across lines", () => {
  const src = `
    newFeatures: publicProcedure
      .input(z.object({
        contextDir: z.string()
          .refine((dir) => !dir.startsWith("/") && !dir.split("/").includes(".."), "contextDir must stay inside the box")
          .nullable(),
      }))
  `;
  assert.deepEqual(scanZodStringFields(src, "trpc/routers/chat-control-procedures.ts"), []);
});

test("scanZodStringFields: does not flag a single-line refine (landmarks.ts shape)", () => {
  const src = ".input(z.object({ dir: z.string().refine((d) => !d.startsWith(\"/\") && !d.split(\"/\").includes(\"..\")).nullable() }))";
  assert.deepEqual(scanZodStringFields(src, "trpc/routers/landmarks.ts"), []);
});

test("scanZodStringFields: does not flag path: z.string().min(1) — .min() is not an allowed bare suffix", () => {
  const src = ".input(z.object({ path: z.string().min(1) }))";
  assert.deepEqual(scanZodStringFields(src, "trpc/routers/card.ts"), []);
});

test("scanZodStringFields: ignores a path-like field name outside the allowed pattern", () => {
  const src = ".input(z.object({ label: z.string().optional() }))";
  assert.deepEqual(scanZodStringFields(src, "trpc/routers/x.ts"), []);
});

test("scanZodStringFields: does not flag a bare field whose enclosing object is validated as a whole (todos.ts list shape)", () => {
  const src = `
    list: publicProcedure
      .input(z.object({
        cardPath: z.string().optional(),
        glob: z.string().optional(),
      }).superRefine((val, ctx) => {
        if (val.glob !== undefined && isUnsafeGlobPattern(val.glob)) {
          ctx.addIssue({ code: "custom", message: "bad glob" });
        }
      }))
  `;
  assert.deepEqual(scanZodStringFields(src, "trpc/routers/todos.ts"), []);
});

test("scanZodStringFields: still flags a bare field whose object has no trailing refine at all", () => {
  const src = ".input(z.object({ dir: z.string() }))";
  const findings = scanZodStringFields(src, "trpc/routers/share-contract.ts");
  assert.equal(findings.length, 1);
});

test("scanRawRequestAccess: flags request.query.<name> when the file uses it on the filesystem with no containment helper", () => {
  const src = `
    server.get("/api/task-output", async (request, reply) => {
      const filePath = request.query.file;
      const realResolved = await fs.realpath(path.resolve(filePath));
    });
  `;
  const findings = scanRawRequestAccess(src, "routes/api.ts");
  assert.equal(findings.length, 1);
  assert.match(findings[0]?.text ?? "", /request\.query\.file/);
});

test("scanRawRequestAccess: stands down once the file calls a containment helper", () => {
  const src = `
    import { boxRelativePath } from "../../shared/box-path.js";
    const reqPath = boxRelativePath(request.params["*"] || "");
    const abs = path.join(boxRoot, reqPath);
  `;
  assert.deepEqual(scanRawRequestAccess(src, "routes/api-files.ts"), []);
});

test("scanRawRequestAccess: stands down for a TaskOutput-named helper even if not on the fixed list", () => {
  const src = `
    import { isTaskOutputPathForBoxRenamed } from "../../core/chat/session/transcript-paths.js";
    const filePath = request.query.file;
    if (!isTaskOutputPathForBoxRenamed({ boxRoot, filePath })) return;
    const realResolved = await fs.realpath(filePath);
  `;
  assert.deepEqual(scanRawRequestAccess(src, "routes/api.ts"), []);
});

test("scanRawRequestAccess: stands down on the inline containment idiom (api-browse.ts / figure.ts shape)", () => {
  const src = `
    const reqPath = request.params["*"] || "";
    const targetDir = reqPath ? path.join(boxRoot, reqPath) : boxRoot;
    const root = path.resolve(boxRoot);
    const resolved = path.resolve(targetDir);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      return { path: reqPath, dirs: [], cards: [] };
    }
  `;
  assert.deepEqual(scanRawRequestAccess(src, "routes/api-browse.ts"), []);
});

test("scanRawRequestAccess: skips a file that never touches the filesystem with the value (api-adapters.ts shape)", () => {
  const src = `
    const upstreamPath = request.params["*"] || "";
    const url = \`\${base}/\${upstreamPath}\${query}\`;
  `;
  assert.deepEqual(scanRawRequestAccess(src, "routes/api-adapters.ts"), []);
});

test("scanRawRequestAccess: the file-level fs-usage gate is not scoped to the tainted value — unrelated fs/path.join elsewhere in the file still lets a real forward-to-URL/git match through", () => {
  // Documents a known gap (see run.ts and static-sweep.ts's FS_USAGE_RE doc
  // comment): api-adapters.ts and routes/history.ts both do unrelated
  // fs/path.join work elsewhere in the file (a local secret read, a git
  // object read), so the coarse file-level gate does not actually exclude
  // them the way a per-match gate would.
  const src = `
    const secretPath = path.join(boxRoot, "config", "connectors", \`\${adapterName}.secret.json\`);
    const key = await fs.readFile(secretPath, "utf8");
    const upstreamPath = request.params["*"] || "";
    const url = \`\${base}/\${upstreamPath}\${query}\`;
  `;
  const findings = scanRawRequestAccess(src, "routes/api-adapters.ts");
  assert.equal(findings.length, 1);
  assert.match(findings[0]?.text ?? "", /upstreamPath = request\.params/);
});

test("scanRawRequestAccess: containment is a WINDOW, not whole-file — a second, later, unrelated access past the window still reports", () => {
  // Fix for the cross-model finding: a single early helper call used to
  // suppress the whole file, so a second unbounded request.query access added
  // 60 lines later (well past any plausible "the fix for this one") was
  // silently hidden. Build a fixture with a genuinely contained first access,
  // ~60 blank-ish lines of padding, then a second, uncontained access.
  const filler = Array.from({ length: 60 }, (_v, i) => `    const noop${String(i)} = ${String(i)};`).join("\n");
  const src = `
    import { boxRelativePath } from "../../shared/box-path.js";
    const first = request.query.file;
    const abs = path.join(boxRoot, boxRelativePath(first));
    const stat = await fs.stat(abs);
${filler}
    const second = request.query.file;
    const abs2 = path.join(boxRoot, second);
  `;
  const findings = scanRawRequestAccess(src, "routes/api.ts");
  assert.equal(findings.length, 1);
  assert.match(findings[0]?.text ?? "", /const second = request\.query\.file;/);
});

test("scanCoreBoxRootJoins: flags path.join(boxRoot, contextDir) with no containment helper (features.ts shape)", () => {
  const src = `
    export async function readLandmarkFeaturesForDir(boxRoot: string, contextDir: string) {
      const absDir = path.join(boxRoot, contextDir);
    }
  `;
  const findings = scanCoreBoxRootJoins(src, "core/landmark/features.ts");
  assert.equal(findings.length, 1);
  assert.match(findings[0]?.text ?? "", /path\.join\(boxRoot, contextDir\)/);
});

test("scanCoreBoxRootJoins: stands down once the file calls a containment helper", () => {
  const src = `
    import { containWithinBox } from "../../lib/box-containment.js";
    const dir = path.join(boxRoot, contextDir);
    containWithinBox(boxRoot, dir);
  `;
  assert.deepEqual(scanCoreBoxRootJoins(src, "core/chat/session/history.ts"), []);
});

