/**
 * Custom ListComponent for image cards — renders a thumbnail alongside the
 * title in the FileEntry middle slot. Demonstrates the extension point.
 *
 * The attached image file sits in the same directory as the .image.card,
 * with its filename recorded in the loader's computed attrs.
 */

import type { ListProps } from "../../file-types/registry";
import type { ImageAttrs } from "../../../../schemas/image";
import { getApiBase } from "../../api";

function imageSrc(cardPath: string, filename: string): string {
  const slash = cardPath.lastIndexOf("/");
  const dir = slash === -1 ? "" : cardPath.slice(0, slash + 1);
  return `${getApiBase()}/files/${dir}${filename}`;
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
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="truncate text-warm-800 font-medium">{data.title}</span>
        {compact ? null : (
          <span className="truncate text-xs text-warm-500" title={data.path}>
            {data.path}
          </span>
        )}
      </div>
    </div>
  );
}
