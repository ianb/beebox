// # Keeping the compose editor and the card in step
//
// `CompositionSync` autosaves after a pause, saves with a commit, merges the
// agent's changes, and reports the save state the toolbar shows
// (`docs/plans/composition-editor.md`, Track 5 and Failure modes). Here the
// tRPC client, the editor, and the timers are fakes.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import {
  CompositionSync, saveStateText, type ReadResult, type SyncClient, type WriteResult,
} from "../../../../src/components/MarkdownCardView/compose/sync.js";

type WriteInput = Parameters<SyncClient["write"]>[0];

function harness(initial: string) {
  const writes: WriteInput[] = [];
  const states: string[] = [];
  const timers: { fn: () => void; ms: number; live: boolean }[] = [];
  const replies: (WriteResult | Error)[] = [];
  let disk: ReadResult = { text: initial, regionHash: `h:${initial}` };
  let text = initial;
  let remoteApplied = 0;
  const client: SyncClient = {
    read: async () => disk,
    write: async (input) => {
      writes.push(input);
      const reply = replies.shift() ?? { status: "written", regionHash: `h:${input.text}`, commit: input.commit ? "abc123" : null, commitWarning: null };
      if (reply instanceof Error) throw reply;
      return reply;
    },
  };
  const sync = new CompositionSync({
    client,
    editor: {
      text: () => text,
      applyRemote: ({ changes }) => {
        remoteApplied += 1;
        for (const c of changes.toReversed()) text = text.slice(0, c.from) + c.insert + text.slice(c.to);
      },
    },
    schedule: (fn, ms) => {
      const timer = { fn, ms, live: true };
      timers.push(timer);
      return () => { timer.live = false; };
    },
    onState: (state) => states.push(saveStateText(state)),
    initial: { text: initial, regionHash: `h:${initial}` },
    autosaveMs: 800,
    retryMs: 3000,
  });
  return {
    sync, writes, states, replies,
    type(next: string) { text = next; sync.localChanged(); },
    text: () => text,
    remoteApplied: () => remoteApplied,
    setDisk(next: ReadResult) { disk = next; },
    pending: () => timers.filter((t) => t.live).map((t) => t.ms),
    /** Run the live timers and let the writes they start finish. */
    async fire() {
      for (const timer of timers.splice(0)) if (timer.live) timer.fn();
      await sync.settled();
    },
  };
}

// ## Save before the autosave delay sends the on-screen text with a commit
void test("save before the debounce", async (t) => {
  const h = harness("Draft.");
  h.type("Draft, edited.");
  t.check(h.pending(), [800]);
  t.check(await h.sync.save(), true);
  t.check(h.writes, [{ baseRegionHash: "h:Draft.", text: "Draft, edited.", commit: true }]);
  t.check(h.pending(), []);
  t.check(h.states, ["Saving…", "Saved"]);
});

// ## Autosave writes without a commit; its own echo is ignored
void test("autosave and own echo", async (t) => {
  const h = harness("Draft.");
  h.type("Draft two.");
  await h.fire();
  t.check(h.writes, [{ baseRegionHash: "h:Draft.", text: "Draft two.", commit: false }]);
  t.check(h.states, ["Saving…", "Saved to disk"]);
  h.setDisk({ text: "Draft two.", regionHash: "h:Draft two." });
  h.sync.remoteChanged();
  await h.sync.settled();
  t.check({ applied: h.remoteApplied(), writes: h.writes.length }, { applied: 0, writes: 1 });
});

// ## A remote change merges in; the merged text is written back only when it differs from disk
void test("remote change merges", async (t) => {
  const h = harness("One two. Three four.");
  h.type("One two, typed. Three four.");
  h.setDisk({ text: "One two. Three five.", regionHash: "remote-1" });
  h.sync.remoteChanged();
  await h.fire();
  t.check(h.text(), "One two, typed. Three five.");
  t.check(h.writes, [{ baseRegionHash: "remote-1", text: "One two, typed. Three five.", commit: false }]);
});

// ## A conflict response merges with the returned region and writes again on the new base
void test("conflict on write", async (t) => {
  const h = harness("One two. Three four.");
  h.replies.push({ status: "conflict", text: "One two.\n\nThree four.", regionHash: "agent" });
  h.type("One two. Three four, mine.");
  await h.fire();
  t.check(h.writes, [
    { baseRegionHash: "h:One two. Three four.", text: "One two. Three four, mine.", commit: false },
    { baseRegionHash: "agent", text: "One two.\n\nThree four, mine.", commit: false },
  ]);
  t.check(h.states, ["Saving…", "Saving…", "Saved to disk"]);
});

// ## A failing write shows "Not saved" and retries
void test("failing write retries", async (t) => {
  const h = harness("Draft.");
  h.replies.push(new Error("network down"));
  h.type("Draft again.");
  await h.fire();
  t.check({ states: h.states, pending: h.pending(), unsaved: h.sync.hasUnsaved() }, {
    states: ["Saving…", "Not saved: network down, retrying"], pending: [3000], unsaved: true,
  });
  await h.fire();
  t.check(h.states.slice(2), ["Saving…", "Saved to disk"]);
  t.check(h.sync.hasUnsaved(), false);
});

// ## Exit writes what is unsaved first; a failed write keeps the editor open
void test("exit flushes", async (t) => {
  const h = harness("Draft.");
  h.type("Draft, last words.");
  t.check(await h.sync.close(), true);
  t.check(h.writes.map((w) => w.text), ["Draft, last words."]);
  h.type("More.");
  h.replies.push(new Error("server error"));
  t.check(await h.sync.close(), false);
});

// ## The composition removed on disk stops autosave
void test("composition removed", async (t) => {
  const h = harness("Draft.");
  h.setDisk({ problem: "none" });
  h.sync.remoteChanged();
  await h.sync.settled();
  h.type("Typed after.");
  t.check({ states: h.states, pending: h.pending(), writes: h.writes.length }, {
    states: ["The composition was removed from this card"], pending: [], writes: 0,
  });
});
