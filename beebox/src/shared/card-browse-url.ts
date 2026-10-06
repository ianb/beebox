/** App URL for a box card's browse page: `/<boxSlug>/browse/<card path>` with each segment encoded. */
export function cardBrowseUrl(args: { boxSlug: string; cardPath: string }): string {
  const encoded = args.cardPath.split("/").map((segment) => encodeURIComponent(segment)).join("/");
  return `/${encodeURIComponent(args.boxSlug)}/browse/${encoded}`;
}
