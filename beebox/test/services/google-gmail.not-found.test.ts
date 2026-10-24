// # Gmail service: a deleted item is NotFoundError
//
// Gmail answers 404 for a message, thread or attachment deleted after history
// named it. The real service reports that as NotFoundError, as the fake does,
// so the connector can skip the item and keep syncing.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { createGoogleGmailService } from "../../src/services/google-gmail/core.js";

async function failure(request: Promise<unknown>): Promise<string> {
  return request.then(
    () => "resolved",
    (error: unknown) => error instanceof Error ? `${error.name}: ${error.message}` : String(error),
  );
}

void test("A 404 on a per-item fetch is NotFoundError; other statuses are not", async (t) => {
  const previousFetch = globalThis.fetch;
  t.teardown(() => {
    globalThis.fetch = previousFetch;
  });
  let status = 404;
  globalThis.fetch = async () => new Response("{}", { status });
  const service = createGoogleGmailService({ getAccessToken: async () => "token" });

  await t.check(failure(service.getMessage("gone")), "NotFoundError: Message not found: gone");
  await t.check(failure(service.getThread("gone")), "NotFoundError: Thread not found: gone");
  await t.check(failure(service.getAttachment("msg", "att")), "NotFoundError: Attachment not found: msg:att");

  // Auth and quota failures must still fail the sync.
  status = 403;
  await t.check(
    failure(service.getMessage("forbidden")),
    "HTTPError: Request failed with status code 403: GET https://gmail.googleapis.com/gmail/v1/users/me/messages/forbidden?format=full",
  );
});
