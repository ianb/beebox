# `bbx calendar` and `bbx connector gmail` from a shell with no credential

Drive was the family the 2026-09-14 incident hit; Calendar and Gmail had the
same dead end. `bbx calendar calendars`, `bbx connector gmail track`, and `bbx
connector gmail gws` each built a Google client in their own process, and a box
agent's shell is deliberately not allowed to hold that credential.

What these tests pin is that one rule now covers all three families: under any
spawn profile but `tooling`, the verb asks the box's own server — with the agent
bearer the auth wall already accepts — and a refusal comes back typed, naming
which of three parties can act on it. The auth wall is ON here (`openAccess:
false`), so the bearer is doing real work.

```ts setup
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeTestServer, TEST_SLUG } from "../../helpers/doctest-server.js";
import { getOrCreateAgentToken } from "../../../src/core/agent/token.js";
import { createFakeGoogleCalendar } from "../../../src/services/google-calendar.js";
import { createFakeGoogleGmail } from "../../../src/services/google-gmail-fake.js";
import { createFakeGoogleAuth } from "../../../src/services/google-auth.js";
import type { GmailMessage } from "../../../src/services/google-gmail-types.js";
import {
  assertReadOnlyGwsArgs,
  type GwsRunResult,
} from "../../../src/connectors/gmail-gws.js";
import {
  availableCalendarsWithSyncing,
  type AvailableCalendarState,
} from "../../../src/connectors/calendar-config.js";
import { trackGmailThread, type TrackGmailThreadResult } from "../../../src/connectors/gmail-track.js";
import { localCalendarService } from "../../../src/cli/commands/calendar.js";
import { localGmailService } from "../../../src/cli/commands/connector.js";
import { dispatchCredentialed, type VerbRefusal } from "../../../src/cli/lib/credentialed-verb.js";

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

/** "KIND | fix | message" — the three things a relayed refusal has to carry. */
function refusalLine(result: { ok: boolean; error?: VerbRefusal }): string {
  if (result.ok || result.error === undefined) return "no refusal";
  return `${result.error.kind} | ${result.error.fix} | ${result.error.message}`;
}
```

## An agent's shell reaches all three verbs through its own box's server

No token file is involved: the CLI half holds only the env vars a box spawn
hands it, and the credentialed work happens in the server process, here against
injected fakes.

```ts
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
JSON.stringify(calendars.ok
  ? calendars.value.map((cal) => ({ id: cal.id, syncing: cal.syncing }))
  : calendars.error)
=> [{"id":"avery@example.com","syncing":true},{"id":"team@example.com","syncing":false}]
```

The primary calendar reads as syncing because an unconfigured box syncs
`primary`, and the listing resolves that alias rather than showing the box as
syncing nothing.

```ts continue
const tracked = await trackVerb(ctx.boxRoot, "thread-1");
JSON.stringify(tracked.ok ? { cardPath: tracked.value.cardPath } : tracked.error)
=> {"cardPath":"_content/inbox/email/thread-The_roof-thread-1.email-thread.card"}
```

The card is a real card in the box, written and committed by the server.

```ts continue
(await ctx.read("_content/inbox/email/thread-The_roof-thread-1.email-thread.card")).includes("thread-id: thread-1")
=> true
```

`gws` hands back the child's own streams and exit code rather than a rendered
sentence, so the caller reads exactly what the upstream CLI said.

```ts continue
const ran = await gwsVerb(["gmail", "messages", "list"]);
JSON.stringify(ran.ok ? ran.value : ran.error)
=> {"exitCode":0,"stdout":"{\"ran\":\"gmail messages list\"}\n","stderr":""}
```

A command outside the read-only vocabulary is refused before anything is minted,
and the refusal is the caller's to fix — not the box's state.

```ts continue
refusalLine(await gwsVerb(["gmail", "messages", "delete"]))
=> BAD_REQUEST | caller | Rejected non-read-only gws command: gmail messages delete
```

```ts cleanup
await ctx.cleanup();
```

## With nothing injected, each family refuses in the boxholder's two places

This box has no fakes, so the server meets the same two gates a production box
has: the policy switch, then the authorization. Both are the boxholder's, in
different places, and both say which.

```ts
const ctx = await makeTestServer({ openAccess: false });
const serverUrl = await ctx.server.listen({ port: 0, host: "127.0.0.1" });
setEnv({
  BBX_SPAWN_PROFILE: "agent",
  BBX_SERVER_URL: serverUrl,
  BBX_BOX_NAME: TEST_SLUG,
  BBX_AGENT_TOKEN: getOrCreateAgentToken(ctx.boxRoot),
});

refusalLine(await calendarsVerb(ctx.boxRoot))
=> FORBIDDEN | boxholder | Calendar is not enabled for this box. Set `googleServices.calendar: true` in `_config/box.json` (you may do this when the boxholder asks for Calendar), or enable it in box settings.
```

```ts continue
refusalLine(await trackVerb(ctx.boxRoot, "thread-1"))
=> FORBIDDEN | boxholder | Gmail is not enabled for this box. Set `googleServices.gmail: true` in `_config/box.json` (you may do this when the boxholder asks for Gmail), or enable it in box settings.
```

With both switched on and no token record on this host, it is the auth gap — a
different sentence, still the boxholder's, and the one the agent needs to relay
instead of guessing.

```ts continue
await mkdir(join(ctx.boxRoot, "_config"), { recursive: true });
await writeFile(
  join(ctx.boxRoot, "_config/box.json"),
  JSON.stringify({ googleServices: { calendar: true, gmail: true } }),
);
const gaps = [
  await calendarsVerb(ctx.boxRoot),
  await trackVerb(ctx.boxRoot, "thread-1"),
  await gwsVerb(["gmail", "messages", "list"]),
];
JSON.stringify(gaps.map((r) => (r.ok ? "unexpectedly succeeded" : `${r.error.kind}/${r.error.fix}`)))
=> ["PRECONDITION_FAILED/boxholder","PRECONDITION_FAILED/boxholder","PRECONDITION_FAILED/boxholder"]
```

The `tooling` profile takes the in-process path instead, and meets the same
gates in this process — the marker decides where the work runs, never what the
process can read.

```ts continue
setEnv({ BBX_SPAWN_PROFILE: "tooling" });
const local = await calendarsVerb(ctx.boxRoot);
JSON.stringify(local.ok ? "unexpectedly succeeded" : { kind: local.error.kind, fix: local.error.fix })
=> {"kind":"PRECONDITION_FAILED","fix":"boxholder"}
```

```ts cleanup
setEnv(savedShell);
await ctx.cleanup();
```
