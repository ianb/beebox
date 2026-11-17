// # The frontend build identity
//
// The build stamps one identity into index.html. It must change when any
// emitted file name changes (Vite hashes content into names) and stay the same
// when the frontend did not change, or a docs-only deploy would reload tabs.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { frontendBuildIdentity, stampBuildIdentity } from "../../src/dev/build-identity-plugin/plugin.js";
import { frontendBuildFromHtml } from "../../../shared/frontend-build.js";

const HTML = "<!doctype html><html><head><script type=\"module\" src=\"/assets/index-CGIIvPi0.js\"></script></head></html>";
const FILES = ["assets/index-CGIIvPi0.js", "assets/index-B1x2y3z4.css", "assets/builtins-Qw9e8r7t.js"];

void test("the same build gives the same identity, whatever order the bundle lists its files", (t) => {
  t.check(frontendBuildIdentity({ html: HTML, fileNames: FILES }), frontendBuildIdentity({ html: HTML, fileNames: FILES.toReversed() }));
  t.end();
});

void test("one changed chunk name changes the identity", (t) => {
  const changed = FILES.map((name) => name.replace("builtins-Qw9e8r7t", "builtins-Zz9e8r7t"));
  const identities = new Set([frontendBuildIdentity({ html: HTML, fileNames: changed }), frontendBuildIdentity({ html: HTML, fileNames: FILES })]);
  t.check(identities.size === 2 ? "different" : "same", "different");
  t.end();
});

void test("the stamped tag is what the server and the page read back", (t) => {
  const bundle = Object.fromEntries(FILES.map((name) => [name, {}]));
  const tags = stampBuildIdentity(HTML, bundle);
  const identity = frontendBuildIdentity({ html: HTML, fileNames: FILES });
  t.check(tags, [{ tag: "meta", attrs: { name: "bbx-frontend-build", content: identity }, injectTo: "head" }]);
  t.check(frontendBuildFromHtml(`<head><meta name="bbx-frontend-build" content="${identity}"></head>`), identity);
  t.end();
});

void test("a document with no identity, or a malformed one, reads as none", (t) => {
  t.check(frontendBuildFromHtml(HTML), null);
  t.check(frontendBuildFromHtml("<meta name=\"bbx-frontend-build\" content=\"not-hex\">"), null);
  t.end();
});
