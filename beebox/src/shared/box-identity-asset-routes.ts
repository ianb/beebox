const BOX_IDENTITY_ASSET_PATH = /^\/(?!icons\/)[^/]+\/(icon-\d+\.png|manifest\.webmanifest)$/;

export function perBoxIdentityAssetPattern(basePrefix: string): string {
  return `^${basePrefix}${BOX_IDENTITY_ASSET_PATH.source.replaceAll("\\/", "/").slice(1)}`;
}

export function isBoxIdentityAssetPath(path: string): boolean {
  return BOX_IDENTITY_ASSET_PATH.test(path);
}
