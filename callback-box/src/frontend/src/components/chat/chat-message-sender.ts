interface ChatUserIdentity {
  locallyAuthored?: boolean;
  senderEmail: string | undefined;
  senderName: string | null | undefined;
  currentUserEmail: string | undefined;
  currentUserName: string | undefined;
}

/** Compare like identity fields; email is authoritative when the entry has it. */
export function isOtherChatUser(identity: ChatUserIdentity): boolean {
  if (identity.locallyAuthored === true) return false;
  if (identity.currentUserEmail === undefined) return false;
  if (identity.senderEmail !== undefined) return identity.senderEmail !== identity.currentUserEmail;
  if (identity.currentUserName === undefined || identity.senderName === null || identity.senderName === undefined) return false;
  return identity.senderName !== identity.currentUserName;
}
