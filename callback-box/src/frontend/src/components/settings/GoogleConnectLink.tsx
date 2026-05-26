/**
 * "Set up Google connection in Admin" link — rendered below the error
 * state of CalendarSection and DriveSection when Google auth hasn't
 * been established yet.
 */

import { Link, useParams } from "@tanstack/react-router";
import { href } from "../../lib/routing";

export function GoogleConnectLink() {
  const { boxSlug } = useParams({ strict: false });
  return (
    <div className="mt-3">
      <Link
        to={href(`/${boxSlug}/admin`)}
        className="text-sm text-primary hover:text-primary-dark underline"
      >
        Set up Google connection in Admin
      </Link>
    </div>
  );
}
