import { useEffect } from "react";

/**
 * Advertises the current box to the callback-clerk browser extension via a
 * <meta name="callback-box"> head tag carrying the box identity as JSON:
 * `{ slug, title, boxUrl }`. `boxUrl` is the absolute box root (origin +
 * Vite base + slug), so deployed (`/main`) and dev-router (`/<wt>/test1`)
 * layouts need no path parsing on the extension side. The extension reads
 * the tag from the active tab and offers to enable the box — see
 * docs/plans/refresh-clerk.md, Track B.
 */
export function useBoxIdentityMeta(box: { slug: string; name: string } | null) {
  const slug = box === null ? null : box.slug;
  const title = box === null ? null : box.name;

  useEffect(() => {
    if (slug === null || title === null) return;
    const base = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
    const boxUrl = `${window.location.origin}${base}/${slug}`;

    let meta = document.head.querySelector<HTMLMetaElement>('meta[name="callback-box"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "callback-box";
      document.head.appendChild(meta);
    }
    meta.content = JSON.stringify({ slug, title, boxUrl });

    const created = meta;
    return () => {
      created.remove();
    };
  }, [slug, title]);
}
