// Browser enhancement shipped as a static asset; HTML remains independently readable.
import { FISHEYE_SCRIPT } from "./fisheye.js";

export const NAVIGATION_SCRIPT = `
(() => {
  const base = document.body.dataset.siteBase;
  const page = () => document.querySelector('#site-workspace');
  if (!base || !page()) return;
  const visited = new Set();
  const offsets = new Map();
  const entries = new Map();
  const cache = new Map();
  const newKey = () => String(Date.now()) + '-' + Math.random().toString(36).slice(2);
  let entryKey = history.state?.siteKey || newKey();
  let requestId = 0;
  let activeTransition = null;
  history.replaceState({ ...history.state, siteKey: entryKey }, '', location.href);
  history.scrollRestoration = 'manual';
  const pathKey = url => url.pathname + url.search;
  let displayedPath = pathKey(new URL(location.href));
  cache.set(pathKey(new URL(location.href)), document.documentElement.outerHTML);

  function remember() {
    const snapshot = {};
    for (const pane of document.querySelectorAll('.pane[data-card]')) {
      if (!pane.getClientRects().length) continue;
      snapshot[pane.dataset.card] = pane.scrollTop;
      offsets.set(pane.dataset.card, pane.scrollTop);
    }
    entries.set(entryKey, snapshot);
    if (history.state?.siteKey === entryKey) history.replaceState({ ...history.state, siteOffsets: snapshot }, '');
  }

  function initializeContent() {
    ${FISHEYE_SCRIPT}
    for (const surface of document.querySelectorAll('.bbx-card-surface')) {
      const button = surface.querySelector('[data-card-properties]');
      const front = surface.querySelector('.bbx-card-front');
      const back = surface.querySelector('.bbx-card-back');
      if (!button || !front || !back) continue;
      button.hidden = false;
      const showBack = value => {
        front.hidden = value;
        front.toggleAttribute('inert', value);
        front.setAttribute('aria-hidden', String(value));
        back.hidden = !value;
        back.setAttribute('aria-hidden', String(!value));
        surface.dataset.cardSide = value ? 'back' : 'front';
        button.setAttribute('aria-expanded', String(value));
        button.setAttribute('aria-label', value ? 'Back to card' : 'On the back');
        button.title = value ? 'Back to card' : 'On the back: authorship and provenance';
        button.querySelector('.bbx-card-properties-label').textContent = value ? '\u2190 Back to card' : 'On the back';
      };
      button.addEventListener('click', () => {
        if (surface.dataset.cardTurn) return;
        const next = surface.dataset.cardSide !== 'back';
        if (matchMedia('(prefers-reduced-motion: reduce)').matches) { showBack(next); return; }
        button.setAttribute('aria-busy', 'true');
        surface.dataset.cardTurn = 'out';
        const finishTurn = event => {
          if (event.target !== surface) return;
          if (surface.dataset.cardTurn === 'out') {
            showBack(next);
            surface.dataset.cardTurn = 'in';
          } else {
            delete surface.dataset.cardTurn;
            button.removeAttribute('aria-busy');
            surface.removeEventListener('animationend', finishTurn);
          }
        };
        surface.addEventListener('animationend', finishTurn);
      });
    }
    for (const prompt of document.querySelectorAll('.agent-prompt')) {
      const button = prompt.querySelector('.prompt-copy');
      const status = prompt.querySelector('.prompt-status');
      button.hidden = false;
      button.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(prompt.querySelector('code').textContent);
          status.textContent = 'Copied. Paste this into your agent.';
        } catch { status.textContent = 'Could not copy automatically. Select and copy the prompt above.'; }
      });
    }
    for (const pre of document.querySelectorAll('pre')) {
      if (pre.closest('.agent-prompt')) continue;
      if (pre.querySelector('.copy')) continue;
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'copy'; button.textContent = 'Copy';
      button.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText((pre.querySelector('code') || pre).innerText.trim());
          button.textContent = 'Copied';
        } catch { button.textContent = 'Select the text to copy'; }
      });
      pre.append(button);
    }
    visited.add(page().dataset.page);
    for (const nav of document.querySelectorAll('.next-places')) {
      const links = [...nav.querySelectorAll('[data-next]')].sort((a,b) => Number(a.dataset.order)-Number(b.dataset.order));
      const next = links.find(link => !visited.has(link.dataset.next)) || links.at(-1);
      if (next) nav.insertBefore(next, nav.querySelector('[data-next]'));
    }
    const current = page().dataset.place;
    const normalize = path => path.replace(/index.html$/, '').replace(/\\.html$/, '').replace(/\\/$/, '');
    for (const link of document.querySelectorAll('.site-menu-panel a')) {
      if (normalize(new URL(link.href).pathname) === normalize(new URL(current, location.href).pathname)) link.setAttribute('aria-current', 'page');
    }
  }

  function restore(params) {
    const snapshot = params.pop ? entries.get(entryKey) || history.state?.siteOffsets : null;
    for (const pane of document.querySelectorAll('.pane[data-card]')) {
      pane.scrollTop = snapshot?.[pane.dataset.card] ?? offsets.get(pane.dataset.card) ?? 0;
    }
    let target = document.querySelector('#reading-card h1') || document.querySelector('#reading-card');
    if ((!params.pop || !snapshot) && location.hash) {
      let id;
      // A malformed shared fragment has no target; keep the readable card and heading focus.
      try { id = decodeURIComponent(location.hash.slice(1)); } catch { id = ''; }
      const anchor = document.getElementById(id);
      if (anchor) { anchor.scrollIntoView({ block: 'start' }); target = anchor; }
    }
    if (target) { target.tabIndex = -1; target.focus({ preventScroll: true }); }
  }

  async function load(url) {
    const key = pathKey(url);
    if (cache.has(key)) return cache.get(key);
    const response = await fetch(url, { headers: { Accept: 'text/html' } });
    if (!response.ok) throw new Error('Page did not load');
    const html = await response.text();
    cache.set(key, html);
    return html;
  }

  async function navigate(url, pop) {
    const request = ++requestId;
    try {
      remember();
      const html = await load(url);
      if (request !== requestId) return;
      const next = new DOMParser().parseFromString(html, 'text/html');
      const nextPage = next.querySelector('#site-workspace');
      const nextHeader = next.querySelector('#site-header');
      if (!nextPage || !nextHeader) throw new Error('Not a site page');
      if (activeTransition) {
        activeTransition.skipTransition();
        await activeTransition.finished;
        if (request !== requestId) return;
      }
      if (pop) entryKey = history.state?.siteKey || newKey();
      else { entryKey = newKey(); history.pushState({ siteKey: entryKey }, '', url); }
      const update = () => {
        if (request !== requestId) return;
        page().replaceWith(nextPage);
        document.querySelector('#site-header').replaceWith(nextHeader);
        document.title = next.title;
        document.querySelector('meta[name="description"]').content = next.querySelector('meta[name="description"]').content;
        displayedPath = pathKey(url);
        initializeContent(); restore({ pop });
      };
      if (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        const transition = document.startViewTransition(update);
        activeTransition = transition;
        await transition.finished;
        if (activeTransition === transition) activeTransition = null;
      } else update();
    } catch {
      // Static documents remain the recovery path when fetching or enhancement fails.
      if (request === requestId) location.assign(url.href);
    }
  }

  document.addEventListener('click', event => {
    const menu = document.querySelector('#site-menu');
    if (menu && !menu.contains(event.target)) menu.open = false;
    const link = event.target.closest('a[href]');
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.target || link.hasAttribute('download')) return;
    const url = new URL(link.href);
    if (url.origin !== location.origin || !url.pathname.startsWith(base)) return;
    if (url.hash && pathKey(url) === pathKey(new URL(location.href))) { remember(); if (menu) menu.open = false; return; }
    if (!(url.pathname.endsWith('.html') || url.pathname.endsWith('.doc.card/') || url.pathname === base || url.pathname === location.pathname)) return;
    event.preventDefault();
    if (menu) menu.open = false;
    void navigate(url, false);
  });
  document.addEventListener('keydown', event => {
    const menu = document.querySelector('#site-menu');
    if (event.key === 'Escape' && menu?.open) { menu.open = false; menu.querySelector('summary').focus(); }
  });
  addEventListener('popstate', () => {
    const url = new URL(location.href);
    if (pathKey(url) === displayedPath) {
      ++requestId;
      remember();
      entryKey = history.state?.siteKey || newKey();
      history.replaceState({ ...history.state, siteKey: entryKey }, '');
      restore({ pop: true });
      return;
    }
    void navigate(url, true);
  });
  let scrollSave;
  document.addEventListener('scroll', () => {
    clearTimeout(scrollSave);
    scrollSave = setTimeout(remember, 500);
  }, true);
  addEventListener('pagehide', remember);
  initializeContent();
  document.body.classList.add('site-enhanced');
  if (history.state?.siteOffsets) restore({ pop: true });
  else if (location.hash) restore({ pop: false });
})();
`;
