// # Admin: Codex device authentication
//
// The Admin API exposes Codex's device-code ceremony without sending credentials
// through Bee Box. Codex owns token persistence; the browser receives only the
// verification URL and short-lived user code.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { appRouter } from "../../../../src/webapp/trpc/routers.js";
import { createFakeCodexCli } from "../../../../src/services/codex-cli/core.js";
import { checkCodexAuth, resetCodexAuthCache } from "../../../../src/core/agent/auth-preflight.js";
import type { TrpcContext } from "../../../../src/webapp/trpc/context.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";
import { trpcContext } from "../../../helpers/trpc-context.js";

void test("line 16", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L17
  const box = await makeTmpBox({ git: true });
  const codexCli = createFakeCodexCli({ status: { kind: "logged-out" } });
  const ctx: TrpcContext = trpcContext({
    boxRoot: box.root,
    services: { codexCli },
    user: { email: "owner@example.com", name: "Owner" },
  });
  const admin = appRouter.createCaller(ctx).admin;

  // Starting login returns the provider-owned verification destination and code.
  // It does not make the account appear authenticated before Codex completes the
  // flow.

  // doctest:L32
  const started = await admin.codexLogin();
  const status = await admin.codexStatus();
  t.check([started.verificationUrl, started.userCode, codexCli.loginPending, status.kind], [
    "https://auth.openai.com/codex/device",
    "ABCD-1234",
    true,
    "logged-out",
  ]);

  // Cancellation ends the pending ceremony, and logout clears authenticated state.

  // doctest:L41
  await admin.codexCancelLogin();
  t.check(codexCli.loginPending, false);

  // doctest:L45
  codexCli.status = { kind: "logged-in" };
  const loggedOut = await admin.codexLogout();
  const afterLogout = await admin.codexStatus();
  t.check([loggedOut.success, afterLogout.kind], [
    true,
    "logged-out",
  ]);

  // Logout also invalidates the run-path's positive authentication cache. A chat
  // after logout probes again and sees the logout instead of running on a stale
  // ten-minute success.

  // doctest:L57
  resetCodexAuthCache();
  codexCli.status = { kind: "logged-in" };
  await checkCodexAuth({ codexCli });
  await admin.codexLogout();
  t.check(await checkCodexAuth({ codexCli }).then(() => "ready", (error) => error.name), "CodexAuthError");
});
