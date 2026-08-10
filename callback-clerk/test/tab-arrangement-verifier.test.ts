import { test } from "tap";
import type { StoredTabTransfer } from "../src/domain/tab-arrangement.js";
import {
  compareBeforeClose,
  compareClosedTabs,
  compareProposalSnapshot,
} from "../src/platform/tab-arrangement-verifier.js";

const keptId = "20000000-0000-4000-8000-000000000000";
const deletedId = "30000000-0000-4000-8000-000000000000";
const proposal = {
  windows: [{ id: "10000000-0000-4000-8000-000000000000", tabs: [keptId, deletedId] }],
  close: [deletedId],
};
const transfer: StoredTabTransfer = {
  version: 1,
  browserSessionId: "browser-session",
  boxUrl: "https://box.example",
  openUrl: "https://box.example/card",
  payload: {
    transferId: "00000000-0000-4000-8000-000000000000",
    scope: "current-window",
    capturedAt: "2026-08-10T12:00:00.000Z",
    source: { windows: [{
      id: "10000000-0000-4000-8000-000000000000",
      tabs: [
        { id: keptId, title: "Keep", url: "https://keep.example", pinned: false },
        { id: deletedId, title: "Delete", url: "https://delete.example", pinned: false },
      ],
    }] },
    proposal,
  },
  locations: {
    [keptId]: { tabId: 11, windowId: 7 },
    [deletedId]: { tabId: 12, windowId: 7 },
  },
  state: "ready",
};

test("annotated deletion verifies full layout before close and survivors afterward", async (t) => {
  let deletedTabStillExists = true;
  let liveTabs = [
    { id: 11, url: "https://keep.example", pinned: false, groupId: -1 },
    { id: 12, url: "https://delete.example", pinned: false, groupId: -1 },
  ];
  Object.defineProperty(globalThis, "chrome", {
    value: {
      tabs: { query: async () => deletedTabStillExists ? liveTabs : [liveTabs[0]] },
      windows: { getAll: async () => [{ id: 7, incognito: false }] },
    },
    configurable: true,
  });
  t.teardown(() => { Reflect.deleteProperty(globalThis, "chrome"); });

  t.equal(await compareBeforeClose({ transfer, locations: transfer.locations, proposal }), null);
  t.match(await compareClosedTabs(transfer.locations, proposal), /remained open/);
  deletedTabStillExists = false;
  liveTabs = [{ id: 11, url: "https://keep.example", pinned: false, groupId: -1 }];
  t.equal(await compareClosedTabs(transfer.locations, proposal), null);
  t.equal(await compareProposalSnapshot(transfer, proposal), null);
});
