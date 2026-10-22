// # `bbx calendar` and `bbx connector gmail` from a shell with no credential
//
// Drive was the family the 2026-09-14 incident hit; Calendar and Gmail had the
// same dead end. `bbx calendar calendars`, `bbx connector gmail track`, and `bbx
// connector gmail gws` each built a Google client in their own process, and a box
// agent's shell is deliberately not allowed to hold that credential.
//
// What these tests pin is that one rule now covers all three families: under any
// spawn profile but `tooling`, the verb asks the box's own server — with the agent
// bearer the auth wall already accepts — and a refusal comes back typed, naming
// which of three parties can act on it. The auth wall is ON here (`openAccess:
// false`), so the bearer is doing real work.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeTestServer, TEST_SLUG } from "../../helpers/test-route-server.js";
import { getOrCreateAgentToken } from "../../../src/core/agent/token.js";
import { createFakeGoogleCalendar } from "../../../src/services/google-calendar/core.js";
import { createFakeGoogleGmail } from "../../../src/services/google-gmail-fake/core.js";
import { createFakeGoogleAuth } from "../../../src/services/google-auth.js";
import type { GmailMessage } from "../../../src/services/google-gmail-types.js";
import {
  assertReadOnlyGwsArgs,
  type GwsRunResult,
} from "../../../src/connectors/gmail/gws.js";
import {
  availableCalendarsWithSyncing,
  type AvailableCalendarState,
} from "../../../src/connectors/google-calendar/config.js";
import { trackGmailThread, type TrackGmailThreadResult } from "../../../src/connectors/gmail/track.js";
import { localCalendarService } from "../../../src/cli/commands/calendar.js";
import { localGmailService } from "../../../src/cli/commands/connector.js";
import { dispatchCredentialed, refusalFor, } from "../../../src/cli/lib/credentialed-verb.js";

const SHELL_VARS = ["BBX_SPAWN_PROFILE", "BBX_SERVER_URL", "BBX_BOX_NAME", "BBX_AGENT_TOKEN"];
const savedShell = Object.fromEntries(SHELL_VARS.map((name) => [name, process.env[name]]));

