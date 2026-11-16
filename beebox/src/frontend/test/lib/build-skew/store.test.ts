// # A stale tab across reloads
//
// One tab, its sessionStorage surviving each reload. The page runs build
// `old`; the server serves `new`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { createBuildSkewStore, FRESH_SHOW_MS, type BuildSkewDeps } from "../../../src/lib/build-skew/store.js";

function tab(given?: Partial<BuildSkewDeps> & { session?: Map<string, string> }) {
  const over = given ?? {};
  const session = over.session ?? new Map<string, string>();
  let clock = 1000;
  let visible = true;
  let blockers: string[] = [];
  const reloads: string[] = [];
  const warnings: string[] = [];
  const store = createBuildSkewStore({
    clientBuild: "old",
    now: () => clock,
    isVisible: () => visible,
    blockers: () => blockers,
    storage: () => ({
      getItem: (k) => session.get(k) ?? null,
      setItem: (k, v) => void session.set(k, v),
      removeItem: (k) => void session.delete(k),
    }),
    reload: () => reloads.push("reload"),
    warn: (m) => warnings.push(m),
    ...over,
  });
  return {
    store, session, reloads, warnings,
    hide: () => { visible = false; },
    show: () => { visible = true; store.shown(); },
    advance: (ms: number) => { clock += ms; },
    block: (...reasons: string[]) => { blockers = reasons; },
  };
}

void test("a hidden tab hears the new build, then reloads when shown", (t) => {
  const a = tab();
  a.hide();
  a.store.serverBuild("new");
  t.check(a.reloads, []);
  a.show();
  t.check(a.reloads, ["reload"]);
  t.check(a.session.get("bbx-build-reload"), "old>new");
  t.check(a.warnings, ["[build] skew client=old server=new action=wait", "[build] skew client=old server=new action=reload"]);
  t.end();
});

void test("the reloaded page runs the new build, logs the reload, and clears the record", (t) => {
  const session = new Map([["bbx-build-reload", "old>new"]]);
  const b = tab({ clientBuild: "new", session });
  b.store.serverBuild("new");
  t.check([...session], []);
  b.store.serverBuild("new");
  t.check(b.warnings, ["[build] reloaded client=old server=new"]);
  t.end();
});

void test("a reload that came back stale shows the banner and does not reload again", (t) => {
  const session = new Map([["bbx-build-reload", "old>new"]]);
  const b = tab({ session });
  b.store.serverBuild("new");
  t.check(b.reloads, []);
  t.check(b.store.getSnapshot(), { banner: true });
  b.hide();
  b.show();
  t.check(b.reloads, []);
  t.end();
});

void test("a draft holds the banner; after it is sent, the next return to the tab reloads", (t) => {
  const a = tab();
  a.block("composer");
  a.hide();
  a.store.serverBuild("new");
  a.show();
  t.check(a.store.getSnapshot(), { banner: true });
  t.check(a.warnings.at(-1), "[build] skew client=old server=new action=banner blockers=composer");
  a.block();
  a.hide();
  a.show();
  t.check(a.reloads, ["reload"]);
  t.end();
});

void test("the socket reconnects a moment after the tab is shown: still a return to the tab", (t) => {
  const a = tab();
  a.hide();
  a.show();
  a.advance(3000);
  a.store.serverBuild("new");
  t.check(a.reloads, ["reload"]);
  t.end();
});

void test("a new build heard while the person is using the tab raises the banner, which stays dismissed", (t) => {
  const a = tab();
  a.store.touched();
  a.store.serverBuild("new");
  t.check(a.store.getSnapshot(), { banner: true });
  a.store.dismiss();
  t.check(a.store.getSnapshot(), { banner: false });
  a.store.serverBuild("new");
  t.check(a.store.getSnapshot(), { banner: false });
  t.end();
});

void test("late past the fresh-show window, untouched: banner", (t) => {
  const a = tab();
  a.advance(FRESH_SHOW_MS + 1);
  a.store.serverBuild("new");
  t.check(a.reloads, []);
  t.check(a.store.getSnapshot(), { banner: true });
  t.end();
});

void test("tab storage unavailable: banner, never reload", (t) => {
  const a = tab({ storage: () => { throw new Error("SecurityError"); } });
  a.store.serverBuild("new");
  t.check(a.reloads, []);
  t.check(a.store.getSnapshot(), { banner: true });
  t.end();
});
