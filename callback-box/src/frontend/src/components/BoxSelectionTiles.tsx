/**
 * Appearance-heavy helpers for the root box-selection page (BoxRedirect).
 * Anchor-as-button styling lives here so the page itself can stay on UI
 * primitives only.
 */

import { Link } from "@tanstack/react-router";
import { withBase } from "../api";
import { href } from "../lib/routing";

interface Box {
  slug: string;
  name: string;
}

export function SignInLink({ returnTo }: { returnTo: string }) {
  return (
    <a
      href={withBase(`/auth/login?returnTo=${encodeURIComponent(returnTo)}`)}
      className="inline-block bg-primary text-white px-6 py-3 rounded-lg font-medium hover:bg-primary-dark transition-colors"
    >
      Sign in with Google
    </a>
  );
}

/**
 * Full tile for the root box selector: clickable box name + split row for
 * quick-jump Chat / Capture.
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
      <div className="grid grid-cols-2 divide-x divide-warm-200 border-t border-warm-200">
        <Link
          to={href(`/${box.slug}/chat`)}
          className="py-4 text-center text-base font-medium text-primary hover:bg-warm-50 active:bg-warm-100"
        >
          Chat
        </Link>
        <Link
          to={href(`/${box.slug}/capture`)}
          className="py-4 text-center text-base font-medium text-primary hover:bg-warm-50 active:bg-warm-100"
        >
          Capture
        </Link>
      </div>
    </div>
  );
}
