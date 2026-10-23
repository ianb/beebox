/**
 * Browser-side scroll-container awareness for the actionability check. Spliced
 * into `checkScript` after `el`, `r` and `onScreen`.
 *
 * `scrolls(e)` is true for an element that clips its content (overflow auto,
 * scroll, hidden or clip on either axis). `clippedBy(b)` returns the nearest
 * such ancestor of `el` whose box excludes the centre of `b`, or null: a tab
 * pushed out of a horizontally scrolled strip lies inside the viewport, so the
 * viewport test alone never scrolled it and the strip was topmost at its point.
 */
export const CLIPPED_BY_SCRIPT = `
  const scrolls = (e) => { const s = getComputedStyle(e); return /auto|scroll|hidden|clip/.test(String(s.overflowX) + ' ' + String(s.overflowY)); };
  // The scroll container, if any, whose clip box excludes the element's centre: a tab pushed out of a
  // horizontally scrolled strip is inside the viewport yet cannot be clicked, so the viewport test alone
  // never scrolled it.
  const clippedBy = (b) => {
    const cx = b.left + b.width / 2;
    const cy = b.top + b.height / 2;
    for (let p = el.parentElement; p instanceof Element && p.tagName !== 'BODY' && p.tagName !== 'HTML'; p = p.parentElement) {
      if (!scrolls(p)) continue;
      const pr = p.getBoundingClientRect();
      if (cx < pr.left || cx >= pr.right || cy < pr.top || cy >= pr.bottom) return p;
    }
    return null;
  };
`;
