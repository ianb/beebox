// # Publication definition
//
// A publication card `<dir>/<Name>.publication.card` holds the strict,
// agent-authored settings. The sibling attach folder chooses the content mode
// (`<Name>.attach/static/` or `<Name>.attach/project/`); the card cannot supply
// arbitrary paths or build commands.

import { test } from "tap";
import "agent-doctest/tap";
import { definitionFromCard, publicationDefinitionSchema } from "../../src/publish/publication-definition.js";
import { readPublicationCardSource, resolvePublicationCardPath } from "../../src/publish/prepare/card-source.js";
import { createPublicationCardTemplate } from "../../src/schemas/publication.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

const validDefinition = {
  pubId: "abcdefghijklmnop2345672345",
  connection: "personal",
  content: "static",
  title: "Example site",
  tier: "secret",
};

/** The parsed reader emails; only the accounts tier carries them. */
function parsedEmails(input: object): string[] | undefined {
  const parsed = publicationDefinitionSchema.parse(input);
  return parsed.tier === "accounts" ? parsed.emails : undefined;
}

// ## The schema accepts a valid definition and refuses unknown keys
void test("The schema accepts a valid definition and refuses unknown keys", async (t) => {
  // doctest:L32
  t.check(publicationDefinitionSchema.safeParse(validDefinition).success, true);

  // doctest:L35
  t.check(publicationDefinitionSchema.safeParse({ ...validDefinition, source: "../../private" }).success, false);

  // doctest:L38
  t.check(publicationDefinitionSchema.safeParse({ ...validDefinition, workerName: "other-box-worker" }).success, false);
});

// ## Tier-specific audience fields stay strict
void test("Tier-specific audience fields stay strict", async (t) => {
  // doctest:L45
  t.check(publicationDefinitionSchema.safeParse({ ...validDefinition, slug: "example" }).success, false);

  // doctest:L48
  t.check(publicationDefinitionSchema.safeParse({ ...validDefinition, tier: "public", slug: "example" }).success, true);

  // doctest:L51
  t.check(publicationDefinitionSchema.safeParse({ ...validDefinition, tier: "accounts", emails: ["reader@example.test"] }).success, true);

  // doctest:L54
  t.check(parsedEmails({ ...validDefinition, tier: "accounts", emails: ["Reader@Example.test", "reader@example.test"] }), [
    "reader@example.test",
  ]);

  // doctest:L57
  t.check(parsedEmails({ ...validDefinition, tier: "accounts", emails: ["z@example.test", "a@example.test"] }), [
    "a@example.test",
    "z@example.test",
  ]);

  // doctest:L60
  t.check(publicationDefinitionSchema.safeParse({ ...validDefinition, tier: "accounts" }).success, false);

  // doctest:L63
  t.check(publicationDefinitionSchema.safeParse({ ...validDefinition, tier: "accounts", slug: "example" }).success, false);
});

// ## The attach folder derives the content mode and source root
void test("The attach folder derives the content mode and source root", async (t) => {
  // doctest:L70
  const box = await makeTmpBox();
  const card = createPublicationCardTemplate({ pubId: validDefinition.pubId, title: "Example site", connection: "personal", tier: "secret" });
  await box.write("_content/Example.publication.card", card);
  await box.write("_content/Example.attach/static/index.html", "<h1>Hi</h1>");
  const staticSource = await readPublicationCardSource({ boxRoot: box.root, cardPath: "_content/Example.publication.card" });
  t.check(staticSource.definition.content, "static");

  // doctest:L78
  await t.checkText(staticSource.sourceRoot === box.path("_content/Example.attach/static"), "true");

  // doctest:L81
  await box.write("_content/Site.publication.card", createPublicationCardTemplate({ pubId: "bcdefghijklmnop234567abcde", title: "Site", connection: "personal", tier: "secret" }));
  await box.write("_content/Site.attach/project/package.json", "{}");
  const projectSource = await readPublicationCardSource({ boxRoot: box.root, cardPath: "_content/Site.publication.card" });
  t.check(projectSource.definition.content, "project");

  // doctest:L87
  await t.checkText(projectSource.sourceRoot === box.path("_content/Site.attach/project"), "true");

  // doctest:L90
  await box.cleanup();
});

// ## A malformed card gets a field-specific error
void test("A malformed card gets a field-specific error", async (t) => {
  // doctest:L96
  const box = await makeTmpBox();
  const base = createPublicationCardTemplate({ pubId: validDefinition.pubId, title: "Example site", connection: "personal", tier: "secret" });
  await box.write("_content/Example.publication.card", base.replace("tier: secret", "tier: everyone"));
  await box.write("_content/Example.attach/static/index.html", "x");
  const loaded = await readPublicationCardSource({ boxRoot: box.root, cardPath: "_content/Example.publication.card" }).catch((error) => error.message);
  await box.cleanup();

  // doctest:L103
  await t.checkText(loaded.startsWith("publication card _content/Example.publication.card cannot be used"), "true");

  // doctest:L106
  await t.checkText(loaded.includes("tier"), "true");
});

// ## Card paths cannot become arbitrary paths
void test("Card paths cannot become arbitrary paths", async (t) => {
  // doctest:L113
  const refused = (card: string) => { try { resolvePublicationCardPath(card); return "ok"; } catch (error) { return error instanceof Error ? error.message : String(error); } };

  // doctest:L115
  t.check(resolvePublicationCardPath("_content/Example.publication.card"), "_content/Example.publication.card");

  // doctest:L118
  t.check(refused("../outside.publication.card"), "publication card path '../outside.publication.card' is not a file inside the box");

  // doctest:L121
  t.check(refused("_content/Example.card"), "'_content/Example.card' is not a publication card; the path must end with .publication.card");

  // doctest:L124
  t.check(refused("_content/Example.publication.card?x=1"), "publication card path '_content/Example.publication.card?x=1' must not carry a query or fragment");

  // ## A publication card becomes a prepare definition
  //
  // `definitionFromCard` joins the card's request fields with the content mode and
  // validates the result once, through the definition schema.

  // doctest:L134
  const cardPubId = "abcdefghijklmnopqrstuvwxyz";
  await t.checkText(JSON.stringify(definitionFromCard({ type: "publication", title: "Team", pubId: cardPubId, connection: "cf", tier: "accounts", emails: ["Kim@Example.com", "ari@example.com"] }, "static")), "{\"pubId\":\"abcdefghijklmnopqrstuvwxyz\",\"connection\":\"cf\",\"content\":\"static\",\"title\":\"Team\",\"tier\":\"accounts\",\"emails\":[\"ari@example.com\",\"kim@example.com\"]}");

  // doctest:L138
  await t.checkText(JSON.stringify(definitionFromCard({ title: "Home", pubId: cardPubId, connection: "cf", tier: "public", slug: "home" }, "project")), "{\"pubId\":\"abcdefghijklmnopqrstuvwxyz\",\"connection\":\"cf\",\"content\":\"project\",\"title\":\"Home\",\"tier\":\"public\",\"slug\":\"home\"}");

  // A card that breaks a rule throws with the field named.

  // doctest:L145
  let message = "";
  try { definitionFromCard({ title: "Home", pubId: cardPubId, connection: "cf", tier: "secret", slug: "home" }, "static"); }
  catch (error) { message = error instanceof Error ? `${error.name}: ${error.message}` : "not an error"; }
  t.check(message, "PublicationDefinitionError: publication card abcdefghijklmnopqrstuvwxyz is invalid at card: Unrecognized key: \"slug\"");
});
