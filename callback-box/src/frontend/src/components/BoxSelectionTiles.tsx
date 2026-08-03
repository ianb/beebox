/**
 * Appearance-heavy helpers for the root box-selection page (BoxRedirect).
 * Anchor-as-button styling lives here so the page itself can stay on UI
 * primitives only.
 */

import { Link } from "@tanstack/react-router";
import { href, toSearch } from "../lib/routing";

interface Box {
  slug: string;
  name: string;
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
        <span className="text-lg font-medium text-primary">{box.name}</span>
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
