// # Native location sharing consent
//
// The native composer controls the same per-box standing location preference as
// the web composer. Reading the state never captures location; toggling on must
// capture successfully before reporting enabled; toggling off captures nothing
// and persists the disabled state.

import { test } from "tap";
import "agent-doctest/tap";
import {
  handleNativeLocationRequest,
  postNativeLocationState,
  type NativeLocationBridgeDependencies,
  type NativeLocationResult,
} from "../../../../src/components/chat/everywhere/InteractiveChat/use-native-bridge.js";
import type { NativeShellWindow } from "../../../../src/components/chat/native-post.js";

function bridgeHarness(initialEnabled: boolean) {
  let captures = 0;
  const saved: Parameters<NativeLocationBridgeDependencies["saveState"]>[1][] = [];
  const results: NativeLocationResult[] = [];
  const dependencies: NativeLocationBridgeDependencies = {
    isAvailable: () => true,
    loadState: () => ({ enabled: initialEnabled, lastCapturedAt: initialEnabled ? 100 : null }),
    saveState: (_boxSlug, state) => saved.push(state),
    captureAndStore: async () => { captures += 1; },
    now: () => 200,
    postResult: (result) => results.push(result),
  };
  return { dependencies, get captures() { return captures; }, saved, results };
}

// ## Initial state synchronization is read-only
void test("Initial state synchronization is read-only", async (t) => {
  // doctest:L36
  const statePosts: string[] = [];
  const shell: NativeShellWindow = { beeboxNativePost: (_channel, payload) => statePosts.push(payload) };
  postNativeLocationState(false, shell);
  t.check(statePosts, ['{"enabled":false}']);
});

// ## Toggle on captures before enabling
void test("Toggle on captures before enabling", async (t) => {
  // doctest:L46
  const enabling = bridgeHarness(false);
  await handleNativeLocationRequest(
    { id: "22222222-2222-2222-2222-222222222222", action: "toggle" },
    { boxSlug: "test1", dependencies: enabling.dependencies },
  );
  t.check({ captures: enabling.captures, saved: enabling.saved, result: enabling.results[0] }, {
    captures: 1,
    saved: [],
    result: {
      id: "22222222-2222-2222-2222-222222222222",
      success: true,
      enabled: true,
      message: "Location sharing is on.",
    },
  });
});

// ## Toggle off does not capture
void test("Toggle off does not capture", async (t) => {
  // doctest:L58
  const disabling = bridgeHarness(true);
  await handleNativeLocationRequest(
    { id: "33333333-3333-3333-3333-333333333333", action: "toggle" },
    { boxSlug: "test1", dependencies: disabling.dependencies },
  );
  t.check({ captures: disabling.captures, saved: disabling.saved, result: disabling.results[0] }, {
    captures: 0,
    saved: [
      {
        enabled: false,
        lastCapturedAt: null,
      },
    ],
    result: {
      id: "33333333-3333-3333-3333-333333333333",
      success: true,
      enabled: false,
      message: "Location sharing is off.",
    },
  });
});
