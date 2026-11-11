/**
 * "Set up Google connection for <service> in Admin" link — rendered below the
 * error state of CalendarSection and DriveSection when Google auth hasn't
 * been established yet. `GoogleServiceProblem` is that error state.
 *
 * Both sections can be on screen at once, so the `bbx-` control address (see
 * lib/ui-scan) comes from the call site rather than being fixed here, and the
 * name says which service the link is for.
 */

import { Link, useParams } from "@tanstack/react-router";
import { href } from "../../lib/routing";
import { SYSTEM_CARD_PATHS } from "@shared/system-card-paths";
import { Notice } from "../ui/Notice";

export function GoogleConnectLink({ id, service }: { id: string; service: "Calendar" | "Drive" }) {
  const { boxSlug } = useParams({ strict: false });
  return (
    <div className="mt-3">
      <Link
        id={id}
        to={href(`/${boxSlug}/views/${SYSTEM_CARD_PATHS.admin}`)}
        className="text-sm text-primary hover:text-primary-dark underline"
      >
        Set up Google connection for {service} in Admin
      </Link>
    </div>
  );
}

/**
 * Why a Google section cannot load. FORBIDDEN is the box's `googleServices`
 * switch (`webapp/trpc/google-service.ts`); its server message is written for
 * the agent and names a config file, so the page says it in its own words.
 * Other refusals (no authorization yet) show the server's message.
 */
export function GoogleServiceProblem({ error, id, service }: {
  error: { message: string; data?: { code?: string } | null };
  id: string;
  service: "Calendar" | "Drive";
}) {
  const off = error.data?.code === "FORBIDDEN";
  return (
    <>
      <Notice tone="warning">{off ? `${service} is turned off for this box. Turn it on under Google services in Admin.` : error.message}</Notice>
      <GoogleConnectLink id={id} service={service} />
    </>
  );
}
