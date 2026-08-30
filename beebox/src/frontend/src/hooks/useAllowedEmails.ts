import { useEffect, useState } from "react";
import { withBase } from "../api";
import { trpc, trpcClient } from "../lib/trpc";
import { errorMessage } from "@shared/error-guards";

export interface ResetLink {
  email: string;
  url: string;
  expiresAt: number;
}

/** State and mutation handlers for the allowed-users admin section. */
export function useAllowedEmails() {
  const configQuery = trpc.admin.boxConfig.useQuery();
  const updateMutation = trpc.admin.updateBoxConfig.useMutation();
  const resetMutation = trpc.admin.createPasswordReset.useMutation();
  const utils = trpc.useUtils();
  const [emails, setEmails] = useState<string[]>([]);
  const [newEmail, setNewEmail] = useState("");
  const [checking, setChecking] = useState(false);
  const [pendingExistingEmail, setPendingExistingEmail] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [resetLink, setResetLink] = useState<ResetLink | null>(null);
  const [resettingEmail, setResettingEmail] = useState<string | null>(null);
  const [removingEmail, setRemovingEmail] = useState<string | null>(null);

  useEffect(() => {
    if (configQuery.data) setEmails(configQuery.data.allowedEmails);
  }, [configQuery.data]);

  const saveEmails = async (updated: string[], removedEmail?: string) => {
    setLocalError(null);
    setRemovingEmail(removedEmail ?? null);
    try {
      const data = await updateMutation.mutateAsync({ allowedEmails: updated });
      setEmails(data.allowedEmails);
      setResetLink(null);
      await utils.admin.boxConfig.invalidate();
    } catch (_error) {
      // Mutation error is rendered below.
    } finally {
      setRemovingEmail(null);
    }
  };

  const addEmail = async () => {
    const email = newEmail.trim().toLowerCase();
    if (!email.includes("@")) return;
    if (email === configQuery.data?.ownerEmail) {
      setNewEmail("");
      setLocalError("The owner already has access and does not need to be added.");
      return;
    }
    if (emails.includes(email)) {
      setNewEmail("");
      return;
    }
    if (pendingExistingEmail !== email) {
      setChecking(true);
      setLocalError(null);
      try {
        const status = await trpcClient.admin.localAccountStatus.query({ email });
        if (status.exists) {
          setPendingExistingEmail(email);
          return;
        }
      } catch (error) {
        setLocalError(errorMessage(error));
        return;
      } finally {
        setChecking(false);
      }
    }
    setNewEmail("");
    setPendingExistingEmail(null);
    await saveEmails([...emails, email]);
  };

  const createReset = async (email: string) => {
    setResetLink(null);
    setLocalError(null);
    updateMutation.reset();
    resetMutation.reset();
    setResettingEmail(email);
    try {
      const result = await resetMutation.mutateAsync({ email });
      setResetLink({
        email,
        url: `${window.location.origin}${withBase(result.resetPath)}`,
        expiresAt: result.expiresAt,
      });
    } catch (_error) {
      await utils.admin.boxConfig.invalidate();
    } finally {
      setResettingEmail(null);
    }
  };

  return {
    configQuery,
    updateMutation,
    resetMutation,
    emails,
    newEmail,
    setNewEmail,
    checking,
    pendingExistingEmail,
    setPendingExistingEmail,
    localError,
    resetLink,
    resettingEmail,
    removingEmail,
    saveEmails,
    addEmail,
    createReset,
  };
}
