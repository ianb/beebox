/** Local-password account annotations for the box's allowed-email list. */

import { AuthStoreUnavailableError } from "../../local-users-errors.js";
import { listUsers, type LocalUser } from "../../local-users.js";

type AllowedUserKind = "local-member" | "local-owner" | "owner-entry" | "access-only" | "unknown";
type LocalPasswordStatus = "ready" | "not-initialized" | "owner-mismatch" | "unavailable";

interface AllowedUserDetail {
  email: string;
  kind: AllowedUserKind;
  resetEligible: boolean;
}

export function describeAllowedUsers(options: {
  allowedEmails: string[];
  configuredOwnerEmail: string | null;
  signedInEmail: string | null;
}): {
  allowedUserDetails: AllowedUserDetail[];
  localPasswordStatus: LocalPasswordStatus;
  ownerEmail: string | null;
} {
  let localUsers: LocalUser[] | null = [];
  try {
    localUsers = listUsers();
  } catch (error) {
    if (!(error instanceof AuthStoreUnavailableError)) throw error;
    console.warn("[admin.boxConfig] local auth store unavailable; hiding password reset actions:", error);
    localUsers = null;
  }
  const localOwnerEmail = localUsers?.find((user) => user.role === "owner")?.email ?? null;
  const ownerEmail = options.configuredOwnerEmail ?? localOwnerEmail;
  let localPasswordStatus: LocalPasswordStatus;
  if (localUsers === null) localPasswordStatus = "unavailable";
  else if (localOwnerEmail === null) localPasswordStatus = "not-initialized";
  else if (options.signedInEmail !== localOwnerEmail) localPasswordStatus = "owner-mismatch";
  else localPasswordStatus = "ready";
  const localUsersByEmail = new Map(localUsers?.map((user) => [user.email, user]));
  const allowedUserDetails: AllowedUserDetail[] = options.allowedEmails.map((email) => {
    const localUser = localUsersByEmail.get(email);
    const kind: AllowedUserKind = email === ownerEmail
      ? "owner-entry"
      : localUsers === null
        ? "unknown"
        : localUser?.role === "member"
          ? "local-member"
          : localUser?.role === "owner"
            ? "local-owner"
            : "access-only";
    return { email, kind, resetEligible: kind === "local-member" };
  });
  return { allowedUserDetails, localPasswordStatus, ownerEmail };
}
