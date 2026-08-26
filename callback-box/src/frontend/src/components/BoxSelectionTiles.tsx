/**
 * Appearance-heavy helpers for the root box-selection page (BoxRedirect).
 * Anchor-as-button styling lives here so the page itself can stay on UI
 * primitives only.
 */

import { Link } from "@tanstack/react-router";
import { href, toSearch } from "../lib/routing";
import { apiFileUrl } from "../lib/view-url";

interface Box {
  slug: string;
  name: string;
  symbol?: string;
  symbolSrc?: string | null;
}

/**
 * The box's own mark, beside its name.
 *
 * This is the selector: the one screen whose whole job is telling boxes
 * apart, and until now it told them apart by name alone. The mark is the same
 * one the box's tab and its notifications carry, so a box looks like itself
 * everywhere.
 *
 * A box with no mark renders nothing rather than a placeholder — an empty
 * slot beside a name reads as "no icon yet", which is true, while a generic
 * glyph on every box would read as a mark that happens to be identical.
 */
function BoxMark({ box }: { box: Box }) {
  if (box.symbolSrc !== undefined && box.symbolSrc !== null) {
    return (
      <img
        src={apiFileUrl(box.slug, box.symbolSrc)}
        alt=""
        className="w-6 h-6 object-contain flex-shrink-0"
      />
    );
  }
  if (box.symbol !== undefined && box.symbol !== "") {
    // Decorative: the name beside it already identifies the box, so a screen
    // reader announcing the emoji's CLDR name would only repeat it noisily.
    return <span aria-hidden="true" className="text-lg leading-none flex-shrink-0">{box.symbol}</span>;
  }
  return null;
}

/**
 * Routes to the login page (a client-side SPA route, not a raw redirect) —
 * the login page itself offers password sign-in and, when configured,
 * "Sign in with Google" (`GET /auth/methods`). `returnTo` carries through
 * as a search param so login lands the user back where they started.
 */
export function SignInLink({ returnTo }: { returnTo: string }) {
  return (
    <Link
      id="cb-box-selection-sign-in"
      to={href("/auth/login")}
      search={toSearch({ returnTo })}
      className="inline-block bg-primary text-white px-6 py-3 rounded-lg font-medium hover:bg-primary-dark transition-colors"
    >
      Sign in
    </Link>
  );
}

/**
 * Full tile for the root box selector: clickable box name (lands on the
 * box's chat via the index redirect) + a quick-jump Capture row. No Chat
 * quick link — the name itself lands on chat now.
 */
export function BoxActionsTile({ box }: { box: Box }) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-warm-300 overflow-hidden">
      <Link
        to={href(`/${box.slug}/`)}
        className="block px-6 py-3 hover:bg-warm-50 active:bg-warm-100"
      >
        <span className="flex items-center gap-2">
          <BoxMark box={box} />
          <span className="text-lg font-medium text-primary">{box.name}</span>
        </span>
      </Link>
      <div className="border-t border-warm-200">
        <Link
          to={href(`/${box.slug}/chat`)}
          search={toSearch({ capture: "1" })}
          className="block py-4 text-center text-base font-medium text-primary hover:bg-warm-50 active:bg-warm-100"
        >
          Capture
        </Link>
      </div>
    </div>
  );
}