/** Set (or, with `undefined`, unset) the env vars a box spawn hands a child. */
function setEnv(vars: Record<string, string | undefined>): void {
  for (const [name, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

/** Two calendars: the user's own, and one shared read-only. */
function officeCalendar() {
  return createFakeGoogleCalendar({
    calendars: [
      { id: "avery@example.com", summary: "Avery", accessRole: "owner", primary: true },
      { id: "team@example.com", summary: "Team", accessRole: "reader" },
    ],
  });
}

function gmailMessage(opts: { id: string; threadId: string; subject: string }): GmailMessage {
  return {
    id: opts.id,
    threadId: opts.threadId,
    labelIds: ["INBOX"],
    internalDate: "1785596400000",
    payload: {
      mimeType: "text/plain",
      headers: [
        { name: "Message-ID", value: `<${opts.id}@example.com>` },
        { name: "From", value: "sender@example.com" },
        { name: "To", value: "box@example.com" },
        { name: "Subject", value: opts.subject },
      ],
      body: { data: Buffer.from("The roof needs looking at.").toString("base64url") },
    },
  };
}

function roofGmail() {
  return createFakeGoogleGmail({
    messages: [gmailMessage({ id: "msg-1", threadId: "thread-1", subject: "The roof" })],
    labels: [{ id: "INBOX", name: "INBOX" }],
  });
}

/**
 * A gws runner that never spawns a child, but does apply the real read-only
 * vocabulary check — so a rejected command is rejected here for the same reason
 * it would be in production.
 */
const fakeGws = async (opts: { args: string[] }): Promise<GwsRunResult> => {
  assertReadOnlyGwsArgs(opts.args);
  return { exitCode: 0, stdout: `{"ran":${JSON.stringify(opts.args.join(" "))}}\n`, stderr: "" };
};

/** Exactly what `bbx calendar calendars` does, minus the printing. */
function calendarsVerb(boxRoot: string) {
  return dispatchCredentialed<AvailableCalendarState[]>({
    local: async () =>
      availableCalendarsWithSyncing({ boxRoot, service: await localCalendarService(boxRoot) }),
    remote: (client) => client.calendar.available.query(),
  });
}

/** Exactly what `bbx connector gmail track` does. */
function trackVerb(boxRoot: string, threadId: string) {
  return dispatchCredentialed<TrackGmailThreadResult>({
    local: async () =>
      trackGmailThread({
        boxRoot,
        service: await localGmailService(boxRoot),
        threadId,
        trackedBy: "explicit-command",
      }),
    remote: (client) => client.gmail.track.mutate({ threadId }),
  });
}

/** Exactly what `bbx connector gmail gws` does. */
function gwsVerb(args: string[]) {
  return dispatchCredentialed<GwsRunResult>({
    local: () => { throw new Error("this test never takes the in-process gws path"); },
    remote: (client) => client.gmail.gws.mutate({ args }),
  });
}

// ## A transport failure is not a grant refusal
//
// The server being down is a machine problem. An HTTP refusal still preserves
// the server's typed code and boxholder attribution.
void test("The server being down is a machine problem.", async (t) => {
  const transport = refusalFor(new TypeError("fetch failed"), { remote: true });
  t.check(transport, {
    kind: "BOX_UNREACHABLE",
    message: "The box's server could not be reached: fetch failed",
    fix: "machine",
  });
});

// ## An agent's shell reaches all three verbs through its own box's server
//
// No token file is involved: the CLI half holds only the env vars a box spawn
// hands it, and the credentialed work happens in the server process, here against
// injected fakes.
void test("No token file is involved:", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const ctx = await makeTestServer({
    openAccess: false,
    services: {
      calendar: officeCalendar(),
      gmail: roofGmail(),
      googleAuth: createFakeGoogleAuth(),
      gwsRunner: fakeGws,
    },
  });
  const serverUrl = await ctx.server.listen({ port: 0, host: "127.0.0.1" });
  setEnv({
    BBX_SPAWN_PROFILE: "agent",
    BBX_SERVER_URL: serverUrl,
    BBX_BOX_NAME: TEST_SLUG,
    BBX_AGENT_TOKEN: getOrCreateAgentToken(ctx.boxRoot),
  });

  const calendars = await calendarsVerb(ctx.boxRoot);
  t.check(calendars, {
    ok: true,
    value: [
      {
        id: "avery@example.com",
        summary: "Avery",
        accessRole: "owner",
        primary: true,
        syncing: true,
        resolvedId: "avery@example.com",
      },
      { id: "team@example.com", summary: "Team", accessRole: "reader", syncing: false },
    ],
  });

  // The primary calendar reads as syncing because an unconfigured box syncs
  // `primary`, and the listing resolves that alias rather than showing the box as
  // syncing nothing.

  const tracked = await trackVerb(ctx.boxRoot, "thread-1");
  t.check(tracked, {
    ok: true,
    value: {
      cardPath: "_content/inbox/email/thread-The_roof-thread-1.email-thread.card",
      created: [
        "_content/inbox/email/thread-The_roof-thread-1.attach/msg-001.email-message.card",
        "_content/inbox/email/thread-The_roof-thread-1.attach/msg-001.attach/msg-001.body.txt",
        "_content/inbox/email/thread-The_roof-thread-1.email-thread.card",
      ],
      updated: [],
    },
  });

  // The card is a real card in the box, written and committed by the server.

  t.checkText(await ctx.read("_content/inbox/email/thread-The_roof-thread-1.email-thread.card"), `---
email:
  thread-id: thread-1
  subject: The roof
  participants:
    - sender@example.com
    - box@example.com
  date-range:
    start: 2026-08-01T15:00:00.000Z
    end: 2026-08-01T15:00:00.000Z
  labels:
    - INBOX
messages:
  - ref: attach/msg-001.email-message.card
---`);

  // `gws` hands back the child's own streams and exit code rather than a rendered
  // sentence, so the caller reads exactly what the upstream CLI said.

  const ran = await gwsVerb(["gmail", "messages", "list"]);
  t.check(ran, {
    ok: true,
    value: { exitCode: 0, stdout: "{\"ran\":\"gmail messages list\"}\n", stderr: "" },
  });

  // A command outside the read-only vocabulary is refused before anything is minted,
  // and the refusal is the caller's to fix — not the box's state.

  t.check(await gwsVerb(["gmail", "messages", "delete"]), {
    ok: false,
    error: { kind: "BAD_REQUEST", message: "Rejected non-read-only gws command: gmail messages delete", fix: "caller" },
  });
});

// ## With nothing injected, each family refuses in the boxholder's two places
//
// This box has no fakes, so the server meets the same two gates a production box
// has: the policy switch, then the authorization. Both are the boxholder's, in
// different places, and both say which.
void test("This box has no fakes, so the server meets the same two gates a production bo...", async (t) => {
  t.teardown(async () => {
    try {
      setEnv(savedShell);
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const ctx = await makeTestServer({ openAccess: false });
  const serverUrl = await ctx.server.listen({ port: 0, host: "127.0.0.1" });
  setEnv({
    BBX_SPAWN_PROFILE: "agent",
    BBX_SERVER_URL: serverUrl,
    BBX_BOX_NAME: TEST_SLUG,
    BBX_AGENT_TOKEN: getOrCreateAgentToken(ctx.boxRoot),
  });

  t.check(await calendarsVerb(ctx.boxRoot), {
    ok: false,
    error: {
      kind: "FORBIDDEN",
      message: "Calendar is not enabled for this box. Set `googleServices.calendar: true` in `_config/box.json` (you may do this when the boxholder asks for Calendar), or enable it in box settings.",
      fix: "boxholder",
    },
  });

  t.check(await trackVerb(ctx.boxRoot, "thread-1"), {
    ok: false,
    error: {
      kind: "FORBIDDEN",
      message: "Gmail is not enabled for this box. Set `googleServices.gmail: true` in `_config/box.json` (you may do this when the boxholder asks for Gmail), or enable it in box settings.",
      fix: "boxholder",
    },
  });

  // With both switched on and no token record on this host, it is the auth gap — a
  // different sentence, still the boxholder's, and the one the agent needs to relay
  // instead of guessing.

  await mkdir(join(ctx.boxRoot, "_config"), { recursive: true });
  await writeFile(
    join(ctx.boxRoot, "_config/box.json"),
    JSON.stringify({ googleServices: { calendar: true, gmail: true } }),
  );
  const gap = {
    ok: false,
    error: {
      kind: "PRECONDITION_FAILED",
      message: "Google auth unavailable: No secret named \"google-oauth-client-id\" exists on this machine. It can be declared (bbx secrets declare google-oauth-client-id), but only the boxholder can supply its value.",
      fix: "boxholder",
    },
  } as const;
  const gaps = [
    await calendarsVerb(ctx.boxRoot),
    await trackVerb(ctx.boxRoot, "thread-1"),
    await gwsVerb(["gmail", "messages", "list"]),
  ];
  t.check(gaps, [gap, gap, gap]);

  // The `tooling` profile takes the in-process path instead, and meets the same
  // gates in this process — the marker decides where the work runs, never what the
  // process can read.

  setEnv({ BBX_SPAWN_PROFILE: "tooling" });
  const local = await calendarsVerb(ctx.boxRoot);
  t.check(local, gap);
});
