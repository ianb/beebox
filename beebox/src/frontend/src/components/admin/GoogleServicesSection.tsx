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
import { adminArrivalKey, shouldAcknowledgeAdminArrival, shouldConsumeAdminArrival, type AdminArrivalState } from "../../lib/admin-card-state";
import { useCardVisible } from "../chat/everywhere/card-context";
import { CheckboxField } from "../ui/fields";
import { Button } from "../ui/Button";
import { useGoogleServices } from "./useGoogleServices";

const GOOGLE_SERVICE_LABELS: Record<string, string> = {
  calendar: "Calendar",
  gmail: "Gmail",
  drive: "Drive",
};

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

  const sectionRef = useRef<HTMLDivElement>(null);
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
    if (arrival.reconnect === "google") sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    onArrivalConsumed();
  }, [arrival, arrivalKey, arrivalReceipt, historyIndex, loading, onArrivalConsumed, refreshStatus, visible]);

  const notice = Object.keys(arrival).length === 0 ? arrivalNotice : arrival;

  if (loading) {
    return (
      <div ref={sectionRef} className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-warm-800 mb-4">Google Services</h2>
        <ArrivalNotice arrival={notice} />
        <p className="text-sm text-warm-600">Checking status...</p>
      </div>
    );
  }

  if (status && !status.available) {
    return <div ref={sectionRef} className="bg-white rounded-lg shadow p-6"><h2 className="text-lg font-semibold text-warm-800 mb-4">Google Services</h2><ArrivalNotice arrival={notice} /><p className="text-sm text-warm-600">Google OAuth is not configured on this host.</p></div>;
  }

  return (
    <div ref={sectionRef} className="bg-white rounded-lg shadow p-6">
      <div className="flex items-center gap-2 mb-2">
        <h2 className="text-lg font-semibold text-warm-800">Google Services</h2>
        <span className="text-xs bg-warm-200 text-warm-600 px-2 py-0.5 rounded">Server-wide</span>
      </div>
      <p className="text-sm text-warm-700 mb-4">
        Google account connection is shared across all boxes. Enable specific services per box below.
      </p>

      <ArrivalNotice arrival={notice} />

      {status && status.hasTokens ? (
        <>
          {status.needsReauthSince ? (
            <div className="mb-4 p-3 bg-danger-50 border border-danger-100 rounded text-sm text-danger-dark">
              <span className="font-medium">Needs re-authorization</span>
              <p>
                Google rejected the stored authorization — it expired or was revoked. Calendar,
                Gmail and Drive sync are paused until you re-authorize.
              </p>
            </div>
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
        <div className="mt-3 p-3 bg-danger-50 border border-danger-100 rounded text-sm text-danger-dark">
          {error}
        </div>
      ) : null}
    </div>
  );
}

function ArrivalNotice({ arrival }: { arrival: AdminArrivalState }) {
  if (arrival.google === "connected") return <div className="mb-4 p-3 bg-success-50 border border-success-100 rounded text-sm text-success-dark">{arrival.message || "Google services connected successfully."}</div>;
  if (arrival.google === "error") return <div className="mb-4 p-3 bg-danger-50 border border-danger-100 rounded text-sm text-danger-dark">{arrival.message || "Authorization failed"}</div>;
  return null;
}
