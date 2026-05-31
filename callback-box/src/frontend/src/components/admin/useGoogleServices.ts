/**
 * State + server interaction for {@link GoogleServicesSection}: status fetch,
 * OAuth authorize/disconnect, and per-box service toggles. Kept in a `.ts`
 * sibling so the component file stays small and rule-clean.
 */

import { useState, useEffect, useCallback } from "react";
import { RequestError } from "../../lib/errors";

export interface GoogleStatus {
  available: boolean;
  hasTokens: boolean;
  scopes: string[];
  enabledServices: Record<string, boolean>;
}

export interface GoogleServicesState {
  status: GoogleStatus | null;
  loading: boolean;
  error: string | null;
  successMessage: string | null;
  connecting: boolean;
  disconnecting: boolean;
  savingServices: boolean;
  handleAuthorize: () => Promise<void>;
  handleDisconnect: () => Promise<void>;
  handleServiceToggle: (service: string, enabled: boolean) => Promise<void>;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function useGoogleServices(apiBase: string): GoogleServicesState {
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
      if (!resp.ok) {
        const message = `Status check failed: ${resp.status}`;
        throw new RequestError(message);
      }
      const data: GoogleStatus = await resp.json();
      setStatus(data);
      setError(null);
      return data;
    } catch (err) {
      setError(errorMessage(err));
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
        throw new RequestError(data.error || "Setup failed");
      }
      window.location.href = data.authUrl;
    } catch (err) {
      setError(errorMessage(err));
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
        throw new RequestError(data.error || "Disconnect failed");
      }
      await fetchStatus();
    } catch (err) {
      setError(errorMessage(err));
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
        throw new RequestError(data.error || "Failed to save service settings");
      }
      setStatus({ ...status, enabledServices: updated });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSavingServices(false);
    }
  };

  return {
    status,
    loading,
    error,
    successMessage,
    connecting,
    disconnecting,
    savingServices,
    handleAuthorize,
    handleDisconnect,
    handleServiceToggle,
  };
}
