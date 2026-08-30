import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { test } from "tap";

const execFileAsync = promisify(execFile);
const beeBoxRoot = fileURLToPath(new URL("../..", import.meta.url));
const successMarker = "TRPC_DIRECTORY_IMPORT_OK";
const childArgs = [
  "--disable-warning=DEP0040",
  "--import=tsx",
  "--import=agent-doctest/tap",
  "--import=agent-doctest/loader",
  "--input-type=module",
  "--eval",
  `const imported = await import('./src/frontend/src/lib/view-bindings.ts');
if (typeof imported.createSingleFlightCache !== 'function') throw new Error('view-bindings export missing');
console.log('${successMarker}');`,
];

test("frontend tRPC directory entrypoint resolves in concurrent loader children", async (t) => {
  const childCount = 12;
  const results = await Promise.allSettled(
    Array.from({ length: childCount }, () => execFileAsync(process.execPath, childArgs, {
      cwd: beeBoxRoot,
      timeout: 15_000,
      killSignal: "SIGKILL",
      maxBuffer: 64 * 1024,
    })),
  );
  const failures = results.flatMap((result, index) => (
    result.status === "rejected"
      ? [`child ${index + 1}: ${String(result.reason)}`]
      : result.value.stdout.trim() === successMarker
        ? []
        : [`child ${index + 1}: missing success marker; stdout=${JSON.stringify(result.value.stdout)}`]
  ));

  t.same(failures, [], `all ${childCount} concurrent loader children resolved view-bindings -> lib/trpc`);
});
