/**
 * Unit-host checks of `host-audit-users.ts` against a temp fixture tree. The
 * fixture's own uid/gid stand in for `bbx-<slug>` through injected passwd and
 * group text.
 *
 *   node --import tsx --test schedules/cross-box-leak-scan/host-audit-users.test.ts
 */

import assert from "node:assert/strict";
import { after, test } from "node:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { checkBoxEnvSecrets, checkBoxUserLayout, isUnitHost } from "./host-audit-users.js";

const tempDirs: string[] = [];

after(async () => {
  for (const dir of tempDirs) await fs.rm(dir, { recursive: true, force: true });
});

const uid = process.getuid?.() ?? 0;
const gid = process.getgid?.() ?? 0;
const passwd = `bbx-a:x:${uid}:${gid}::/var/lib/beebox/a:/bin/false\nbeebox:x:${uid}:${gid}::/opt/beebox:/bin/false\n`;
const group = `bbx-a:x:${gid}:\n`;

async function fixture(): Promise<{ homeRoot: string; secrets: string; boxes: { slug: string; root: string }[] }> {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "unit-host-"));
  tempDirs.push(base);
  const homeRoot = path.join(base, "lib");
  const root = path.join(homeRoot, "a", "box");
  await fs.mkdir(path.join(root, ".beebox"), { recursive: true });
  await fs.mkdir(path.join(root, "notes"), { mode: 0o700 });
  await fs.writeFile(path.join(root, "card.md"), "x", { mode: 0o600 });
  await fs.writeFile(path.join(root, ".beebox", "hub-meta.json"), "{}", { mode: 0o644 });
  await fs.writeFile(path.join(root, ".beebox", "state.json"), "{}", { mode: 0o600 });
  await fs.writeFile(path.join(homeRoot, "a", ".profile"), "x", { mode: 0o600 });
  for (const dir of [path.join(homeRoot, "a"), root, path.join(root, ".beebox"), path.join(root, "notes")]) {
    await fs.chmod(dir, dir.endsWith("notes") ? 0o700 : 0o751);
  }
  const secrets = path.join(base, "run");
  await fs.mkdir(secrets);
  await fs.writeFile(path.join(secrets, "a.hub-secret"), "s", { mode: 0o600 });
  return { homeRoot, secrets, boxes: [{ slug: "a", root }] };
}

test("checkBoxUserLayout: a conforming layout has no findings", async () => {
  const f = await fixture();
  const debug: string[] = [];
  assert.deepEqual(await checkBoxUserLayout(f.boxes, { passwd, group, homeRoot: f.homeRoot, hubSecretDir: f.secrets, debug: (m) => debug.push(m) }), []);
  assert.deepEqual(debug, []);
});

test("checkBoxUserLayout: reports each deviation with its path", async () => {
  const f = await fixture();
  const home = path.join(f.homeRoot, "a");
  const root = path.join(home, "box");
  await fs.chmod(home, 0o755);
  await fs.chmod(path.join(root, ".beebox"), 0o700);
  await fs.chmod(path.join(root, "card.md"), 0o644);
  await fs.chmod(path.join(home, ".profile"), 0o640);
  await fs.chmod(path.join(root, ".beebox", "state.json"), 0o604);
  await fs.chmod(path.join(root, ".beebox", "hub-meta.json"), 0o600);
  await fs.chmod(path.join(f.secrets, "a.hub-secret"), 0o640);
  const findings = await checkBoxUserLayout(f.boxes, { passwd, group, homeRoot: f.homeRoot, hubSecretDir: f.secrets });
  assert.deepEqual(findings, [
    { path: home, message: "mode 0755, expected 0751" },
    { path: path.join(root, ".beebox"), message: "mode 0700, expected 0751" },
    { path: path.join(home, ".profile"), message: "mode 0640, expected 0600 (group/other accessible)" },
    { path: path.join(root, "card.md"), message: "mode 0644, expected 0600 (group/other accessible)" },
    { path: path.join(root, ".beebox", "hub-meta.json"), message: "mode 0600, expected 0644" },
    { path: path.join(root, ".beebox", "state.json"), message: "mode 0604, group/other readable; only hub-meta.json may be" },
    { path: path.join(f.secrets, "a.hub-secret"), message: "mode 0640, expected 0600" },
  ]);
});

test("checkBoxUserLayout: wrong owner, missing users, absent hub secret", async () => {
  const f = await fixture();
  await fs.rm(path.join(f.secrets, "a.hub-secret"));
  const debug: string[] = [];
  const other = `bbx-a:x:${uid + 1}:${gid + 1}::/:/bin/false\n`;
  const findings = await checkBoxUserLayout(f.boxes, { passwd: other, group: `bbx-a:x:${gid + 1}:\n`, homeRoot: f.homeRoot, hubSecretDir: f.secrets, debug: (m) => debug.push(m) });
  const home = path.join(f.homeRoot, "a");
  const owner = (p: string): { path: string; message: string } => ({
    path: p,
    message: `owned by ${uid}:${gid}, expected bbx-a (${uid + 1}:${gid + 1})`,
  });
  assert.deepEqual(findings, [owner(home), owner(path.join(home, "box")), owner(path.join(home, "box", ".beebox"))]);
  assert.deepEqual(debug, [`${path.join(f.secrets, "a.hub-secret")} absent; the hub has not run yet`]);
});

test("checkBoxUserLayout: boxes outside the unit home root are skipped, and are not a unit host", async () => {
  const f = await fixture();
  const boxes = [{ slug: "old", root: "/Users/x/boxes/old" }];
  assert.deepEqual(await checkBoxUserLayout(boxes, { passwd, group, homeRoot: f.homeRoot }), []);
  assert.equal(isUnitHost(boxes, f.homeRoot), false);
  assert.equal(isUnitHost(f.boxes, f.homeRoot), true);
});

test("checkBoxEnvSecrets: flags secret and key names except VAPID and APNs keys", async () => {
  const f = await fixture();
  const file = path.join(path.dirname(f.homeRoot), "box.env");
  await fs.writeFile(
    file,
    [
      "# BBX_HUB_SECRET=commented",
      "BBX_VAPID_PUBLIC_KEY=a",
      "BBX_VAPID_PRIVATE_KEY=b",
      "BBX_APNS_KEY_ID=c",
      "BBX_SESSION_SECRET=d",
      "export BBX_HUB_SECRET=e",
      "STRIPE_API_KEY=f",
      "OTHER_SECRET=g",
      "BBX_PORT=1",
      "",
    ].join("\n"),
  );
  assert.deepEqual(await checkBoxEnvSecrets(file), [
    { path: file, message: "line 5: BBX_SESSION_SECRET must not be in the shared box environment" },
    { path: file, message: "line 6: BBX_HUB_SECRET must not be in the shared box environment" },
    { path: file, message: "line 7: STRIPE_API_KEY must not be in the shared box environment" },
    { path: file, message: "line 8: OTHER_SECRET must not be in the shared box environment" },
  ]);
  assert.deepEqual(await checkBoxEnvSecrets(path.join(path.dirname(file), "absent.env")), []);
});
