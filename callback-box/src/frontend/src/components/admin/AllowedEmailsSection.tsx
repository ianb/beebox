/**
 * Allowed-emails access control for a box. Owner is always listed and cannot
 * be removed. Empty allowlist means any authenticated user can access.
 */

import { useState, useEffect, useCallback } from "react";
import { TextField } from "../ui/fields";
import { Button } from "../ui/Button";
import { trpcClient } from "../../lib/trpc";

export function AllowedEmailsSection() {
  const [emails, setEmails] = useState<string[]>([]);
  const [ownerEmail, setOwnerEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newEmail, setNewEmail] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchConfig = useCallback(async () => {
    try {
      const data = await trpcClient.admin.boxConfig.query();
      setEmails(data.allowedEmails ?? []);
      setOwnerEmail(data.ownerEmail ?? null);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  // Mount-only fetch — the setLoading calls are the standard
  // "show spinner, fetch, hide spinner" pattern; nothing to be derived
  // from existing state here.

  useEffect(() => {
    setLoading(true);
    // fetchConfig catches its own errors into `error` state.
    void fetchConfig().finally(() => setLoading(false));
  }, [fetchConfig]);


  const saveEmails = async (updated: string[]) => {
    setSaving(true);
    setError(null);
    try {
      const data = await trpcClient.admin.updateBoxConfig.mutate({ allowedEmails: updated });
      setEmails(data.allowedEmails ?? updated);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleAdd = () => {
    const email = newEmail.trim().toLowerCase();
    if (!email || !email.includes("@")) return;
    if (emails.includes(email)) {
      setNewEmail("");
      return;
    }
    const updated = [...emails, email];
    setNewEmail("");
    // saveEmails catches its own errors into `error` state.
    void saveEmails(updated);
  };

  const handleRemove = (email: string) => {
    void saveEmails(emails.filter((e) => e !== email));
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-warm-800 mb-4">Allowed Users</h2>
        <p className="text-sm text-warm-600">Loading...</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-lg font-semibold text-warm-800 mb-2">Allowed Users</h2>
      <p className="text-sm text-warm-700 mb-4">
        Email addresses that can access this box. Leave empty to allow all authenticated users.
      </p>

      {ownerEmail ? (
        <div className="mb-4 p-2 bg-warm-50 border border-warm-200 rounded text-sm flex items-center gap-2">
          <span className="flex-1 text-warm-800">{ownerEmail}</span>
          <span className="text-xs text-warm-500">owner — always has access</span>
        </div>
      ) : null}

      {emails.length > 0 ? (
        <div className="mb-4 space-y-2">
          {emails.map((email) => (
            <div key={email} className="flex items-center gap-2 p-2 bg-warm-50 border border-warm-200 rounded text-sm">
              <span className="flex-1 text-warm-800">{email}</span>
              <button
                onClick={() => handleRemove(email)}
                disabled={saving}
                aria-label={`Remove ${email}`}
                className="text-warm-500 hover:text-danger-dark text-xs px-2"
              >
                remove
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="mb-4 p-3 bg-warm-50 border border-warm-200 rounded text-sm text-warm-600">
          No restrictions — all authenticated users can access this box.
        </div>
      )}

      <div className="flex gap-2 items-start">
        <TextField
          label="Allowed email"
          hideLabel
          type="email"
          value={newEmail}
          onChange={setNewEmail}
          onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
          placeholder="user@example.com"
          className="flex-1"
        />
        <Button
          intent="primary"
          onClick={handleAdd}
          disabled={!newEmail.trim().includes("@")}
          loading={saving}
          loadingLabel="Saving…"
        >
          Add
        </Button>
      </div>

      {error ? (
        <div className="mt-3 p-3 bg-danger-50 border border-danger-100 rounded text-sm text-danger-dark">
          {error}
        </div>
      ) : null}
    </div>
  );
}
