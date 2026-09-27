export function perBoxIdentityAssetPattern(basePrefix: string): string {
  return `^${basePrefix}/(?!icons/)[^/]+/(icon-\\d+\\.png|manifest\\.webmanifest)$`;
}
