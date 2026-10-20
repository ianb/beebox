/**
 * Why a Google Docs API call failed, in words the boxholder can act on.
 *
 * The Docs handler used to read every `getDocument` failure as a missing
 * `documents.readonly` scope and tell the boxholder to reauthorize. A 403
 * `SERVICE_DISABLED` — the Docs API never enabled on the Cloud project the
 * box's OAuth client belongs to — got the same advice, and reauthorizing
 * cannot fix a project-level switch. This reads Google's error reason first.
 */

import { errorMessage } from "../../../../shared/error-guards.js";
import {
  isScopeInsufficient,
  readGoogleApiError,
  type GoogleApiError,
} from "../../../../google/api-error.js";

export type DocsApiFailureKind = "service-disabled" | "scope-insufficient" | "other";

export interface DocsApiFailure {
  kind: DocsApiFailureKind;
  /** A complete sentence for the boxholder, without the file name. */
  message: string;
  /** Where the boxholder fixes it (the Docs API enable page), when there is one place. */
  link: string | null;
}

/** What one `getDocument` call in a pull found. */
export type DocsApiOutcome = { ok: true } | { ok: false; failure: DocsApiFailure };

const DOCS_API_LIBRARY_URL = "https://console.cloud.google.com/apis/library/docs.googleapis.com";

/**
 * `getDocument` failed in a way the box cannot work around. Thrown by
 * `inspect()`; `kind` says whether the boxholder (enable the API, grant the
 * scope) or nobody in particular (`other`) can fix it.
 */
export class DocsApiUnavailableError extends Error {
  readonly kind: DocsApiFailureKind;
  constructor(options: { fileName: string; failure: DocsApiFailure }) {
    super(`Could not read Google Doc "${options.fileName}" through the Docs API: ${options.failure.message}`);
    this.name = "DocsApiUnavailableError";
    this.kind = options.failure.kind;
  }
}

/** Whether the fix is the boxholder's: enable the API or grant the scope. */
export function isBoxholderFixable(error: DocsApiUnavailableError): boolean {
  return error.kind !== "other";
}

/** Classify a thrown `getDocument` failure. */
export async function diagnoseDocsApiFailure(error: unknown): Promise<DocsApiFailure> {
  const google = await readGoogleApiError(error);
  if (google === null) return { kind: "other", message: errorMessage(error), link: null };
  return describeGoogleFailure(google);
}

/** The diagnosis for a parsed Google error. Exported for tests. */
export function describeGoogleFailure(google: GoogleApiError): DocsApiFailure {
  if (google.reason === "SERVICE_DISABLED") {
    const link = activationLink(google);
    return {
      kind: "service-disabled",
      message:
        "the Google Docs API is disabled for the Google Cloud project the box's Google sign-in uses, " +
        "and reauthorizing will not fix that. Enable the API in Cloud Console, wait a few minutes, " +
        `and try again: ${link}`,
      link,
    };
  }
  if (isScopeInsufficient(google)) {
    return {
      kind: "scope-insufficient",
      message:
        // The boxholder reads this (health, settings, `bbx drive inspect`):
        // the settings Re-authorize button is their path, not an operator command.
        "the Google sign-in lacks the documents.readonly scope. " +
        "Re-authorize Google in Settings, under Google services, to grant it.",
      link: null,
    };
  }
  const said = google.message === null ? "" : `: ${google.message}`;
  return { kind: "other", message: `Google answered HTTP ${String(google.httpStatus)}${said}`, link: null };
}

/**
 * Where to enable the Docs API: Google's own link when the error carries one,
 * else one built from the project number, else the API's library page.
 */
function activationLink(google: GoogleApiError): string {
  const given = google.metadata["activationUrl"];
  if (given !== undefined && given !== "") return given;
  const project = projectId(google);
  if (project !== null) {
    return `https://console.developers.google.com/apis/api/docs.googleapis.com/overview?project=${encodeURIComponent(project)}`;
  }
  return DOCS_API_LIBRARY_URL;
}

function projectId(google: GoogleApiError): string | null {
  const consumer = google.metadata["consumer"];
  const match = consumer === undefined ? null : /^projects\/(.+)$/.exec(consumer);
  if (match?.[1] !== undefined) return match[1];
  const container = google.metadata["containerInfo"];
  return container === undefined || container === "" ? null : container;
}
