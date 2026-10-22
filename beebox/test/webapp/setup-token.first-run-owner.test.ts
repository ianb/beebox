// # First-run setup stays silent once an owner exists
//
// `maybeArmFirstRunSetup` prints a one-time claim link so a brand-new server can
// have its owner account created. The gate used to be "zero local users", which is
// wrong for the deployment shape this project actually runs: an owner who signs in
// through Google OAuth has `BBX_OWNER_EMAIL` set and *no* local password account,
// so the local-user count is permanently zero. The link was therefore re-armed and
// re-printed on every restart — 105 times on the deployed server — while being
// unusable, since `POST /auth/setup` refuses to create an owner who doesn't match
// `BBX_OWNER_EMAIL`. The gate is now "no owner at all".

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, str } from "@ianbicking/tap-check/check";
import * as os from "node:os";
import * as path from "node:path";
import { rm, writeFile } from "node:fs/promises";
import { maybeArmFirstRunSetup } from "../../src/webapp/setup-token.js";

// Point the credential store at a path that does not exist, so there are zero
// local users in every case below — isolating the owner check as the variable.
const AUTH_FILE = path.join(os.tmpdir(), "bbx-first-run-setup-test-absent.json");
process.env.BBX_AUTH_FILE = AUTH_FILE;

function printedLines({ owner, openAccess }: { owner: string | null; openAccess: boolean }) {
  if (owner === null) delete process.env.BBX_OWNER_EMAIL;
  else process.env.BBX_OWNER_EMAIL = owner;
  const lines: string[] = [];
  const realLog = console.log;
  console.log = (...args: unknown[]) => lines.push(args.join(" "));
  try {
    maybeArmFirstRunSetup({ publicUrl: "https://box.example.com", openAccess });
  } finally {
    console.log = realLog;
  }
  return lines;
}

// ## An OAuth-only owner (no local account) prints nothing
//
// This is the deployed configuration, and the regression this test exists for.
void test("This is the deployed configuration, and the regression this test exists for.", async (t) => {
  t.teardown(async () => {
    try {
      await rm(AUTH_FILE, { force: true });
      delete process.env.BBX_AUTH_FILE;
      delete process.env.BBX_OWNER_EMAIL;
    } catch (error) {
      t.error(error);
    }
  });
  t.check(printedLines({ owner: "owner@example.com", openAccess: false }), []);

  // ## A genuinely unclaimed server still prints its claim link

  const lines = printedLines({ owner: null, openAccess: false });
  t.check(lines, [str`First-run setup: https://box.example.com/auth/setup?token=${any(String)}`]);

  // ## Open access never prints, owner or not
  //
  // There is no auth wall to claim past.

  t.check(printedLines({ owner: null, openAccess: true }), []);

  // ## Removing the last local member does not reopen first-run setup
  //
  // An initialized store keeps an empty file as a durable setup tombstone.

  await writeFile(AUTH_FILE, JSON.stringify({ version: 1, users: [] }), { mode: 0o600 });
  t.check(printedLines({ owner: null, openAccess: false }), []);
});
