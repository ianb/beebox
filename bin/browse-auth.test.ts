import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { authCookieArgs, type WorktreeContext } from "../browse/src/worktree.js";

const ORIGINAL_KEY = process.env["CB_BROWSE_API_KEY"];
const CONTEXT: WorktreeContext = {
  repoDir: "/repo",
  worktree: "example",
  box: "test1",
  port: 3210,
  routerBase: "http://localhost:3210/example/test1",
};

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env["CB_BROWSE_API_KEY"];
  else process.env["CB_BROWSE_API_KEY"] = ORIGINAL_KEY;
});

test("browse auth seeds a short-lived, host-only browser cookie", () => {
  process.env["CB_BROWSE_API_KEY"] = "test-key";
  const before = Math.floor(Date.now() / 1000) + 30 * 60;
  const args = authCookieArgs(`${CONTEXT.routerBase}/chat`, CONTEXT);
  const after = Math.floor(Date.now() / 1000) + 30 * 60;
  assert.deepEqual(args?.slice(0, -1), [
    "cookies", "set", "cb_browse_key", "test-key",
    "--url", "http://localhost:3210",
    "--path", "/",
    "--httpOnly",
    "--sameSite", "Strict",
    "--expires",
  ]);
  const expires = Number(args?.at(-1));
  assert.ok(expires >= before && expires <= after);
});

test("browse auth never seeds a cookie for another origin", () => {
  process.env["CB_BROWSE_API_KEY"] = "test-key";
  assert.throws(
    () => authCookieArgs("https://example.com/", CONTEXT),
    /Refusing to seed browse auth for another origin/
  );
});

test("an absent browse key expires a previously seeded cookie", () => {
  delete process.env["CB_BROWSE_API_KEY"];
  const args = authCookieArgs(`${CONTEXT.routerBase}/chat`, CONTEXT);
  assert.equal(args[3], "");
  assert.deepEqual(args.slice(-2), ["--expires", "1"]);
});
