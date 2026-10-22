/**
 * The profile menu's trigger, the avatar, apart from its menu so the theme
 * studio renders the same button with fixed props (see `AppNav/nav.tsx`).
 */

import type { DropdownTriggerProps } from "../ui/Dropdown";
import { Avatar } from "../ui/Avatar";

/** Who the avatar draws; null before sign-in is known. */
export interface ProfileButtonUser {
  name: string;
  email: string | null;
  picture?: string;
}

export function ProfileButtonFace({ user, onClick, ariaProps }: {
  user: ProfileButtonUser | null;
  onClick: DropdownTriggerProps["toggle"];
  ariaProps: DropdownTriggerProps["ariaProps"];
}) {
  return (
    <button
      type="button"
      id="bbx-nav-profile"
      data-bbx-reveal
      data-bbx-does={`opens the profile menu — settings, admin, dashboard, browse, history, storage summary, source view, debug log, reload${user ? ", sign out" : ""}`}
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-full hover:ring-2 hover:ring-white/30 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
      title={user ? user.name : "Menu"}
      {...ariaProps}
    >
      <Avatar
        name={user ? user.name : null}
        email={user ? user.email : null}
        picture={user ? user.picture : null}
        fallbackClassName="bg-white/10"
      />
    </button>
  );
}
