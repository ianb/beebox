/**
 * State + server interaction for {@link GoogleServicesSection}: status fetch,
 * OAuth authorize/disconnect, and per-box service toggles. Kept in a `.ts`
 * sibling so the component file stays small and rule-clean.
 */

import { useState, useEffect, useCallback } from "react";
import { trpcClient } from "../../lib/trpc";

export interface GoogleStatus {
  available: boolean;
  hasTokens: boolean;
  /**
   * When Google rejected the stored authorization (expired or revoked), or null
   * while it works. Tokens can be present AND dead, so this is what decides
   * between "Connected" and "Needs re-authorization".
   */
  needsReauthSince: string | null;
  scopes: string[];
  enabledServices: Record<string, boolean>;
}

export interface GoogleServicesState {
  status: GoogleStatus | null;
  loading: boolean;
  error: string | null;
  connecting: boolean;
  disconnecting: boolean;
  savingServices: boolean;
  handleAuthorize: () => Promise<void>;
  handleDisconnect: () => Promise<void>;
  handleServiceToggle: (service: string, enabled: boolean) => Promise<void>;
  refreshStatus: () => Promise<GoogleStatus | null>;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function useGoogleServices(): GoogleServicesState {
  const [status, setStatus] = useState<GoogleStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [savingServices, setSavingServices] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const data = await trpcClient.admin.googleStatus.query();
      setStatus(data);
      setError(null);
      return data;
    } catch (err) {
      setError(errorMessage(err));
      return null;
    }
  }, []);

  // Mount-only fetch.

  useEffect(() => {
    // fetchStatus catches its own errors into `error` state.
    void fetchStatus().finally(() => setLoading(false));
  }, [fetchStatus]);

  const handleAuthorize = async () => {
    setConnecting(true);
    setError(null);

    try {
      const data = await trpcClient.admin.googleSetup.mutate({});
      window.location.href = data.authUrl;
    } catch (err) {
      setError(errorMessage(err));
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    setError(null);

    try {
      await trpcClient.admin.googleDisconnect.mutate();
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
      await trpcClient.admin.updateBoxConfig.mutate({ googleServices: updated });
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
    connecting,
    disconnecting,
    savingServices,
    handleAuthorize,
    handleDisconnect,
    handleServiceToggle,
    refreshStatus: fetchStatus,
  };
}
