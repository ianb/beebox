/**
 * Google OAuth connection + per-service toggles (Calendar/Gmail/Drive).
 * The OAuth link itself is server-wide; which services are enabled is
 * per-box. Only renders if the server has Google OAuth configured.
 */

import { CheckboxField } from "../ui/fields";
import { Button } from "../ui/Button";
import { useGoogleServices } from "./useGoogleServices";

const GOOGLE_SERVICE_LABELS: Record<string, string> = {
  calendar: "Calendar",
  gmail: "Gmail",
  drive: "Drive",
};

export function GoogleServicesSection() {
  const {
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
  } = useGoogleServices();

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
