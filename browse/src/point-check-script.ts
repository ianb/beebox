/**
 * Browser-side resolution of an id-less `@eN` ref for the actionability check.
 * Spliced into `checkScript` after `fail`, `describe` and `namesOf`.
 *
 * `pointTarget(locator)` finds the ref's element among the elements stacked at
 * the centre of the box upstream reported, by that box (preferring one that
 * carries the snapshot's name). The topmost element there must be it, inside
 * it, or one of its `<label>`s; otherwise the control is `covered`, whatever
 * its name. When no stacked element has the box (the ref's element does not
 * take the pointer), the topmost element must carry the snapshot's name.
 * Returns the element to judge, or a failure's JSON.
 */
export const POINT_TARGET_SCRIPT = `
  const pointTarget = (locator) => {
    const stack = document.elementsFromPoint(locator.x, locator.y);
    const hit = stack[0] || null;
    if (hit === null) return fail('no-hit-target', 'nothing at ' + locator.x + ',' + locator.y);
    const want = locator.expectName === null ? '' : locator.expectName.replace(/\\s+/g, ' ').trim().toLowerCase();
    const named = (n) => want !== '' && namesOf(n).some((h) => h.toLowerCase().includes(want));
    const b = locator.box;
    const near = (p, q) => Math.abs(p - q) <= 1;
    const sameBox = (n) => {
      const r = n.getBoundingClientRect();
      return near(r.left, b.x) && near(r.top, b.y) && near(r.width, b.width) && near(r.height, b.height);
    };
    const boxed = stack.filter(sameBox);
    const target = boxed.find(named) || boxed[0] || null;
    if (target === null) {
      if (want !== '' && !named(hit)) return fail('covered', 'the element at the ref\\'s center is ' + describe(hit) + ', not "' + locator.expectName + '"');
      return hit;
    }
    const hitLabel = hit.closest('label');
    const ownLabel = hitLabel !== null && target.labels && Array.from(target.labels).includes(hitLabel);
    if (hit !== target && !target.contains(hit) && !ownLabel) {
      return fail('covered', 'the ref\\'s element ' + describe(target) + ' is under ' + describe(hit));
    }
    return target;
  };
`;
