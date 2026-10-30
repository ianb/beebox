// # Quota CLI
//
// `bin/workstreams quotas --json` prints the collector's result as one JSON line.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { printQuotas } from "../agent-quotas.js";

void test("printQuotas writes the collected quotas as one JSON line.", async (t) => {
  const quotas = [
    { provider: "claude", status: "available", fetchedAt: "2026-08-13T12:00:00.000Z", windows: [] },
    { provider: "codex", status: "unavailable", fetchedAt: "2026-08-13T12:00:00.000Z", windows: [], message: "not logged in" },
  ];
  let written = "";
  await printQuotas(async () => quotas, (text) => { written += text; });
  t.check(written, `${JSON.stringify(quotas)}\n`);
});
