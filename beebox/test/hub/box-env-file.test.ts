// # The env file every box unit loads
//
// `renderBoxEnvFile` (`src/hub/box-env-file.ts`) passes the hub's env through
// the child allowlist, drops what systemd or the box user's home supplies,
// and appends the host-wide cache paths; `loadOrMintHubSecrets`
// (`src/hub/secrets.ts`) mints one secret per box and reads it back.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, not } from "@ianbicking/tap-check/check";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderBoxEnvFile } from "../../src/hub/box-env-file.js";
import { hubSecretPath, loadOrMintHubSecrets } from "../../src/hub/secrets.js";

void test("the allowlist passes, per-box and hub-only names stay out, host paths are appended", async (t) => {
  const rendered = renderBoxEnvFile({
    BBX_PUBLIC_URL: "https://box.example.com",
    BBX_OWNER_EMAIL: "owner@example.com",
    BBX_VAPID_SUBJECT: "mailto:owner@example.com",
    // Never: a hub-only secret, the per-box store path, the hub's own PATH and HOME.
    BBX_SESSION_SECRET: "hub-only",
    BBX_SECRETS_FILE: "/home/beebox/.config/beebox/secrets.json",
    PATH: "/home/beebox/.local/bin:/usr/bin",
    HOME: "/home/beebox",
    CLAUDE_CONFIG_DIR: "/home/beebox/.claude",
    UNRELATED: "x",
  });
  t.check(rendered.split("\n").filter((line) => !line.startsWith("#")), [
    'BBX_OWNER_EMAIL="owner@example.com"',
    'BBX_PUBLIC_URL="https://box.example.com"',
    'BBX_VAPID_SUBJECT="mailto:owner@example.com"',
    'BBX_UNIT_HOST="1"',
    'PATH="/usr/local/bin:/usr/bin:/bin"',
    'UV_CACHE_DIR="/var/cache/beebox/uv"',
    'HF_HOME="/var/cache/beebox/hf"',
    "",
  ]);
});

void test("one secret per box, 0600, read back on the next start", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "bbx-hubsec-"));
  const first = loadOrMintHubSecrets(["a", "b"], dir);
  t.check([...first.keys()], ["a", "b"]);
  t.check(first.get("b"), not(first.get("a")));
  t.check((await stat(hubSecretPath(dir, "a"))).mode & 0o777, 0o600);
  t.check(await readFile(hubSecretPath(dir, "a"), "utf8"), `${first.get("a") ?? ""}\n`);
  // A hub-only restart: the same secrets, a new box minted beside them.
  const second = loadOrMintHubSecrets(["a", "b", "c"], dir);
  t.check({ a: second.get("a"), b: second.get("b"), c: second.get("c") }, { a: first.get("a"), b: first.get("b"), c: any(String) });
});
