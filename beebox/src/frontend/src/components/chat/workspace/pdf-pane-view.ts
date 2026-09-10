import { getRenderers } from "../../../renderers";

/** Mirror FileView's fallback for old or unrecognized view names. */
export function isWorkspacePdf(path: string, viewer: string | null): boolean {
  if (!/\.pdf$/i.test(path)) return false;
  const renderers = getRenderers(path, { path });
  const active = renderers.find((renderer) => renderer.name === viewer) ?? renderers.at(0);
  return active?.name === "PDF";
}
