/**
 * Google OAuth connection + per-service toggles (Calendar/Gmail/Drive).
 * The OAuth link itself is server-wide; which services are enabled is
 * per-box. Only renders if the server has Google OAuth configured.
 *
 * `?reconnect=google` is the deep link the health warning and the proactive
 * "your Google connection died" notification both point at — it scrolls this
 * section into view so the boxholder lands on the Re-authorize button rather
 * than on the top of a long admin page.
 */

import { useEffect, useRef, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { adminArrivalKey, shouldAcknowledgeAdminArrival, shouldConsumeAdminArrival, type AdminArrivalState } from "../../../lib/admin-card-state";
import { useCardVisible } from "../../chat/everywhere/card-context/context";
import { CheckboxField } from "../../ui/fields/field";
import { Button } from "../../ui/Button";
import { Notice } from "../../ui/Notice";
import { ExternalLink } from "../../ui/ExternalLink";
import { useGoogleServices } from "./useGoogleServices";
import { AdminSectionCard } from "../AdminSectionCard";
import { adminSectionElementId } from "../sections";

const GOOGLE_SERVICE_LABELS: Record<string, string> = {
  calendar: "Calendar",
  gmail: "Gmail",
  drive: "Drive",
};

const DESCRIPTION = "Google account connection is shared across all boxes. Enable specific services per box below.";

export function GoogleServicesSection({ arrival, arrivalReceipt, onArrivalConsumed }: { arrival: AdminArrivalState; arrivalReceipt: string; onArrivalConsumed: () => void }) {
  const {
    status,
    loading,
    error,
    connecting,
    disconnecting,
    savingServices,
    handleAuthorize,
    handleDisconnect,
    handleServiceToggle,
    refreshStatus,
  } = useGoogleServices();

  const visible = useCardVisible();
  const processedArrival = useRef<string | null>(null);
  const historyIndex = useRouterState({ select: state => state.location.state.__TSR_index });
  const observedIndex = useRef(historyIndex);
  const [arrivalNotice, setArrivalNotice] = useState<AdminArrivalState>({});
  const arrivalKey = adminArrivalKey(arrival);

  useEffect(() => {
    // A Back traversal ends the receipt lifetime, even while this card is hidden.
    // Redirect/acknowledgement replacements keep the index and must not replay.
    if (observedIndex.current !== historyIndex) {
      observedIndex.current = historyIndex;
      processedArrival.current = null;
    }
    if (arrivalKey === null || !shouldAcknowledgeAdminArrival({ arrival, visible, loading })) return;
    if (!shouldConsumeAdminArrival({ arrival, visible, loading, alreadyProcessed: processedArrival.current === arrivalReceipt })) {
      onArrivalConsumed();
      return;
    }
    processedArrival.current = arrivalReceipt;
    setArrivalNotice(arrival);
    if (arrival.google === "connected") void refreshStatus();
    if (arrival.reconnect === "google") {
      document.getElementById(adminSectionElementId("google-services"))?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    onArrivalConsumed();
  }, [arrival, arrivalKey, arrivalReceipt, historyIndex, loading, onArrivalConsumed, refreshStatus, visible]);

  const notice = Object.keys(arrival).length === 0 ? arrivalNotice : arrival;

  if (loading) {
    return (
      <AdminSectionCard id="google-services" description={DESCRIPTION} busy>
        <ArrivalNotice arrival={notice} />
        <p className="text-sm text-warm-700">Checking status...</p>
      </AdminSectionCard>
    );
  }

  if (status && !status.available) {
    return (
      <AdminSectionCard id="google-services" description={DESCRIPTION}>
        <ArrivalNotice arrival={notice} />
        <p className="text-sm text-warm-700">Google OAuth is not configured on this host.</p>
      </AdminSectionCard>
    );
  }

  return (
    <AdminSectionCard id="google-services" description={DESCRIPTION}>
      <ArrivalNotice arrival={notice} />

      {status && status.hasTokens ? (
        <>
          {status.needsReauthSince ? (
            <Notice tone="error" className="mb-4">
              <span className="font-medium">Needs re-authorization</span>
              <p>
                Google rejected the stored authorization — it expired or was revoked. Calendar,
                Gmail and Drive sync are paused until you re-authorize.
              </p>
            </Notice>
          ) : (
            <div className="mb-4 p-3 bg-success-50 border border-success-100 rounded text-sm">
              <span className="font-medium text-success-dark">Connected</span>
            </div>
          )}

          <div className="mb-4">
            <h3 className="text-sm font-medium text-warm-700 mb-2">Enabled for this box:</h3>
            <div className="space-y-2">
              {Object.entries(GOOGLE_SERVICE_LABELS).map(([key, label]) => (
                <CheckboxField
                  key={key}
                  id={`bbx-admin-google-service-${key}`}
                  label={label}
                  checked={status.enabledServices[key] === true}
                  disabled={savingServices}
                  onChange={(checked) => void handleServiceToggle(key, checked)}
                />
              ))}
            </div>
            {status.driveDocsApi !== null ? (
              <Notice tone="warning" id="bbx-admin-google-drive-docs-api" className="mt-2 space-y-1">
                <p>{status.driveDocsApi.message}</p>
                {status.driveDocsApi.link !== null ? (
                  <ExternalLink id="bbx-admin-google-drive-enable-docs-api" href={status.driveDocsApi.link}>
                    Enable the Docs API
                  </ExternalLink>
                ) : null}
              </Notice>
            ) : null}
          </div>

          <div className="flex gap-3">
            <Button
              id="bbx-admin-google-reauthorize"
              intent={status.needsReauthSince ? "primary" : "secondary"}
              onClick={handleAuthorize}
              loading={connecting}
              loadingLabel="Redirecting…"
            >
              Re-authorize
            </Button>
            <Button
              id="bbx-admin-google-disconnect"
              intent="secondary"
              onClick={handleDisconnect}
              loading={disconnecting}
              loadingLabel="Disconnecting…"
            >
              Disconnect
            </Button>
          </div>
        </>
      ) : (
        <Button
          id="bbx-admin-google-connect"
          intent="primary"
          onClick={handleAuthorize}
          loading={connecting}
          loadingLabel="Redirecting…"
        >
          Connect Google Account
        </Button>
      )}

      {error ? (
        <Notice tone="error" className="mt-3">{error}</Notice>
      ) : null}
    </AdminSectionCard>
  );
}

function ArrivalNotice({ arrival }: { arrival: AdminArrivalState }) {
  if (arrival.google === "connected") return <div className="mb-4 p-3 bg-success-50 border border-success-100 rounded text-sm text-success-dark">{arrival.message || "Google services connected successfully."}</div>;
  if (arrival.google === "error") return <Notice tone="error" className="mb-4">{arrival.message || "Authorization failed"}</Notice>;
  return null;
}
