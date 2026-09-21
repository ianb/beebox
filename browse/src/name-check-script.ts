/** Browser-side accessible-name candidates used by the actionability check. */
export const NAME_CANDIDATES_SCRIPT = `
  const namesOf = (n) => {
    const blockDisplays = new Set(['block', 'flex', 'grid', 'flow-root', 'table', 'table-row', 'table-cell', 'list-item']);
    const textWithBlockSpacing = (root) => {
      const pieces = [];
      const visit = (node) => {
        if (node.nodeType === Node.TEXT_NODE) pieces.push(node.nodeValue || '');
        else if (node instanceof Element) for (const child of node.childNodes) {
          if (child instanceof Element && blockDisplays.has(getComputedStyle(child).display)) pieces.push(' ');
          visit(child);
        }
      };
      visit(root);
      return pieces.join('').replace(/\\s+/g, ' ').trim();
    };
    // Only the hit control may contribute its name. A shared layout ancestor
    // also contains text behind overlays and cannot establish target identity.
    const roles = ['button', 'link', 'textbox', 'searchbox', 'checkbox', 'radio', 'switch', 'combobox', 'option', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab', 'slider', 'spinbutton'];
    const selector = ['button', 'a[href]', 'input', 'select', 'textarea', 'summary', 'label', ...roles.map(role => '[role="' + role + '"]')].join(',');
    const boundary = n.closest(selector) || n;
    const out = [];
    for (let e = n; e instanceof Element; e = e.parentElement) {
      if (e.tagName === 'BODY') break;
      for (const v of [e.getAttribute('aria-label'), e.getAttribute('title'), e.getAttribute('placeholder'), e.getAttribute('alt'), e.value, textWithBlockSpacing(e)]) {
        if (typeof v === 'string' && v.trim() !== '') out.push(v.replace(/\\s+/g, ' ').trim());
      }
      if (e.getAttribute('aria-labelledby')) {
        for (const id of e.getAttribute('aria-labelledby').split(/\\s+/)) {
          const l = document.getElementById(id); if (l) out.push((l.textContent || '').replace(/\\s+/g, ' ').trim());
        }
      }
      if (e === boundary) break;
    }
    return out;
  };
`;
