// Docs API failure diagnosis: a disabled API points at Cloud Console, a
// missing scope keeps the reauthorize advice, and anything else reports
// Google's status and message without scope advice.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import ky from "ky";
import {
  describeGoogleFailure,
  diagnoseDocsApiFailure,
} from "../../../../../src/connectors/google-drive/handlers/docs/api-failure.js";
import { parseGoogleApiError } from "../../../../../src/google/api-error.js";

function serviceDisabledBody(metadata: Record<string, string>): string {
  return JSON.stringify({
    error: {
      code: 403,
      message: "Google Docs API has not been used in project 123456 before or it is disabled.",
      status: "PERMISSION_DENIED",
      details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "SERVICE_DISABLED", metadata }],
    },
  });
}

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

void test("SERVICE_DISABLED uses Google's activation link", async (t) => {
  const failure = await diagnoseDocsApiFailure(await kyFailure(403, serviceDisabledBody({
    consumer: "projects/123456",
    activationUrl: "https://console.developers.google.com/apis/api/docs.googleapis.com/overview?project=123456",
  })));
  t.check(failure, {
    kind: "service-disabled",
    message:
      "the Google Docs API is disabled for the Google Cloud project the box's Google sign-in uses, " +
      "and reauthorizing will not fix that. Enable the API in Cloud Console, wait a few minutes, " +
      "and try again: https://console.developers.google.com/apis/api/docs.googleapis.com/overview?project=123456",
    link: "https://console.developers.google.com/apis/api/docs.googleapis.com/overview?project=123456",
  });
});

void test("SERVICE_DISABLED without a link builds one from the project, else the library page", async (t) => {
  const lead =
    "the Google Docs API is disabled for the Google Cloud project the box's Google sign-in uses, " +
    "and reauthorizing will not fix that. Enable the API in Cloud Console, wait a few minutes, " +
    "and try again: ";
  t.check(describeGoogleFailure(parseGoogleApiError(403, serviceDisabledBody({ consumer: "projects/987" }))), {
    kind: "service-disabled",
    message: lead + "https://console.developers.google.com/apis/api/docs.googleapis.com/overview?project=987",
    link: "https://console.developers.google.com/apis/api/docs.googleapis.com/overview?project=987",
  });
  t.check(describeGoogleFailure(parseGoogleApiError(403, serviceDisabledBody({}))), {
    kind: "service-disabled",
    message: lead + "https://console.cloud.google.com/apis/library/docs.googleapis.com",
    link: "https://console.cloud.google.com/apis/library/docs.googleapis.com",
  });
});

void test("a missing scope keeps the reauthorize advice", async (t) => {
  const failure = await diagnoseDocsApiFailure(await kyFailure(403, JSON.stringify({
    error: {
      code: 403,
      message: "Request had insufficient authentication scopes.",
      status: "PERMISSION_DENIED",
      details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT" }],
    },
  })));
  t.check(failure, {
    kind: "scope-insufficient",
    message: "the Google sign-in lacks the documents.readonly scope. Re-authorize Google in Settings, under Google services, to grant it.",
    link: null,
  });
});

void test("other failures report status and Google's message, no scope advice", async (t) => {
  t.check(
    await diagnoseDocsApiFailure(await kyFailure(404, JSON.stringify({
      error: { code: 404, message: "Requested entity was not found.", status: "NOT_FOUND" },
    }))),
    { kind: "other", message: "Google answered HTTP 404: Requested entity was not found.", link: null },
  );
  t.check(
    await diagnoseDocsApiFailure(await kyFailure(500, "")),
    { kind: "other", message: "Google answered HTTP 500", link: null },
  );
  t.check(
    await diagnoseDocsApiFailure(new TypeError("fetch failed")),
    { kind: "other", message: "fetch failed", link: null },
  );
});
