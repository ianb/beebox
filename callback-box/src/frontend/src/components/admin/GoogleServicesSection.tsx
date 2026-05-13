/**
 * Google OAuth connection + per-service toggles (Calendar/Gmail/Drive).
 * The OAuth link itself is server-wide; which services are enabled is
 * per-box. Only renders if the server has Google OAuth configured.
 */

import { useState, useEffect, useCallback } from "react";
import { CheckboxField } from "../ui/fields";
import { Button } from "../ui/Button";

interface GoogleStatus {
  available: boolean;
  hasTokens: boolean;
  scopes: string[];
  enabledServices: Record<string, boolean>;
}

const GOOGLE_SERVICE_LABELS: Record<string, string> = {
  calendar: "Calendar",
  gmail: "Gmail",
  drive: "Drive",
};

export function GoogleServicesSection({ apiBase }: { apiBase: string }) {
  const [status, setStatus] = useState<GoogleStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [savingServices, setSavingServices] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const resp = await fetch(`${apiBase}/admin/google-status`);
      if (!resp.ok) throw new Error(`Status check failed: ${resp.status}`);
      const data: GoogleStatus = await resp.json();
      setStatus(data);
      setError(null);
      return data;
    } catch (err) {
      setError((err as Error).message);
      return null;
    }
  }, [apiBase]);

  // Mount-only fetch.

  useEffect(() => {
    fetchStatus().finally(() => setLoading(false));
  }, [fetchStatus]);


  // Handle redirect back from Google OAuth — mount-only state read of
  // window.location query params.
  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const googleParam = params.get("google");
    if (googleParam === "connected") {
      setSuccessMessage("Google services connected successfully.");
      window.history.replaceState(null, "", window.location.pathname);
      fetchStatus();
    } else if (googleParam === "error") {
      const message = params.get("message") || "Authorization failed";
      setError(message);
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);
  /* eslint-enable react-hooks/exhaustive-deps */

  const handleAuthorize = async () => {
    setConnecting(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const resp = await fetch(`${apiBase}/admin/google-setup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || "Setup failed");
      }
      window.location.href = data.authUrl;
    } catch (err) {
      setError((err as Error).message);
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const resp = await fetch(`${apiBase}/admin/google-disconnect`, { method: "POST" });
      const data = await resp.json();
      if (!data.success) {
        throw new Error(data.error || "Disconnect failed");
      }
      await fetchStatus();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDisconnecting(false);
    }
  };

  const handleServiceToggle = async (service: string, enabled: boolean) => {
    if (!status) return;
    setSavingServices(true);
    setError(null);

    const updated = { ...status.enabledServices, [service]: enabled };
    try {
      const resp = await fetch(`${apiBase}/admin/box-config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ googleServices: updated }),
      });
      const data = await resp.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to save service settings");
      }
      setStatus({ ...status, enabledServices: updated });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingServices(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-warm-800 mb-4">Google Services</h2>
        <p className="text-sm text-warm-600">Checking status...</p>
      </div>
    );
  }

  if (status && !status.available) {
    return null;
  }

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex items-center gap-2 mb-2">
        <h2 className="text-lg font-semibold text-warm-800">Google Services</h2>
        <span className="text-xs bg-warm-200 text-warm-600 px-2 py-0.5 rounded">Server-wide</span>
      </div>
      <p className="text-sm text-warm-700 mb-4">
        Google account connection is shared across all boxes. Enable specific services per box below.
      </p>

      {successMessage ? (
        <div className="mb-4 p-3 bg-success-50 border border-success-100 rounded text-sm text-success-dark">
          {successMessage}
        </div>
      ) : null}

      {status && status.hasTokens ? (
        <>
          <div className="mb-4 p-3 bg-success-50 border border-success-100 rounded text-sm">
            <span className="font-medium text-success-dark">Connected</span>
          </div>

          <div className="mb-4">
            <h3 className="text-sm font-medium text-warm-700 mb-2">Enabled for this box:</h3>
            <div className="space-y-2">
              {Object.entries(GOOGLE_SERVICE_LABELS).map(([key, label]) => (
                <CheckboxField
                  key={key}
                  label={label}
                  checked={status.enabledServices[key] === true}
                  disabled={savingServices}
                  onChange={(checked) => handleServiceToggle(key, checked)}
                />
              ))}
            </div>
          </div>

          <div className="flex gap-3">
            <Button
              intent="secondary"
              onClick={handleAuthorize}
              loading={connecting}
              loadingLabel="Redirecting…"
            >
              Re-authorize
            </Button>
            <Button
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
