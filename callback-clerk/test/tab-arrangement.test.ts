import { test } from "tap";
import type { TabArrangementPayload } from "../src/contract/clerk-contract.generated.js";
import { sourceProposal, validateProposal } from "../src/domain/tab-arrangement.js";

const payload: TabArrangementPayload = {
  transferId: "00000000-0000-4000-8000-000000000000",
  scope: "current-window",
  capturedAt: "2026-08-04T12:00:00.000Z",
  source: {
    windows: [{
      id: "10000000-0000-4000-8000-000000000000",
      tabs: [
        { id: "20000000-0000-4000-8000-000000000000", title: "Pinned", url: "https://a.example", pinned: true },
        { id: "30000000-0000-4000-8000-000000000000", title: "Other", url: "https://b.example", pinned: false },
      ],
    }],
  },
  proposal: { windows: [], close: [] },
};

test("sourceProposal preserves source window and tab identity", async (t) => {
  t.same(sourceProposal(payload), {
    windows: [{
      id: "10000000-0000-4000-8000-000000000000",
      tabs: ["20000000-0000-4000-8000-000000000000", "30000000-0000-4000-8000-000000000000"],
    }],
    close: [],
  });
});

test("validateProposal enforces an exact tab partition and pinned prefix", async (t) => {
  t.equal(validateProposal(payload, sourceProposal(payload)), null);
  t.match(validateProposal(payload, {
    windows: [{ id: "new", tabs: ["30000000-0000-4000-8000-000000000000"] }],
    close: [],
  }), /exactly once/);
  t.match(validateProposal(payload, {
    windows: [{
      id: "new",
      tabs: ["30000000-0000-4000-8000-000000000000", "20000000-0000-4000-8000-000000000000"],
    }],
    close: [],
  }), /Pinned tabs/);
});
