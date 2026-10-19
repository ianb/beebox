// # Publication links use the approved hostname and tier route

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { publicationUrl, samePublicationAudience, type PublicationUrlScope } from "../../src/shared/publication-url.js";

const pubId = "abcdefghijklmnopqrstuvwxyz";

// A custom hostname takes the approved tier path. Public custom domains use the
// root path, while a secret URL retains its unguessable publication path.
void test("A custom hostname takes the approved tier path.", async (t) => {
  // doctest:L12
  t.check(publicationUrl({ workersHostname: "site.workers.dev", pubId, scope: { tier: "public", slug: "notes", customHostname: "www.example.org" } }), "https://www.example.org/");

  // doctest:L15
  t.check(publicationUrl({ workersHostname: "site.workers.dev", pubId, scope: { tier: "secret", customHostname: "private.example.org" } }), "https://private.example.org/s/abcdefghijklmnopqrstuvwxyz/");
});

// The workers.dev alias remains available with the same tier routing.
void test("The workers.dev alias remains available with the same tier routing.", async (t) => {
  // doctest:L22
  t.check(publicationUrl({ workersHostname: "site.workers.dev", pubId, scope: { tier: "secret" } }), "https://site.workers.dev/s/abcdefghijklmnopqrstuvwxyz/");

  // doctest:L25
  t.check(publicationUrl({ workersHostname: "site.workers.dev", pubId, scope: { tier: "public", slug: "notes" } }), "https://site.workers.dev/p/notes/");

  // doctest:L28
  t.check(publicationUrl({ workersHostname: "site.workers.dev", pubId, scope: null }), null);

  // doctest:L31
  t.check(samePublicationAudience({ requested: { tier: "public", customHostname: "new.example.org" }, approved: { tier: "public", customHostname: "old.example.org" } }), false);
});

// Shared-host routes put the public slug at the host root and keep secret URLs
// under the unguessable PubId path. They take precedence over legacy custom hosts.
void test("Shared-host routes put the public slug at the host root and keep secret URLs...", async (t) => {
  // doctest:L39
  const sharedPublic: PublicationUrlScope & { sharedHost: NonNullable<PublicationUrlScope["sharedHost"]> } = { tier: "public", slug: "hello", sharedHost: { hostname: "publish.example.org", hostHandle: "box-handle", path: "/hello/" } };
  t.check(publicationUrl({ workersHostname: null, pubId, scope: sharedPublic }), "https://publish.example.org/hello/");

  // doctest:L43
  t.check(publicationUrl({ workersHostname: null, pubId, scope: { tier: "secret", sharedHost: { hostname: "publish.example.org", hostHandle: "box-handle", path: `/s/${pubId}/` } } }), "https://publish.example.org/s/abcdefghijklmnopqrstuvwxyz/");

  // doctest:L46
  t.check(publicationUrl({ workersHostname: "legacy.workers.dev", pubId, scope: { ...sharedPublic, customHostname: "legacy.example.org" } }), "https://publish.example.org/hello/");

  // doctest:L49
  t.check(
    publicationUrl({ workersHostname: null, pubId, scope: { ...sharedPublic, sharedHost: { ...sharedPublic.sharedHost, path: "//attacker.example/" } } })
    ,
    null,
  );

  // doctest:L52
  t.check(samePublicationAudience({ requested: sharedPublic, approved: { ...sharedPublic, sharedHost: { ...sharedPublic.sharedHost, hostname: "other.example.org" } } }), false);
});

void test("line 56", async (t) => {
  // doctest:L57
  t.check(samePublicationAudience({ requested: { tier: "accounts", allowedEmails: ["b@example.org", "a@example.org"] }, approved: { tier: "accounts", allowedEmails: ["a@example.org", "b@example.org"] } }), true);
});
