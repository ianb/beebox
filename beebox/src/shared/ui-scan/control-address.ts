/**
 * The grammar of a `bbx-` control address, and the way to mint one from a
 * string that does not already fit it.
 *
 * A control address *is* an HTML `id`, and it is used three ways: resolved with
 * `getElementById` (which accepts anything), interpolated into a `#…` selector
 * by `bin/browse` and handed to an opaque upstream CDP driver, and printed into
 * agent-facing text as a `control:` link. The last two are why the grammar is
 * narrow: lowercase kebab-case under `bbx-` needs no CSS escaping and no
 * quoting, so nothing between the app and the driver has to agree on an
 * escaping scheme.
 *
 * The grammar is a *rule on what the app may mint*, not a filter to apply after
 * the fact. An id outside it is invisible to the scan and unaddressable by
 * `bin/browse` — the app publishes an address the whole addressing system then
 * refuses. So any component that builds an id out of runtime data (a card path,
 * a React `useId`, a Drive folder id) runs it through {@link controlAddress}
 * rather than interpolating it raw.
 *
 * Lives in `shared/` because both halves must name one grammar: the frontend
 * resolver (`frontend/src/lib/ui-scan/resolve.ts`) and the wire contract the
 * route layer validates (`shared/ui-scan.ts`). `bin/browse` restates it, as a
 * separate package that cannot import this one.
 */

/**
 * `bbx-` plus kebab-case segments — the `bbx-` namespace separates published
 * addresses from internal a11y wiring, and the rest is what needs no escaping.
 */
export const CONTROL_ID_PATTERN = /^bbx(?:-[\da-z]+)+$/;

/**
 * Longest address the scan will report, matching the wire schema's cap.
 *
 * It bounds a payload whose entry count is already capped, and it bounds
 * {@link controlAddress}: at 1.6 characters per encoded byte this leaves room
 * for a ~170-byte card path under a prefix, well past any path a box actually
 * carries. A longer one degrades to "no address" at the scan (`scan.ts`), which
 * is a control the dump describes in words — not a payload the boundary
 * rejects whole.
 */
export const MAX_CONTROL_ID_LENGTH = 300;

/** Whether an id is a control address at all, before any lookup. */
export function isControlAddress(id: string): boolean {
  return id.length <= MAX_CONTROL_ID_LENGTH && CONTROL_ID_PATTERN.test(id);
}

/** RFC 4648 base32, lowercased — every character is legal in one address segment. */
const BASE32_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

/**
 * The empty string, which base32 spells as nothing. `0` is outside the alphabet
 * so it cannot collide with the encoding of any other value.
 */
const EMPTY_ENCODING = "0";

function base32(bytes: Uint8Array): string {
  if (bytes.length === 0) return EMPTY_ENCODING;
  let out = "";
  let accumulator = 0;
  let bits = 0;
  for (const byte of bytes) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += BASE32_ALPHABET[(accumulator >>> bits) & 31];
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(accumulator << (5 - bits)) & 31];
  return out;
}

/**
 * An address under `prefix` naming `value`, whatever `value` contains.
 *
 * Encoded rather than slugified because the values are identities: two card
 * paths differing only in case, or in a character the grammar has no room for,
 * are two different tabs and must not share one address. Base32 over UTF-8 is
 * injective and stable across renders and reloads, which is the whole
 * requirement — nothing reads the address back, it is only compared and looked
 * up. The cost is that the id is opaque; a driver copies it out of the snapshot
 * rather than composing it, which is what the snapshot is for.
 */
export function controlAddress(prefix: string, value: string): string {
  return `${prefix}-${base32(new TextEncoder().encode(value))}`;
}
