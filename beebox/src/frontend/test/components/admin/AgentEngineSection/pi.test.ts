// # pi in the admin engine section
//
// pi can be chosen only once the box has an added OpenRouter model and the
// key; the section names whichever is missing, in readiness order.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { piDefaultFor, piMissing } from "../../../../src/components/admin/AgentEngineSection/pi.js";

const added = [{ id: "acme/one", label: "One" }, { id: "acme/two", label: "Two" }];

void test("names what pi lacks, and the default a switch saves", async (t) => {
  t.check([
    piMissing({ added: [], keyGranted: false }),
    piMissing({ added, keyGranted: false }),
    piMissing({ added, keyGranted: true, piDefault: "opus" }),
    piMissing({ added, keyGranted: true, piDefault: "acme/two" }),
  ], [
    "Needs a model added under OpenRouter models.",
    "Needs an OpenRouter key, set and granted under Secrets.",
    "Needs a default model chosen from the added OpenRouter models.",
    null,
  ]);
  t.check([piDefaultFor("acme/two", added), piDefaultFor("opus", added), piDefaultFor(null, [])], ["acme/two", "acme/one", null]);
});
