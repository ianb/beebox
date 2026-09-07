import { parseViewUrl, serializeViewUrl } from "../../../lib/view-url";

/** Match ViewPage parsing, including named renderer and view state query. */
export function routeCardAttentionRef(splat: string | undefined, search: string): string | null {
  return splat ? `/${serializeViewUrl(parseViewUrl(`${splat}${search}`))}` : null;
}
