/**
 * The image card's list row — a thumbnail beside the title, in place of
 * `FileEntry`'s default middle slot.
 *
 * It lives beside `image.tsx` because it is the other half of how an image
 * card presents itself: the schema's `summarize` produces the summary, this
 * renders it. A `*.list-entry.tsx` file is FRONTEND code sitting in the
 * schemas tree — the backend program excludes it, it may reach the schemas
 * and core trees by TYPE import only, and no backend module may import it.
 * `src/frontend/src/file-types/builtins.tsx` registers it; it does not
 * register itself.
 */

import type { ListProps } from "../frontend/src/file-types/registry";
import type { ImageSummaryAttrs } from "./image";
import { apiRawFileUrl, apiTransformedImageUrl, getApiBase } from "../frontend/src/api";
import { resolveRelativePath } from "../frontend/src/lib/view-url";
import { isTransformablePhotoPath } from "../frontend/src/lib/image-transform-url";

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

export function ImageCardListEntry({ data, compact }: ListProps<ImageSummaryAttrs>) {
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
