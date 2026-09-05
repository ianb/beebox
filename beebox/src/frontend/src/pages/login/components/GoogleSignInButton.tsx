/**
 * Anchor styled as a button, navigating to the backend's `/auth/google`
 * redirect (a real OAuth consent hop, not a client-side route — so this is a
 * plain `<a>`, not a router `<Link>`). Colocated under login/components/ so
 * the appearance classes stay next to the one page that uses it (exempt from
 * `restrict-component-classes` per the `components/` convention).
 */

import { withBase } from "../../../api";

export function GoogleSignInButton({ returnTo }: { returnTo: string }) {
  return (
    <a
      id="bbx-login-google"
      href={withBase(`/auth/google?returnTo=${encodeURIComponent(returnTo)}`)}
      className="inline-flex w-full items-center justify-center bg-white text-warm-800 border border-warm-300 px-4 py-2.5 rounded-lg font-medium hover:bg-warm-50 transition-colors"
    >
      Sign in with Google
    </a>
  );
}
