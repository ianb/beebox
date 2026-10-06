/** Client-side defense for Admin's transient secret reveal. This is not server auth. */
export function mayRevealSecretInBrowser(webdriver: boolean): boolean {
  return !webdriver;
}
