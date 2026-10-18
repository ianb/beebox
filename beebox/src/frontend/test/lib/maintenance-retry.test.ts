// # Waiting out a maintenance refusal
//
// A box closed for maintenance answers a chat send with 503 and, when it knows
// its drain deadline, `Retry-After` in seconds. The client parks the message for
// that long and sends once more; without a usable deadline it fails as before.

import { test } from "tap";
import "agent-doctest/tap";
import { maintenanceRetryDelayMs } from "../../src/lib/maintenance-retry.js";

void test("line 11", async (t) => {
  // doctest:L12
  t.check(maintenanceRetryDelayMs("90"), 90000);

  // doctest:L15
  t.check(
    // Below the floor, still a real wait: never a hot retry loop.
    maintenanceRetryDelayMs("0"),
    1000,
  );

  // doctest:L19
  t.check(
    // No header, or one that is not a number of seconds: no retry.
    maintenanceRetryDelayMs(null),
    null,
  );

  // doctest:L23
  t.check(maintenanceRetryDelayMs("Wed, 21 Oct 2026 07:28:00 GMT"), null);

  // doctest:L26
  t.check(
    // Longer than the gate's own drain limit is not worth parking a message on.
    maintenanceRetryDelayMs("601"),
    null,
  );
});
