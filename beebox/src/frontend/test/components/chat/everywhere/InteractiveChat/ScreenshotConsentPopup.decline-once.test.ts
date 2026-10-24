// The screenshot consent popup is a native modal. Escape and a press on the
// backdrop each decline; together they post the decline once and resolve once.
// First, and bare: React DOM must load after the happy-dom window exists.
import { mount } from "../../../../helpers/dom-harness.js";
import { createElement as h } from "react";
import { test } from "tap";
import { ScreenshotConsentPopup } from "../../../../../src/components/chat/everywhere/InteractiveChat/ScreenshotConsentPopup.js";

void test("Escape then a backdrop press posts one decline", async (t) => {
  const posts: Array<{ url: string; body: unknown }> = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    posts.push({ url: String(input), body: typeof init?.body === "string" ? JSON.parse(init.body) : null });
    return new Response(null, { status: 200 });
  };
  t.teardown(() => { globalThis.fetch = realFetch; });

  const resolutions: unknown[] = [];
  const view = await mount(h(ScreenshotConsentPopup, {
    request: { requestId: "req-1", session: "s-1", expiresAt: new Date(Date.now() + 60_000).toISOString() },
    onResolved: (indicator) => { resolutions.push(indicator); },
  }));
  t.teardown(() => view.unmount());
  const dialog = view.container.querySelector("dialog");
  const opened = dialog?.open;
  await view.act(() => { dialog?.dispatchEvent(new Event("cancel", { cancelable: true })); });
  await view.act(() => { dialog?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });

  t.check({ opened, posts, resolutions }, {
    opened: true,
    posts: [{ url: "/api/chat/screenshot/req-1", body: { declined: true } }],
    resolutions: [null],
  });
});
