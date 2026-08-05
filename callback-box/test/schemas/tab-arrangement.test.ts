import t from "tap";
import { parseFrontmatterObject } from "../../src/cards/index.js";
import {
  arrangementIssues,
  createTabArrangementCard,
} from "../../src/schemas/tab-arrangement.js";

const pinned = "20000000-0000-4000-8000-000000000000";
const other = "30000000-0000-4000-8000-000000000000";
const sourceWindowId = "10000000-0000-4000-8000-000000000000";
const source = {
  windows: [{
    id: sourceWindowId,
    tabs: [
      { id: pinned, title: "Pinned", url: "https://a.example", pinned: true },
      { id: other, title: "Other", url: "https://b.example", pinned: false },
    ],
  }],
};

t.test("tab arrangement proposal is an exact identity partition", (st) => {
  st.same(arrangementIssues({
    source,
    proposal: { windows: [{ id: "40000000-0000-4000-8000-000000000000", tabs: [pinned] }], close: [other] },
  }), []);
  st.match(arrangementIssues({
    source,
    proposal: { windows: [{ id: "40000000-0000-4000-8000-000000000000", tabs: [other, pinned] }], close: [] },
  }).map((issue) => issue.message), [/pinned tab/]);
  st.match(arrangementIssues({
    source,
    proposal: { windows: [{ id: "40000000-0000-4000-8000-000000000000", tabs: [pinned] }], close: [] },
  }).map((issue) => issue.message), [/omits source tab/]);
  st.end();
});

t.test("createTabArrangementCard writes the immutable transfer fields and draft status", (st) => {
  const card = createTabArrangementCard({
    transferId: "00000000-0000-4000-8000-000000000000",
    scope: "current-window",
    capturedAt: "2026-08-04T12:00:00.000Z",
    source,
    proposal: { windows: [{ id: sourceWindowId, tabs: [pinned, other] }], close: [] },
  });
  const fields = parseFrontmatterObject(card);
  st.equal(fields?.["transfer-id"], "00000000-0000-4000-8000-000000000000");
  st.equal(fields?.["status"], "draft");
  st.same(fields?.["source"], source);
  st.end();
});
