// # Inventory and Admin card state

import { test } from "tap";
import "agent-doctest/tap";
import { parseInventoryCardState } from "../../src/lib/inventory-card-state.js";
import { adminArrivalKey, adminArrivalReceipt, adminArrivalViewState, adminTabViewState, clearAdminArrivalState, parseAdminCardState, shouldAcknowledgeAdminArrival, shouldConsumeAdminArrival } from "../../src/lib/admin-card-state.js";
import { boxRouteSurface } from "../../src/lib/box-route-layout.js";
import { captureModeForRequest } from "../../src/lib/capture-intent.js";

void test("line 10", async (t) => {
  // doctest:L11
  t.check(parseInventoryCardState(null), {
    ok: true,
    state: {
      projection: "grouped",
      metric: "count",
      linkStatus: "all",
    },
  });

  // doctest:L14
  t.check(parseInventoryCardState({ projection: "direct", metric: "bytes", linkStatus: "unlinked" }), {
    ok: true,
    state: {
      projection: "direct",
      metric: "bytes",
      linkStatus: "unlinked",
    },
  });

  // doctest:L17
  t.check(parseInventoryCardState({ projection: "other" }), { ok: false, error: "Invalid Storage view state. Reset the controls to continue." });
});

// Only recognized OAuth return fields, a known tab, and a known section to land
// on (a notification's `admin:<section>` target) become renderer state.
// Authorization codes remain backend-only, and consuming the arrival keeps the
// open tab and any unrelated future Admin state.
void test("Only recognized OAuth return fields, a known tab, and a known section to land...", async (t) => {
  // doctest:L27
  t.check(adminArrivalViewState({ google: "error", message: "Denied", reconnect: "google", code: "secret", session: "chosen", tab: "connections" }), {
    google: "error",
    message: "Denied",
    reconnect: "google",
    tab: "connections",
  });

  // doctest:L30
  t.check(adminArrivalViewState({ tab: "nowhere" }), null);

  // doctest:L33
  t.check(parseAdminCardState({ google: "connected", message: "Ready" }), {
    ok: true,
    arrival: {
      google: "connected",
      message: "Ready",
    },
    tab: null,
    section: null,
  });

  // doctest:L36
  t.check(parseAdminCardState({ tab: "host" }), {
    ok: true,
    arrival: {},
    tab: "host",
    section: null,
  });

  // doctest:L39
  t.check(parseAdminCardState({ google: "maybe" }), { ok: false, error: "Invalid Admin arrival state." });

  // doctest:L42
  t.check(parseAdminCardState({ tab: "nowhere" }), { ok: false, error: "Invalid Admin arrival state." });

  // doctest:L45
  t.check(parseAdminCardState({ section: "google-services" }), {
    ok: true,
    arrival: {},
    tab: null,
    section: "google-services",
  });

  // doctest:L48
  t.check(parseAdminCardState({ section: "nowhere" }), { ok: false, error: "Invalid Admin arrival state." });

  // doctest:L51
  t.check(clearAdminArrivalState({ google: "error", message: "Denied", reconnect: "google", tab: "host", panel: "future" }), {
    tab: "host",
    panel: "future",
  });

  // doctest:L54
  t.check(clearAdminArrivalState({ reconnect: "google" }), {
    tab: "connections",
  });

  // doctest:L57
  t.check(clearAdminArrivalState({ panel: "future" }), {
    panel: "future",
  });

  // doctest:L60
  t.check(adminTabViewState({ google: "connected" }, "people"), {
    google: "connected",
    tab: "people",
  });

  // doctest:L63
  t.check(adminTabViewState(null, "people"), {
    tab: "people",
  });
});

// A hidden retained Admin card and an in-flight status request cannot consume the
// arrival. Clearing the target resets the processed key, so an identical later
// OAuth return is handled again.
void test("A hidden retained Admin card and an in-flight status request cannot consume t...", async (t) => {
  // doctest:L72
  const arrival = { google: "error", message: "Denied" } as const;
  const key = adminArrivalKey(arrival);
  t.check(shouldConsumeAdminArrival({ arrival, visible: false, loading: false, alreadyProcessed: false }), false);

  // doctest:L77
  t.check(shouldConsumeAdminArrival({ arrival, visible: true, loading: true, alreadyProcessed: false }), false);

  // doctest:L80
  t.check(shouldConsumeAdminArrival({ arrival, visible: true, loading: false, alreadyProcessed: false }), true);

  // doctest:L83
  t.check(adminArrivalReceipt(7, arrival), '7:{"google":"error","message":"Denied"}');

  // doctest:L86
  t.check(adminArrivalReceipt(8, arrival), '8:{"google":"error","message":"Denied"}');

  // doctest:L89
  t.check(shouldConsumeAdminArrival({ arrival, visible: true, loading: false, alreadyProcessed: key !== null }), false);

  // doctest:L92
  t.check(shouldAcknowledgeAdminArrival({ arrival, visible: true, loading: false }), true);
});

// Dev fixtures are the only box paths classified outside product runtime.
void test("Dev fixtures are the only box paths classified outside product runtime.", async (t) => {
  // doctest:L99
  t.check([boxRouteSurface("/dev/speech"), boxRouteSurface("/dev/capture-mode"), boxRouteSurface("/dev/theme-studio"), boxRouteSurface("/views/_config/interface/admin.card"), boxRouteSurface("/unknown")], [
    "dev-harness",
    "dev-harness",
    "dev-harness",
    "product",
    "product",
  ]);
});

// A later capture request reopens a retained chat runtime; absence of a request
// does not itself close capture mode.
void test("A later capture request reopens a retained chat runtime; absence of a request...", async (t) => {
  // doctest:L107
  t.check([captureModeForRequest(false, true), captureModeForRequest(true, true), captureModeForRequest(true, false), captureModeForRequest(false, false)], [
    true,
    true,
    true,
    false,
  ]);
});
