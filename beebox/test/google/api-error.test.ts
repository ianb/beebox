// Google API error bodies: the parser pulls Google's status, message, and
// ErrorInfo reason out of a failed ky request, and a body that is not Google's
// shape still yields the HTTP status.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import ky from "ky";
import {
  isScopeInsufficient,
  parseGoogleApiError,
  readGoogleApiError,
} from "../../src/google/api-error.js";

const SERVICE_DISABLED_BODY = JSON.stringify({
  error: {
    code: 403,
    message: "Google Docs API has not been used in project 123456 before or it is disabled.",
    status: "PERMISSION_DENIED",
    details: [
      { "@type": "type.googleapis.com/google.rpc.Help", links: [{ description: "console", url: "https://example.com" }] },
      {
        "@type": "type.googleapis.com/google.rpc.ErrorInfo",
        reason: "SERVICE_DISABLED",
        domain: "googleapis.com",
        metadata: {
          consumer: "projects/123456",
          service: "docs.googleapis.com",
          activationUrl: "https://console.developers.google.com/apis/api/docs.googleapis.com/overview?project=123456",
        },
      },
    ],
  },
});

const SCOPE_BODY = JSON.stringify({
  error: {
    code: 403,
    message: "Request had insufficient authentication scopes.",
    status: "PERMISSION_DENIED",
    details: [{
      "@type": "type.googleapis.com/google.rpc.ErrorInfo",
      reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT",
      domain: "googleapis.com",
      metadata: { service: "docs.googleapis.com", method: "google.apps.docs.v1.DocumentsService.GetDocument" },
    }],
  },
});

/** Throw the HTTPError ky raises when Google answers with `status` and `body`. */
async function kyFailure(status: number, body: string): Promise<unknown> {
  try {
    await ky.get("https://docs.googleapis.com/v1/documents/doc-1", {
      retry: 0,
      fetch: async () => new Response(body, { status }),
    });
  } catch (e) {
    return e;
  }
  throw new Error("expected the request to fail");
}

void test("a SERVICE_DISABLED body yields its reason and activation metadata", async (t) => {
  const google = await readGoogleApiError(await kyFailure(403, SERVICE_DISABLED_BODY));
  t.check(google, {
    httpStatus: 403,
    status: "PERMISSION_DENIED",
    message: "Google Docs API has not been used in project 123456 before or it is disabled.",
    reason: "SERVICE_DISABLED",
    metadata: {
      consumer: "projects/123456",
      service: "docs.googleapis.com",
      activationUrl: "https://console.developers.google.com/apis/api/docs.googleapis.com/overview?project=123456",
    },
  });
  // A disabled API is not a scope problem, though both are 403 PERMISSION_DENIED.
  t.check(google === null ? null : isScopeInsufficient(google), false);
});

void test("a scope-insufficient body is recognized by reason or by message", async (t) => {
  const google = await readGoogleApiError(await kyFailure(403, SCOPE_BODY));
  t.check(google === null ? null : isScopeInsufficient(google), true);
  // Without an ErrorInfo detail, the canonical message still identifies it.
  const bare = parseGoogleApiError(403, JSON.stringify({
    error: { code: 403, status: "PERMISSION_DENIED", message: "Request had insufficient authentication scopes." },
  }));
  t.check(isScopeInsufficient(bare), true);
});

void test("a body that is not Google's shape keeps only the status", async (t) => {
  t.check(parseGoogleApiError(502, "<html>Bad Gateway</html>"), {
    httpStatus: 502, status: null, message: null, reason: null, metadata: {},
  });
  t.check(parseGoogleApiError(500, JSON.stringify({ oops: true })), {
    httpStatus: 500, status: null, message: null, reason: null, metadata: {},
  });
});

void test("a failure that is not an HTTP error has no Google error", async (t) => {
  t.check(await readGoogleApiError(new TypeError("fetch failed")), null);
});
