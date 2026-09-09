/**
 * Custom ListComponent for image cards — renders a thumbnail alongside the
 * title in the FileEntry middle slot. Demonstrates the extension point.
 *
 * The attached image file lives in the card's attach scope; the loader's
 * computed `filename` attr uses the `attach/…` virtual prefix.
 */

import type { ListProps } from "../../file-types/registry";
import type { ImageAttrs } from "@schemas/image";
import { apiRawFileUrl, apiTransformedImageUrl, getApiBase } from "../../api";
import { resolveRelativePath } from "../../lib/view-url";
import { isTransformablePhotoPath } from "../../lib/image-transform-url";

function imageSrc(cardPath: string, filenameRef: string): string {
  const resolved = resolveRelativePath(cardPath, filenameRef);
  // Escaping ref → empty src: the thumbnail shows broken rather than pulling in
  // whatever a clamped-to-root path resolved to.
  if (resolved === null) return "";
  const apiBase = getApiBase();
  if (!isTransformablePhotoPath(filenameRef)) return apiRawFileUrl(apiBase, resolved);
  return apiTransformedImageUrl({
    apiBase,
    path: resolved,
    options: { width: 48, height: 48, fit: "cover", quality: 80, format: "auto" },
  });
}

export function ImageCardListEntry({ data, compact }: ListProps<ImageAttrs>) {
  const filename = data.attrs ? data.attrs.filename : undefined;

  return (
    <div className="flex min-w-0 items-center gap-2">
      {filename ? (
        <img
          src={imageSrc(data.path, filename)}
          alt=""
          className="w-6 h-6 rounded object-cover flex-shrink-0 bg-warm-100"
          loading="lazy"
        />
      ) : null}
      <div className="min-w-0">
        <div className="truncate text-warm-800 font-medium">{data.title}</div>
        {compact ? null : (
          <div className="truncate text-xs text-warm-500" title={data.path}>
            {data.path}
          </div>
        )}
      </div>
    </div>
  );
}
