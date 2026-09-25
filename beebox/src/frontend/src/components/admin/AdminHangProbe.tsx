import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { prepareAdminHangProbe, recordAdminProbeEnter, recordAdminProbeQuery, startAdminHangProbe } from "../../lib/admin-hang-probe";

const ProbePageContext = createContext<"admin" | "settings" | null>(null);

/** Temporary probe wrapper; see admin-hang-probe.ts for removal. */
export function AdminHangProbe({ page, children }: { page: "admin" | "settings"; children: ReactNode }) {
  const client = useQueryClient();
  // A one-time render initializer saves a marker before any child can loop.
  // eslint-disable-next-line react/hook-use-state -- This diagnostic uses only the initializer; no state transition exists.
  useState(() => { prepareAdminHangProbe(page); return true; });
  useEffect(() => {
    const stop = startAdminHangProbe(page);
    const unsubscribe = client.getQueryCache().subscribe(event => {
      if (event.type !== "updated" || event.action.type !== "success") return;
      const key = event.query.queryKey;
      // tRPC keys start with a literal path array. Ignore inputs entirely.
      const path = key[0];
      if (!Array.isArray(path) || !path.every(part => typeof part === "string" && /^[A-Za-z][\dA-Za-z]{0,30}$/.test(part))) return;
      const owner = path[0];
      const relevant = page === "admin"
        ? ["admin", "cloudflarePublishConnections", "push", "secrets"].includes(owner)
        : ["calendar", "drive", "pairing", "presentation", "scanTokens"].includes(owner);
      if (relevant) recordAdminProbeQuery(page, path.slice(0, 3).join("."));
    });
    return () => { unsubscribe(); stop(); };
  }, [client, page]);
  return <ProbePageContext.Provider value={page}>{children}</ProbePageContext.Provider>;
}

export function ProbeSection({ name, children }: { name: string; children: ReactNode }) {
  const page = useContext(ProbePageContext);
  if (!page) return children;
  // Runs before the child renders, including when that render never commits.
  recordAdminProbeEnter(page, name);
  return children;
}
