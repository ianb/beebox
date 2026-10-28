// # Capture and upload chips link to their document with the path encoded
//
// A document name can hold `#` and `%`; each path segment is encoded so the
// card link reaches the file instead of a fragment or a bad escape.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { CaptureChip } from "../../../src/components/chat/CaptureChip.js";
import { UploadChip } from "../../../src/components/chat/user-message/UploadChip.js";
import { parseCaptureWrapper } from "../../../src/components/chat/capture-message.js";
import { parseUploadWrapper } from "../../../src/components/chat/user-message/upload-message.js";

globalThis.React = React;

/** Render `element` at `/test1` and return the chip's link target. */
async function hrefOf(element: React.ReactElement): Promise<string | undefined> {
  const root = createRootRoute({ staticData: { title: null } });
  const route = createRoute({ getParentRoute: () => root, path: "/$boxSlug", staticData: { title: null }, component: () => element });
  const router = createRouter({ routeTree: root.addChildren([route]), history: createMemoryHistory({ initialEntries: ["/test1"] }) });
  await router.load();
  const html = renderToStaticMarkup(React.createElement(RouterProvider, { router }));
  return /<a href="([^"]*)"/.exec(html)?.[1];
}

void test("a capture chip encodes # and % in the document path", async (t) => {
  const model = parseCaptureWrapper('<capture doc="_content/Notes #1.doc.card" images="1">\nsummary\n</capture>');
  if (model === null) return t.fail("capture wrapper did not parse");
  t.check(await hrefOf(React.createElement(CaptureChip, { model })), "/test1/views/_content/Notes%20%231.doc.card");
});

void test("an upload chip encodes # and % in the document path", async (t) => {
  const model = parseUploadWrapper('<upload doc="_content/50% plan.doc.card" files="2" bytes="1 MB" failed="0">\nsummary\n</upload>');
  if (model === null) return t.fail("upload wrapper did not parse");
  t.check(await hrefOf(React.createElement(UploadChip, { model })), "/test1/views/_content/50%25%20plan.doc.card");
});
