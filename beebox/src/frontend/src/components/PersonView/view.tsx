/**
 * PersonView — the front of a person card (`schemas/person.tsx`).
 *
 * For a person, the role and contact fields are the content, so they lead the
 * front: the role (with "Boxholder" and "Archived" badges), email, phone, and
 * address as links or text, the aliases, then the body through the same
 * `CardBody` every frontmatter card uses. A row whose field is absent is left
 * out. The header shows the name (person `summarize` uses it as the title), so
 * the front does not repeat it; an embed has no header and shows it here.
 *
 * Properties still lists every field (`splitCardFields`). Any front field this
 * view does not draw itself (`todos`, or every field of a card whose schema is
 * unknown) renders in the shared fields table, so nothing is hidden.
 */

import { Badge } from "../ui/Badge";
import { Text } from "../ui/Text";
import { CardBody } from "../MarkdownCardView/CardBody";
import { FrontmatterFields } from "../MarkdownCardView/FrontmatterFields";
import { splitCardFields } from "../../lib/card-field-faces";
import type { RendererProps } from "../../file-type-registry";
import type { ReactNode } from "react";

function stringField(frontmatter: Record<string, unknown>, key: string): string | undefined {
  const value = frontmatter[key];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) return undefined;
  return value.filter((item) => item.trim() !== "");
}

/** The person fields this front draws, each `undefined` when absent or of an unexpected shape. */
interface PersonFields {
  name: string | undefined;
  role: string | undefined;
  email: string | undefined;
  phone: string | undefined;
  address: string | undefined;
  aliases: string[] | undefined;
  boxholder: boolean;
  archived: boolean;
}

function personFields(frontmatter: Record<string, unknown>): PersonFields {
  return {
    name: stringField(frontmatter, "name"),
    role: stringField(frontmatter, "role"),
    email: stringField(frontmatter, "email"),
    phone: stringField(frontmatter, "phone"),
    address: stringField(frontmatter, "address"),
    aliases: stringList(frontmatter["aliases"]),
    boxholder: frontmatter["boxholder"] === true,
    archived: frontmatter["archived"] === true,
  };
}

/**
 * The keys `PersonView` draws itself. A field of an unexpected shape is not
 * drawn, so it is not listed and falls through to the fields table.
 */
function drawnKeys(person: PersonFields): Set<string> {
  const drawn = new Set<string>();
  if (person.boxholder) drawn.add("boxholder");
  if (person.archived) drawn.add("archived");
  for (const key of ["name", "role", "email", "phone", "address", "aliases"] as const) {
    if (person[key] !== undefined) drawn.add(key);
  }
  return drawn;
}

/**
 * A `tel:` target for a phone number written for people: digits and a
 * leading `+`. A value with an extension or other letters (`x12`, `ext. 4`)
 * is shown as text, since a dialled number cannot carry it faithfully.
 */
export function telHref(phone: string): string | null {
  if (/[a-z]/i.test(phone)) return null;
  const digits = phone.replace(/[^\d+]/g, "");
  return digits === "" ? null : `tel:${digits}`;
}

function RoleLine({ role, boxholder, archived }: Pick<PersonFields, "role" | "boxholder" | "archived">): ReactNode {
  if (role === undefined && !boxholder && !archived) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {role === undefined ? null : <Text tone="emphasis" size="base">{role}</Text>}
      {boxholder ? <Badge tone="accent">Boxholder</Badge> : null}
      {archived ? <Badge title="No longer part of the boxholder's life">Archived</Badge> : null}
    </p>
  );
}

function ContactRow({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <div className="flex min-w-0 max-w-full flex-wrap gap-x-1.5">
      <dt className="text-warm-500">{label}</dt>
      <dd className="min-w-0 [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

/** Email and phone as links that start a message or call; the address as text. Rows wrap at narrow widths. */
function ContactList({ email, phone, address }: Pick<PersonFields, "email" | "phone" | "address">): ReactNode {
  if (email === undefined && phone === undefined && address === undefined) return null;
  return (
    <dl className="flex flex-wrap gap-x-5 gap-y-1">
      {email === undefined ? null : (
        <ContactRow label="Email">
          <a href={`mailto:${email}`} className="bbx-theme-link">{email}</a>
        </ContactRow>
      )}
      {phone === undefined ? null : (
        <ContactRow label="Phone">
          {telHref(phone) === null ? <span>{phone}</span> : <a href={telHref(phone) ?? undefined} className="bbx-theme-link">{phone}</a>}
        </ContactRow>
      )}
      {address === undefined ? null : (
        <ContactRow label="Address">
          <span className="whitespace-pre-wrap">{address}</span>
        </ContactRow>
      )}
    </dl>
  );
}

/** The rows above the body, or `null` when the person has none to show (a plain function, so the caller can test for `null`). */
function personSummary(person: PersonFields, embed: boolean): ReactNode {
  const { name, role, email, phone, address, aliases, boxholder, archived } = person;
  const showName = embed && name !== undefined;
  const hasAliases = aliases !== undefined && aliases.length > 0;
  const rows = [showName, role !== undefined, boxholder, archived, email !== undefined, phone !== undefined, address !== undefined, hasAliases];
  if (!rows.some(Boolean)) return null;
  return (
    <div className="mb-4 flex flex-col gap-1.5 text-sm" data-card-section="person">
      {showName ? <Text weight="semibold">{name}</Text> : null}
      <RoleLine role={role} boxholder={boxholder} archived={archived} />
      <ContactList email={email} phone={phone} address={address} />
      {hasAliases ? <Text tone="muted" as="p">Also: {aliases.join(", ")}</Text> : null}
    </div>
  );
}

export function PersonView({ data, onNavigate, mode }: RendererProps) {
  const frontmatter = data.frontmatter ?? {};
  const person = personFields(frontmatter);
  const embed = mode === "embed";
  const drawn = drawnKeys(person);
  const front = splitCardFields(frontmatter, { hasBodyField: data.schema?.hasBodyField ?? null, mode }).front;
  const rest = Object.fromEntries(Object.entries(front).filter(([key]) => !drawn.has(key)));
  const summary = personSummary(person, embed);

  return (
    <div className="bbx-card-content">
      {summary}

      {Object.keys(rest).length > 0 ? (
        <div className="mb-4 pb-3 border-b border-warm-200" data-card-section="frontmatter">
          <FrontmatterFields fields={rest} onNavigate={onNavigate} basePath={data.path} />
        </div>
      ) : null}

      <CardBody data={data} title={person.name} onNavigate={onNavigate} hideEmptyBody={summary !== null} />
    </div>
  );
}
