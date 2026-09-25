/** URL paths shared by agent output and the member publication page. */

export type PublicationAudienceTier = "public" | "secret" | "accounts" | "any-account";

export interface PublicationUrlScope {
  tier: PublicationAudienceTier;
  slug?: string;
  allowedEmails?: string[];
  customHostname?: string;
}

export function samePublicationAudience(args: {
  requested: PublicationUrlScope | null;
  approved: PublicationUrlScope | null;
}): boolean {
  const { requested, approved } = args;
  if (requested === null || approved === null || requested.tier !== approved.tier) return false;
  if ((requested.customHostname ?? null) !== (approved.customHostname ?? null)) return false;
  if (requested.tier === "public" && approved.tier === "public") return (requested.slug ?? null) === (approved.slug ?? null);
  if (requested.tier === "accounts" && approved.tier === "accounts") {
    return JSON.stringify([...(requested.allowedEmails ?? [])].toSorted()) === JSON.stringify([...(approved.allowedEmails ?? [])].toSorted());
  }
  return requested.tier === "secret" || requested.tier === "any-account";
}

export function publicationUrl(args: {
  workersHostname: string | null;
  pubId: string;
  scope: PublicationUrlScope | null;
}): string | null {
  const { workersHostname, pubId, scope } = args;
  if (scope === null) return null;
  const hostname = scope.customHostname ?? workersHostname;
  if (hostname === null) return null;
  let path: string;
  if (scope.tier === "public") {
    path = scope.customHostname === undefined && scope.slug !== undefined ? `/p/${encodeURIComponent(scope.slug)}/` : "/";
  } else if (scope.tier === "secret") {
    path = `/s/${encodeURIComponent(pubId)}/`;
  } else {
    path = `/a/${encodeURIComponent(pubId)}/`;
  }
  return new URL(path, `https://${hostname}`).toString();
}
