/**
 * Browser half of the backdrop audit, as script text for `bin/browse eval`
 * (see contrast-page.ts for why it is a string). It resolves every
 * file-backed background image layer, on elements and their ::before and
 * ::after, to the tile the browser paints. Inline `data:` images are
 * textures, icons and underlines, so it leaves them out.
 */

interface Size { w: number; h: number }

export interface BackdropLayer {
  selector: string;
  image: string;
  /** Painted artwork (WebP, PNG, JPEG); an SVG may be a pattern drawn to tile. */
  raster: boolean;
  /** The image's own size, before background-size. */
  natural: Size;
  /** The background positioning area: the padding box, or the viewport for a fixed background. */
  box: Size;
  tile: Size;
  /** Where the first tile starts inside the box. */
  offset: { x: number; y: number };
  repeat: { x: boolean; y: boolean };
}

export interface BackdropPage {
  viewport: Size;
  layers: BackdropLayer[];
  /** Images that did not load, so their layers were not measured. */
  unloaded: string[];
}

export const COLLECT_BACKDROPS_SCRIPT = String.raw`(async () => {
  const splitTop = (s, sep) => {
    const out = [];
    let depth = 0, cur = "";
    for (const ch of s) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (depth === 0 && (sep === " " ? /\s/.test(ch) : ch === sep)) { if (cur.trim()) out.push(cur.trim()); cur = ""; } else cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  };
  const host = document.createElement("div");
  host.style.cssText = "position:absolute;left:0;top:0;height:0;visibility:hidden;pointer-events:none";
  const probe = document.createElement("div");
  probe.style.cssText = "height:0";
  host.append(probe);
  document.body.append(host);
  // A margin resolves any length or percentage against the host's width,
  // and may be negative, which a width may not.
  const resolve = (expr, basis) => {
    host.style.width = basis + "px";
    probe.style.marginLeft = "";
    probe.style.marginLeft = expr;
    if (probe.style.marginLeft === "") throw new Error("backdrop audit: cannot resolve " + JSON.stringify(expr));
    return probe.getBoundingClientRect().left - host.getBoundingClientRect().left;
  };
  // Positions resolve against box minus tile, which may be negative; a
  // position is linear in its basis, so two probes give it for any basis.
  const resolveLinear = (expr, basis) => {
    const at0 = resolve(expr, 0);
    return at0 + (resolve(expr, 1000) - at0) * basis / 1000;
  };
  const natural = new Map();
  const unloaded = new Set();
  const load = async (url) => {
    if (!natural.has(url)) {
      const img = new Image();
      img.src = url;
      try {
        await img.decode();
        natural.set(url, { w: img.naturalWidth, h: img.naturalHeight });
      } catch {
        natural.set(url, null);
      }
    }
    return natural.get(url);
  };
  const tileOf = (size, nat, box) => {
    if (size === "cover" || size === "contain") {
      const s = (size === "cover" ? Math.max : Math.min)(box.w / nat.w, box.h / nat.h);
      return { w: nat.w * s, h: nat.h * s };
    }
    const [cx, cy = "auto"] = splitTop(size, " ");
    let w = cx === "auto" ? null : resolve(cx, box.w);
    let h = cy === "auto" ? null : resolve(cy, box.h);
    if (w === null && h === null) return nat;
    if (w === null) w = h * nat.w / nat.h;
    if (h === null) h = w * nat.h / nat.w;
    return { w, h };
  };
  const repeatOf = (value) => {
    const parts = value.split(" ");
    if (parts.length === 2) return { x: parts[0] !== "no-repeat", y: parts[1] !== "no-repeat" };
    if (value === "repeat-x") return { x: true, y: false };
    if (value === "repeat-y") return { x: false, y: true };
    return { x: value !== "no-repeat", y: value !== "no-repeat" };
  };
  const name = (el, pseudo) => {
    const classes = [...el.classList].filter((c) => c.startsWith("bbx-")).slice(0, 2).map((c) => "." + c).join("");
    const theme = el.dataset.chromeTheme ? '[data-chrome-theme="' + el.dataset.chromeTheme + '"]' : el.dataset.cardTheme ? '[data-card-theme="' + el.dataset.cardTheme + '"]' : "";
    return (el.id ? "#" + el.id : el.tagName.toLowerCase() + classes) + theme + pseudo;
  };
  const paddingBox = (el, cs, pseudo) => {
    if (!pseudo) return { w: el.clientWidth, h: cs.backgroundAttachment.includes("local") ? el.scrollHeight : el.clientHeight };
    const px = (v) => parseFloat(v) || 0;
    const border = cs.boxSizing === "border-box";
    const w = px(cs.width) + (border ? -px(cs.borderLeftWidth) - px(cs.borderRightWidth) : px(cs.paddingLeft) + px(cs.paddingRight));
    const h = px(cs.height) + (border ? -px(cs.borderTopWidth) - px(cs.borderBottomWidth) : px(cs.paddingTop) + px(cs.paddingBottom));
    return { w, h };
  };
  const layers = [];
  try {
    for (const el of document.querySelectorAll("body *")) {
      if (el === host || el === probe) continue;
      for (const pseudo of ["", "::before", "::after"]) {
        const cs = getComputedStyle(el, pseudo || null);
        if (!cs.backgroundImage.includes("url(")) continue;
        if (pseudo && (cs.content === "none" || cs.display === "none")) continue;
        if (cs.display === "none" || cs.visibility === "hidden") continue;
        const own = paddingBox(el, cs, pseudo);
        if (own.w <= 0 || own.h <= 0) continue;
        const images = splitTop(cs.backgroundImage, ",");
        const sizes = splitTop(cs.backgroundSize, ",");
        const repeats = splitTop(cs.backgroundRepeat, ",");
        const xs = splitTop(cs.backgroundPositionX, ",");
        const ys = splitTop(cs.backgroundPositionY, ",");
        const attachments = splitTop(cs.backgroundAttachment, ",");
        for (let i = 0; i < images.length; i++) {
          const m = /^url\("?(.*?)"?\)$/.exec(images[i]);
          if (!m || m[1].startsWith("data:")) continue;
          const url = m[1];
          const nat = await load(url);
          const image = url.split("/").pop().split("?")[0];
          if (!nat || !nat.w || !nat.h) { unloaded.add(image); continue; }
          const box = attachments[i % attachments.length] === "fixed" ? { w: innerWidth, h: innerHeight } : own;
          const tile = tileOf(sizes[i % sizes.length], nat, box);
          layers.push({
            selector: name(el, pseudo),
            image,
            raster: /\.(webp|png|jpe?g|avif|gif)$/i.test(image),
            natural: nat,
            box,
            tile,
            offset: { x: resolveLinear(xs[i % xs.length], box.w - tile.w), y: resolveLinear(ys[i % ys.length], box.h - tile.h) },
            repeat: repeatOf(repeats[i % repeats.length]),
          });
        }
      }
    }
  } finally {
    host.remove();
  }
  return JSON.stringify({ viewport: { w: innerWidth, h: innerHeight }, layers, unloaded: [...unloaded] });
})()`;
