// # Cloudflare publishing save feedback
//
// The save result stays beside its submit button, where it remains visible after
// the long token setup instructions. Failures are announced as alerts; successful
// saves are announced as status, including when refreshing the list fails.

import { test } from "tap";
import "agent-doctest/tap";
import { any, not } from "agent-doctest/check";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ConnectionEditor } from "../../../../src/components/admin/CloudflarePublishConnectionsSection/view.js";

globalThis.React = React;
function editor(saveError: string | null, saveStatus: string | null): string {
  return renderToStaticMarkup(React.createElement(ConnectionEditor, {
    name: "studio",
    accountId: "0123456789abcdef0123456789abcdef",
    apiToken: "",
    rotateTarget: null,
    pending: false,
    saveError,
    saveStatus,
    setName: () => {},
    setAccountId: () => {},
    setApiToken: () => {},
    onSubmit: () => {},
    onCancelRotation: () => {},
  }));
}
const failed = editor("Cloudflare did not verify an active token.", null);
const succeeded = editor(null, "Saved “studio”, but the saved connections list could not be refreshed. Reload the page to check it.");

const SAVE_ID = 'id="bbx-admin-cf-publish-save"';

// The editor markup is long (the token setup instructions), so each check
// pins the one thing that matters: the result sits beside its submit button
// (after the `bbx-admin-cf-publish-save` anchor) with the right live-region role.
void test("line 33", async (t) => {
  t.check(failed, any(String).includes('role="alert"'));
  t.check(failed.slice(0, failed.indexOf(SAVE_ID)), not(any(String).includes("Cloudflare did not verify")));
  t.check(failed, any(String).includes(SAVE_ID));
  t.check(failed, any(String).includes("Cloudflare did not verify"));
});

void test("line 38", async (t) => {
  t.check(succeeded, any(String).includes('role="status"'));
  t.check(succeeded.slice(0, succeeded.indexOf(SAVE_ID)), not(any(String).includes("could not be refreshed")));
  t.check(succeeded, any(String).includes(SAVE_ID));
  t.check(succeeded, any(String).includes("could not be refreshed"));
});
