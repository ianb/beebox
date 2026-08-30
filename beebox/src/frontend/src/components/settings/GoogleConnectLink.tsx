/**
 * "Set up Google connection in Admin" link — rendered below the error
 * state of CalendarSection and DriveSection when Google auth hasn't
 * been established yet.
 *
 * Both sections can be on screen at once, so the `bbx-` control address (see
 * lib/ui-scan) comes from the call site rather than being fixed here.
 */

import { Link, useParams } from "@tanstack/react-router";
import { href } from "../../lib/routing";

export function GoogleConnectLink({ id }: { id: string }) {
  const { boxSlug } = useParams({ strict: false });
  return (
    <div className="mt-3">
      <Link
        id={id}
        to={href(`/${boxSlug}/admin`)}
        className="text-sm text-primary hover:text-primary-dark underline"
      >
        Set up Google connection in Admin
      </Link>
    </div>
  );
}
