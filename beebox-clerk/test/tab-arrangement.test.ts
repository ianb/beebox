import { test } from "tap";
import type { TabArrangementPayload } from "../src/contract/clerk-contract.generated.js";
import {
  normalizeProposal,
  openProposal,
  sourceProposal,
  validateProposal,
} from "../src/domain/tab-arrangement.js";

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

test("validateProposal accepts annotated deletion and enforces window identity", async (t) => {
  t.equal(validateProposal(payload, sourceProposal(payload)), null);
  t.equal(validateProposal(payload, {
    windows: [{
      id: "new",
      tabs: ["20000000-0000-4000-8000-000000000000", "30000000-0000-4000-8000-000000000000"],
    }],
    close: ["30000000-0000-4000-8000-000000000000"],
  }), null);
  t.match(validateProposal(payload, {
    windows: [{ id: "new", tabs: ["30000000-0000-4000-8000-000000000000"] }],
    close: [],
  }), /exactly one proposed window/);
  t.match(validateProposal(payload, {
    windows: [{
      id: "new",
      tabs: ["30000000-0000-4000-8000-000000000000", "20000000-0000-4000-8000-000000000000"],
    }],
    close: [],
  }), /Pinned tabs/);
  t.match(validateProposal(payload, {
    windows: [{
      id: "new",
      tabs: ["20000000-0000-4000-8000-000000000000", "30000000-0000-4000-8000-000000000000"],
    }],
    close: ["20000000-0000-4000-8000-000000000000", "30000000-0000-4000-8000-000000000000"],
  }), /At least one tab/);
});

test("normalizeProposal restores legacy deleted tabs near their source position", async (t) => {
  const legacy = {
    windows: [{ id: "new", tabs: ["30000000-0000-4000-8000-000000000000"] }],
    close: ["20000000-0000-4000-8000-000000000000"],
  };
  t.equal(validateProposal(payload, legacy), null, "legacy partition remains valid");
  const normalized = normalizeProposal(payload, legacy);
  t.same(normalized, {
    windows: [{
      id: "new",
      tabs: ["20000000-0000-4000-8000-000000000000", "30000000-0000-4000-8000-000000000000"],
    }],
    close: ["20000000-0000-4000-8000-000000000000"],
  });
  t.same(openProposal(normalized), {
    windows: [{ id: "new", tabs: ["30000000-0000-4000-8000-000000000000"] }],
    close: [],
  });
});

test("legacy deleted tabs follow their nearest surviving source neighbor", async (t) => {
  const thirdId = "40000000-0000-4000-8000-000000000000";
  const fourthId = "50000000-0000-4000-8000-000000000000";
  const sourceWindow = payload.source.windows.at(0);
  if (sourceWindow === undefined) {
    t.fail("The test payload needs a source window.");
    return;
  }
  const extended: TabArrangementPayload = {
    ...payload,
    source: { windows: [{
      ...sourceWindow,
      tabs: [
        ...sourceWindow.tabs,
        { id: thirdId, title: "Third", url: "https://c.example", pinned: false },
        { id: fourthId, title: "Fourth", url: "https://d.example", pinned: false },
      ],
    }] },
  };
  const normalized = normalizeProposal(extended, {
    windows: [
      { id: "left", tabs: ["20000000-0000-4000-8000-000000000000"] },
      { id: "right", tabs: [fourthId] },
    ],
    close: ["30000000-0000-4000-8000-000000000000", thirdId],
  });
  t.same(normalized.windows, [
    { id: "left", tabs: ["20000000-0000-4000-8000-000000000000", "30000000-0000-4000-8000-000000000000"] },
    { id: "right", tabs: [thirdId, fourthId] },
  ]);
});
