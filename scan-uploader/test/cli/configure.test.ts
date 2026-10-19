// # The `configure` subcommand's core logic
//
// Exercises `configure()` (`src/cli/configure.ts`) directly — argv parsing and
// interactive TTY prompting live in `src/cli/configure-cli.ts` and aren't
// exercised here (the TTY-prompt path isn't practical to doctest: it needs a
// real TTY; the non-TTY `requireFolderFlag` fail-closed path below covers the
// same logic `configure-cli.ts` actually depends on).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, str } from "@ianbicking/tap-check/check";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { configure } from "../../src/cli/configure.js";
import {
  parseConfigureArgs,
  requireFolderFlag,
  TOKEN_PROMPT_TEXT,
  TOKEN_RECEIVED_ACK,
} from "../../src/cli/configure-cli.js";
import { parseServerUrlWithBox } from "../../src/cli/target-url.js";
import { startFakeScanServer, type FakeScanServer } from "./fake-scan-server.js";
import { makeTmpDir, removeTmpDir } from "./tmp-dir.js";

const dir = await makeTmpDir("configure");

interface Rejection {
  readonly name: string;
  readonly message: string;
}

async function rejected(promise: Promise<unknown>): Promise<Rejection> {
  try {
    await promise;
    return { name: "(no error thrown)", message: "(no error thrown)" };
  } catch (e) {
    return {
      name: e instanceof Error ? e.name : String(e),
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

function syncRejected(fn: () => unknown): Promise<Rejection> {
  return rejected(Promise.resolve().then(fn));
}

function permOctal(mode: number): string {
  return (mode & 0o777).toString(8);
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

// ## Happy path — config created from scratch, token file written 0600
//
// No `scan-uploader.json` exists yet at this path, so the writer starts from
// `{ "targets": [] }`; the verification `check` succeeds against the fake
// server.
void test("No scan-uploader.json exists yet at this path, so the writer starts from { \"t...", async (t) => {
  t.teardown(async () => {
    try {
      await server1.close();
    } catch (error) {
      t.error(error);
    }
  });
  const homeDir1 = join(dir, "home1");
  const configPath1 = join(dir, "fresh", "scan-uploader.json");
  const server1: FakeScanServer = await startFakeScanServer({
    checkState: () => ({ state: "unknown" }),
    putOutcome: () => ({ status: 200, body: { status: "accepted" } }),
  });
  const result1 = await configure({
    serverUrlWithBox: `${server1.url}/family`,
    folder: "/scans/family",
    disposition: "archive",
    name: "laptop-1",
    token: "secret-token-1",
    configPath: configPath1,
    homeDir: homeDir1,
  });
  t.check(result1, {
    configPath: configPath1,
    tokenPath: join(homeDir1, ".scan-tokens", "family.token"),
    box: "family",
    folder: "/scans/family",
    name: "laptop-1",
    warnings: [],
  });

  // The config file was created with exactly the real values — no placeholders:

  const configContents1 = JSON.parse(await readFile(configPath1, "utf-8"));
  t.check(configContents1, {
    targets: [
      {
        folder: "/scans/family",
        serverUrl: server1.url,
        box: "family",
        tokenPath: result1.tokenPath,
        disposition: "archive",
      },
    ],
  });

  // The token file is 0600, its parent directory 0700, and the token content is
  // exactly what was passed in (trimmed):

  const tokenStat1 = await stat(result1.tokenPath);
  t.check(permOctal(tokenStat1.mode), "600");

  const tokenDirStat1 = await stat(join(homeDir1, ".scan-tokens"));
  t.check(permOctal(tokenDirStat1.mode), "700");

  t.check((await readFile(result1.tokenPath, "utf-8")).trim(), "secret-token-1");

  // Verification only ever hits `check` — no PUT is sent:

  t.check(server1.putRequests, []);
});

// ## Unknown keys survive — update-in-place and append both preserve them
//
// Pre-seed a config with a top-level unknown key and a per-target unknown key.
// Running `configure` for the SAME box + serverUrl updates that target
// in place (folder/disposition change, unknown keys survive); running it again
// for a DIFFERENT box appends a second target and leaves the first untouched.
void test("Pre-seed a config with a top-level unknown key and a per-target unknown key.", async (t) => {
  t.teardown(async () => {
    try {
      await server2.close();
    } catch (error) {
      t.error(error);
    }
  });
  const server2: FakeScanServer = await startFakeScanServer({
    checkState: () => ({ state: "unknown" }),
    putOutcome: () => ({ status: 200, body: { status: "accepted" } }),
  });
  const configPath2 = join(dir, "preseeded", "scan-uploader.json");
  await mkdir(join(dir, "preseeded"), { recursive: true });
  await writeFile(
    configPath2,
    JSON.stringify(
      {
        targets: [
          {
            folder: "/old/folder",
            serverUrl: server2.url,
            box: "family",
            tokenPath: "/old/token/path",
            disposition: "keep",
            note: "hand-added per-target field",
          },
        ],
        futureFeature: { nested: true },
      },
      null,
      2,
    ),
  );
  const result2 = await configure({
    serverUrlWithBox: `${server2.url}/family`,
    folder: "/scans/updated",
    disposition: "archive",
    name: "laptop-2",
    token: "secret-token-2",
    configPath: configPath2,
    homeDir: join(dir, "home2"),
  });
  const configContents2 = JSON.parse(await readFile(configPath2, "utf-8"));
  t.check(configContents2, {
    targets: [
      {
        folder: "/scans/updated",
        serverUrl: server2.url,
        box: "family",
        tokenPath: result2.tokenPath,
        disposition: "archive",
        note: "hand-added per-target field",
      },
    ],
    futureFeature: { nested: true },
  });

  // A second `configure` call for a different box appends rather than
  // overwriting, and the first target (with its unknown key) is untouched:

  await configure({
    serverUrlWithBox: `${server2.url}/second`,
    folder: "/scans/second",
    disposition: "keep",
    name: "laptop-2b",
    token: "secret-token-2b",
    configPath: configPath2,
    homeDir: join(dir, "home2b"),
  });
  const configContents2b = JSON.parse(await readFile(configPath2, "utf-8"));
  t.check(configContents2b, {
    targets: [
      {
        folder: "/scans/updated",
        serverUrl: server2.url,
        box: "family",
        tokenPath: result2.tokenPath,
        disposition: "archive",
        note: "hand-added per-target field",
      },
      {
        folder: "/scans/second",
        serverUrl: server2.url,
        box: "second",
        tokenPath: join(dir, "home2b", ".scan-tokens", "second.token"),
        disposition: "keep",
      },
    ],
    futureFeature: { nested: true },
  });
});

// ## An unparseable existing config is refused, untouched
void test("An unparseable existing config is refused, untouched", async (t) => {
  t.teardown(async () => {
    try {
      await server3.close();
    } catch (error) {
      t.error(error);
    }
  });
  const server3: FakeScanServer = await startFakeScanServer({
    checkState: () => ({ state: "unknown" }),
    putOutcome: () => ({ status: 200, body: { status: "accepted" } }),
  });
  const badConfigPath = join(dir, "bad", "scan-uploader.json");
  await mkdir(join(dir, "bad"), { recursive: true });
  await writeFile(badConfigPath, "{ not json");
  const failure3 = await rejected(
    configure({
      serverUrlWithBox: `${server3.url}/family`,
      folder: "/scans/family",
      disposition: "keep",
      name: "x",
      token: "t",
      configPath: badConfigPath,
      homeDir: join(dir, "home3"),
    }),
  );
  // The JSON parser's own wording varies between Node versions.
  t.check(failure3, {
    name: "ConfigError",
    message: str`Invalid config at ${badConfigPath}: not valid JSON, refusing to modify: ${any(String)}`,
  });

  // The file is byte-for-byte untouched:

  t.check(await readFile(badConfigPath, "utf-8"), "{ not json");
});

// ## Slug validation rejects path tricks before any filesystem use
//
// The token path is derived only from the box slug parsed out of
// `<server-url-with-box>`, and that slug is validated against a conservative
// pattern before it becomes a filename component. An encoded-slash traversal
// attempt in the URL path never matches the pattern:
void test("The token path is derived only from the box slug parsed out of <server-url-wi...", async (t) => {
  const badSlug = await syncRejected(() => parseServerUrlWithBox("https://beebox.run/..%2f..%2fetc%2fpasswd"));
  t.check(badSlug, {
    name: "ConfigureError",
    message: "box slug \"..%2f..%2fetc%2fpasswd\" is invalid — must match ^[\\da-z][\\da-z-]{0,63}$",
  });

  // The box is the LAST path segment; a mount prefix before it (the dev
  // router's `/<worktree>/<box>` shape) stays part of the server URL rather
  // than being silently dropped:

  const nested = parseServerUrlWithBox("http://localhost:3210/my-worktree/test1");
  t.check(nested, { serverUrl: "http://localhost:3210/my-worktree", box: "test1" });

  const bare = parseServerUrlWithBox("https://beebox.run/family");
  t.check(bare, { serverUrl: "https://beebox.run", box: "family" });

  // And `configure()` itself refuses before writing anything — the bad slug is
  // rejected during URL parsing, ahead of any config or token write:

  const configPath4 = join(dir, "slug-test", "scan-uploader.json");
  const failure4 = await rejected(
    configure({
      serverUrlWithBox: "https://beebox.run/..%2f..%2fetc%2fpasswd",
      folder: "/scans/x",
      disposition: "keep",
      name: "x",
      token: "t",
      configPath: configPath4,
      homeDir: join(dir, "home4"),
    }),
  );
  t.check(failure4, {
    name: "ConfigureError",
    message: "box slug \"..%2f..%2fetc%2fpasswd\" is invalid — must match ^[\\da-z][\\da-z-]{0,63}$",
  });

  t.check(await exists(configPath4), false);
});

// ## Non-TTY with a missing `--folder` fails closed, naming the flag
void test("Non-TTY with a missing `--folder` fails closed, naming the flag", async (t) => {
  const missingFolder = await syncRejected(() => requireFolderFlag(undefined));
  t.check(missingFolder, { name: "ConfigureError", message: "missing required flag: --folder" });

  // A folder that IS present just passes through:

  t.check(requireFolderFlag("/scans/present"), "/scans/present");

  // An empty `--folder ""` is rejected the same way — not silently accepted as
  // a placeholder:

  const emptyFolder = await syncRejected(() => requireFolderFlag(""));
  t.check(emptyFolder, { name: "ConfigureError", message: "--folder must not be empty" });

  // A flag with a missing value that happens to be followed by another flag is
  // never silently treated as that flag's value — `--folder --config x` must
  // fail closed on `--folder`, not quietly write to the wrong config path:

  const looksLikeAFlag = await syncRejected(() =>
    parseConfigureArgs(["https://beebox.run/family", "--folder", "--config", "/tmp/x.json"]),
  );
  t.check(looksLikeAFlag, { name: "ConfigureError", message: "--folder requires a value" });
});

// The album flag is parsed as one argument, including spaces:
void test("The album flag is parsed as one argument, including spaces:", async (t) => {
  t.check(parseConfigureArgs(["https://beebox.run/family", "--folder", "/photos", "--photos-album", "Bee Box"]), {
    serverUrlWithBox: "https://beebox.run/family",
    folder: "/photos",
    disposition: undefined,
    photosAlbum: "Bee Box",
    name: undefined,
    configPath: undefined,
  });
});

// ## The hidden token prompt's exact wording
//
// The interactive TTY prompt itself isn't practical to doctest (it needs a
// real TTY — verified manually with `script -q /dev/null`; see the comment on
// `promptToken`), but the exact text it writes is exported as plain
// constants precisely so a typo, or a regression back to the invisible-prompt
// bug (the prompt used to be written through the same muted stream as the
// input echo, so it silently never appeared at all), stays test-guarded:
void test("The interactive TTY prompt itself isn't practical to doctest (it needs a real...", async (t) => {
  t.check(TOKEN_PROMPT_TEXT, "Paste the scan token (input is hidden): ");

  t.check(TOKEN_RECEIVED_ACK, "token received");
});

// ## A bad new target never corrupts an already-valid config on disk
//
// `configure()` itself doesn't pre-check `folder` (that's `configure-cli.ts`'s
// job via `requireFolderFlag`) — so this exercises the writer's OWN
// belt-and-suspenders guard: the candidate document is validated with the
// strict reader's rules BEFORE the atomic write, so a target the reader would
// reject (here: an empty `folder`) never overwrites a config that was valid
// before this call.
void test("configure() itself doesn't pre-check folder (that's configure-cli.ts's job vi...", async (t) => {
  t.teardown(async () => {
    try {
      await server5.close();
    } catch (error) {
      t.error(error);
    }
  });
  const configPath5 = join(dir, "corruption-guard", "scan-uploader.json");
  await mkdir(join(dir, "corruption-guard"), { recursive: true });
  const goodConfig5 = { targets: [{ folder: "/scans/good", serverUrl: "https://good.example.org", box: "good", tokenPath: "/t", disposition: "keep" }] };
  await writeFile(configPath5, JSON.stringify(goodConfig5, null, 2));
  const server5: FakeScanServer = await startFakeScanServer({
    checkState: () => ({ state: "unknown" }),
    putOutcome: () => ({ status: 200, body: { status: "accepted" } }),
  });
  const failure5 = await rejected(
    configure({
      serverUrlWithBox: `${server5.url}/newbox`,
      folder: "",
      disposition: "keep",
      name: "x",
      token: "t",
      configPath: configPath5,
      homeDir: join(dir, "home5"),
    }),
  );
  t.check(failure5, {
    name: "ConfigError",
    message: `Invalid config at ${configPath5}: targets[1].folder must be a non-empty string`,
  });

  t.check(JSON.parse(await readFile(configPath5, "utf-8")), goodConfig5);
});

// ## A bad token fails verification — files are left in place, both paths named
void test("A bad token fails verification — files are left in place, both paths named", async (t) => {
  t.teardown(async () => {
    try {
      await server6.close();
    } catch (error) {
      t.error(error);
    }
  });
  const server6: FakeScanServer = await startFakeScanServer({
    checkState: () => ({ state: "unknown" }),
    putOutcome: () => ({ status: 200, body: { status: "accepted" } }),
    checkAuthorization: (authorization) => authorization === "Bearer good-token",
  });
  const configPath6 = join(dir, "verify-fail", "scan-uploader.json");
  const homeDir6 = join(dir, "home6");
  const tokenPath6 = join(homeDir6, ".scan-tokens", "family.token");
  const failure6 = await rejected(
    configure({
      serverUrlWithBox: `${server6.url}/family`,
      folder: "/scans/family",
      disposition: "keep",
      name: "laptop-6",
      token: "wrong-token",
      configPath: configPath6,
      homeDir: homeDir6,
    }),
  );
  t.check(failure6, {
    name: "ConfigureError",
    message: `server verification failed for box "family": Unexpected response from ${server6.url}/family/api/scan/check: check returned HTTP 401 — server says: unauthorized — the config (${configPath6}) and token file (${tokenPath6}) were still written; fix the token and re-run configure with the same URL`,
  });


  // Both files were actually written, not just named in the message:

  t.check(await exists(configPath6), true);

  t.check(await exists(tokenPath6), true);

  t.check((await readFile(tokenPath6, "utf-8")).trim(), "wrong-token");
});

// ## Verification failure surfaces the server's own reason, not just the HTTP status
//
// When the server's error body carries a `reason` (e.g. a 503 explaining
// itself), that text rides all the way up through `checkHashes`'s
// `ProtocolError` into `configure()`'s own `ConfigureError` — the boxholder
// sees why, not just a bare status code they'd otherwise have to go curl the
// endpoint by hand to explain.
void test("When the server's error body carries a reason (e.g.", async (t) => {
  t.teardown(async () => {
    try {
      await server7.close();
      await removeTmpDir(dir);
    } catch (error) {
      t.error(error);
    }
  });
  const server7: FakeScanServer = await startFakeScanServer({
    checkState: () => ({ state: "unknown" }),
    putOutcome: () => ({ status: 200, body: { status: "accepted" } }),
    checkFailure: () => ({
      status: 503,
      body: { status: "server-error", reason: "box is not annex-converted; scan upload disabled" },
    }),
  });
  const configPath7 = join(dir, "verify-fail-reason", "scan-uploader.json");
  const homeDir7 = join(dir, "home7");
  const failure7 = await rejected(
    configure({
      serverUrlWithBox: `${server7.url}/family`,
      folder: "/scans/family",
      disposition: "keep",
      name: "laptop-7",
      token: "any-token",
      configPath: configPath7,
      homeDir: homeDir7,
    }),
  );
  t.check(failure7, {
    name: "ConfigureError",
    message: `server verification failed for box "family": Unexpected response from ${server7.url}/family/api/scan/check: check returned HTTP 503 — server says: box is not annex-converted; scan upload disabled — the config (${configPath7}) and token file (${join(homeDir7, ".scan-tokens", "family.token")}) were still written; fix the token and re-run configure with the same URL`,
  });
});
