// /healthz surfaces box-local schema load failures.
//
// Keep-last-good (`loadOneSchemaFile` in src/schemas.ts) means a box-local
// schema file that fails to reload keeps serving its previous good version.
// That used to make the failure invisible (console.warn only). /healthz now
// rolls up `listSchemaLoadFailures` per box, as it does parked template
// updates.
//
// `listSchemaLoadFailures` only reflects what `loadBoxSchemas` has already
// populated in this process, and box registration only starts the schema
// watcher. So /healthz loads box schemas itself before reading the failure
// snapshot (as `bbx status` does). This test never primes the cache by hand,
// so a regression back to "just read the map" shows up as a false total: 0.

import { test } from "tap";
import "agent-doctest/tap";
import * as path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { makeTestServer } from "../helpers/test-route-server.js";
import { bodyField } from "../helpers/test-helpers.js";
import { invalidateBoxSchemas } from "../../src/schemas.js";

async function writeSchema(file: string, content: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
}

const GOOD_SCHEMA = `import { cardSchema } from "beebox/cards";
import { z } from "beebox/schema";

export default cardSchema("widget", { fields: { size: z.number() } });
`;

const BROKEN_SCHEMA = `import { cardSchema } from "beebox/cards";
export default cardSchema(`;

void test("/healthz reports a schema that stopped loading", async (t) => {
  process.env.BBX_DIAG_API_KEY = "test-diag-key";
  const server = await makeTestServer();
  t.teardown(async () => {
    delete process.env.BBX_DIAG_API_KEY;
    await server.cleanup();
  });
  const healthz = async () => {
    const res = await server.rootRequest({ method: "GET", url: "/healthz", headers: { authorization: "Bearer test-diag-key" } });
    return bodyField(res.body, "schemaLoadFailures");
  };

  // Box-local schemas live at `<boxRoot>/src/schemas/`.
  const widget = path.join(server.boxRoot, "src/schemas/widget.ts");
  await writeSchema(widget, GOOD_SCHEMA);
  await t.check(healthz(), { total: 0, byBox: {} });

  // A schema edited to a broken state is picked up on the very next /healthz
  // call, with no other code path having loaded this box's schemas first.
  await writeSchema(widget, BROKEN_SCHEMA);
  invalidateBoxSchemas(server.boxRoot);
  await t.check(healthz(), { total: 1, byBox: { test: 1 } });
});
