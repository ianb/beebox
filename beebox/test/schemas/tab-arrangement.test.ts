import t from "tap";
import { parseFrontmatterObject } from "../../src/exports/cards.js";
import {
  arrangementIssues,
  createTabArrangementCard,
} from "../../src/schemas/tab-arrangement.js";

const pinned = "20000000-0000-4000-8000-000000000000";
const other = "30000000-0000-4000-8000-000000000000";
const sourceWindowId = "10000000-0000-4000-8000-000000000000";
const capturedTabs = {
  windows: [{
    id: sourceWindowId,
    tabs: [
      { id: pinned, title: "Pinned", url: "https://a.example", pinned: true },
      { id: other, title: "Other", url: "https://b.example", pinned: false },
    ],
  }],
};

t.test("tab arrangement proposal keeps deleted tabs in their window positions", (st) => {
  st.same(arrangementIssues({
    capturedTabs,
    proposal: { windows: [{ id: "40000000-0000-4000-8000-000000000000", tabs: [pinned, other] }], close: [other] },
  }), []);
  st.same(arrangementIssues({
    capturedTabs,
    proposal: { windows: [{ id: "40000000-0000-4000-8000-000000000000", tabs: [pinned] }], close: [other] },
  }), [], "legacy partition cards remain valid");
  st.match(arrangementIssues({
    capturedTabs,
    proposal: { windows: [{ id: "40000000-0000-4000-8000-000000000000", tabs: [other, pinned] }], close: [] },
  }).map((issue) => issue.message), [/pinned tab/]);
  st.match(arrangementIssues({
    capturedTabs,
    proposal: { windows: [{ id: "40000000-0000-4000-8000-000000000000", tabs: [pinned] }], close: [] },
  }).map((issue) => issue.message), [/every captured tab/]);
  st.match(arrangementIssues({
    capturedTabs,
    proposal: { windows: [{ id: "40000000-0000-4000-8000-000000000000", tabs: [pinned, other] }], close: [pinned, other] },
  }).map((issue) => issue.message), [/at least one tab/]);
  st.end();
});

t.test("createTabArrangementCard writes the immutable transfer fields as a draft", (st) => {
  const card = createTabArrangementCard({
    transferId: "00000000-0000-4000-8000-000000000000",
    scope: "current-window",
    capturedAt: "2026-08-04T12:00:00.000Z",
    source: capturedTabs,
    proposal: { windows: [{ id: sourceWindowId, tabs: [pinned, other] }], close: [] },
  });
  const fields = parseFrontmatterObject(card);
  st.equal(fields?.["transfer-id"], "00000000-0000-4000-8000-000000000000");
  st.equal(fields?.["ready"], undefined);
  st.same(fields?.["captured-tabs"], capturedTabs);
  st.end();
});
