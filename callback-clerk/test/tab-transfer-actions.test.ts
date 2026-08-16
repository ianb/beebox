import { test } from "tap";
import { shareTabs } from "../src/platform/tab-transfer-actions.js";

test("shareTabs saves the transfer before opening its organizer in a tab", async (t) => {
  const events: string[] = [];
  let openedWith: chrome.tabs.CreateProperties | undefined;
  const fakeChrome = {
    storage: {
      local: {
        get: async () => ({}),
        set: async () => { events.push("saved"); },
      },
      session: {
        get: async () => ({ tabTransferBrowserSession: "browser-session" }),
        set: async () => {},
      },
    },
    tabs: {
      create: async (createProperties: chrome.tabs.CreateProperties) => {
        events.push("opened");
        openedWith = createProperties;
        return { id: 12 };
      },
    },
    windows: {
      getAll: async () => [{
        id: 7,
        incognito: false,
        tabs: [{ id: 11, groupId: -1, pinned: false, title: "One", url: "https://one.example" }],
      }],
    },
  };
  Object.defineProperty(globalThis, "chrome", { value: fakeChrome, configurable: true });
  Object.defineProperty(globalThis, "fetch", {
    value: async () => {
      events.push("uploaded");
      return new Response(JSON.stringify({
        result: {
          data: {
            card: "box/inbox/Tabs.card",
            open: "chat?companion=view%3Abox%2Finbox%2FTabs.card",
            transferId: "server-transfer",
          },
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
    configurable: true,
  });
  t.teardown(() => {
    Reflect.deleteProperty(globalThis, "chrome");
    Reflect.deleteProperty(globalThis, "fetch");
  });

  const result = await shareTabs(
    { boxUrl: "https://box.example/personal", slug: "personal", title: "Personal" },
    { scope: "current-window", sourceWindowId: 7 },
  );

  t.same(events, ["uploaded", "saved", "opened"]);
  t.same(openedWith, {
    url: "https://box.example/personal/chat?companion=view%3Abox%2Finbox%2FTabs.card",
  });
  t.equal(result.organizerOpened, true);
});
