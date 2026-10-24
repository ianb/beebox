// Returning to a tab mid-turn polls the stream watchdog at once, under the id
// the turn started with. A resumed session's SDK can rotate the machine's id
// mid-turn while the server keeps the busy entry under the original one, so a
// poll with the rotated id would read idle and end a healthy turn
// (issues/bugs/2026-10-23-stall-recovery-polls-rotated-session-id.md). The
// return poll also counts toward the idle threshold instead of recovering on
// one answer.
// First, and bare: React DOM must load after the happy-dom window exists.
import { mount } from "../../../../helpers/dom-harness.js";
import { createElement as h, type ReactNode } from "react";
import { test } from "tap";
import type * as Display from "../../../../../src/components/chat/everywhere/InteractiveChat/processing-status-display.js";
import type { ChatEvent } from "../../../../../src/machines/chat-types.js";

function returnToTab(): Promise<void> {
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
  return new Promise((resolve) => { setTimeout(resolve, 0); });
}

void test("the return poll asks about the turn's first id and needs the idle threshold", async (t) => {
  const asked: string[] = [];
  const { useProcessingStatusPoll } = await t.mockImport<typeof Display>(
    "../../../../../src/components/chat/everywhere/InteractiveChat/processing-status-display.ts",
    { "../../../../../src/api.ts": { getChatStatus: async ({ sessionId }: { sessionId: string }) => {
      asked.push(sessionId);
      return { busy: sessionId !== "original" };
    } } },
  );
  const sent: string[] = [];
  const send = (event: ChatEvent): void => { sent.push(event.type); };
  const snapshot = { value: "streaming" as const, context: { refreshCause: "turn" as const } };
  function Host({ sessionId }: { sessionId: string }): ReactNode {
    useProcessingStatusPoll({ processBusy: true, snapshot, sessionId, send });
    return null;
  }
  const view = await mount(h(Host, { sessionId: "original" }));
  t.teardown(() => view.unmount());
  await view.rerender(h(Host, { sessionId: "rotated" }));
  await returnToTab();
  const afterOne = [...sent];
  await returnToTab();
  await returnToTab();
  t.check({ asked, afterOne, sent }, {
    asked: ["original", "original", "original"],
    afterOne: [],
    sent: ["STREAM_RECOVER"],
  });
});
