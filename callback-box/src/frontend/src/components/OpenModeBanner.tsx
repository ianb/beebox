/**
 * Persistent, non-dismissible banner shown on every page when the server is
 * running with authentication disabled (`CB_ALLOW_UNAUTHENTICATED`). Mounted
 * at the root layout (see `app-shell.tsx` `RootLayout`) so it's visible
 * regardless of which page — box, login, setup — is showing.
 *
 * Deliberately has no dismiss control: the open-mode risk (anyone who can
 * reach this server has full access) doesn't stop being true because someone
 * closed a banner.
 */

import { useOpenMode } from "../hooks/useCurrentUser";

function WarningIcon() {
  return (
    <svg
      className="w-4 h-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
      />
    </svg>
  );
}

export function OpenModeBanner() {
  const open = useOpenMode();
  if (!open) return null;

  return (
    <div role="alert" className="w-full bg-danger-dark text-white px-4 py-2 flex items-center gap-2 text-sm">
      <WarningIcon />
      <span>
        <strong className="font-semibold">Authentication is disabled.</strong>{" "}
        Anyone who can reach this server has full access to this box — there is
        no sign-in wall. Unset <code>CB_ALLOW_UNAUTHENTICATED</code> and restart
        to require sign-in, or run <code>cb auth create-user</code> to add an
        account without disabling open mode.
      </span>
    </div>
  );
}
