// Home-page "threads": index cards in the desk margins around the reading
// column get linked by drawn threads, the way wiki links accumulate, and then
// one more card is filed. It plays once per visit for about seven seconds and
// then holds still; reduced motion, a hidden tab, or a return to the home page
// draws the finished web without motion. Margins too narrow for a card (phones)
// get nothing. The page marks itself with `data-threads` (workspace.ts); this
// script is inlined into navigation.js and runs after every page swap.

export const THREADS_CSS = `
canvas.site-threads { position: fixed; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 0; }
#site-workspace[data-threads] { position: relative; z-index: 1; }
/* The menu panel hangs below the header over the workspace; keep it on top. */
#site-header.bbx-app-nav { position: relative; z-index: 2; }
@media print { canvas.site-threads { display: none; } }
`;

export const THREADS_SCRIPT = `
  let threadsPlayed = false;
  let threadsStop = null;

  function runThreads() {
    if (threadsStop) { threadsStop(); threadsStop = null; }
    document.querySelector('canvas.site-threads')?.remove();
    const main = page();
    if (!main || !('threads' in main.dataset)) return;
    const canvas = document.createElement('canvas');
    canvas.className = 'site-threads';
    canvas.setAttribute('aria-hidden', 'true');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    document.body.insertBefore(canvas, main);
    const css = getComputedStyle(main.querySelector('.bbx-card-surface') || main);
    const token = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
    const pen = token('--bbx-pen', '#2b4264'), paper = token('--bbx-paper', '#f5efe2');
    const edge = token('--bbx-edge', '#d6c8af'), soft = token('--bbx-ink-soft', '#4f4439');
    const CARD_W = 52, CARD_H = 34, FILED_AT = 5.6, TOTAL = 7.5;
    let layout = null;

    function random(seed) {
      let s = seed >>> 0;
      return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let r = Math.imul(s ^ (s >>> 15), 1 | s);
        r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
      };
    }

    function plan() {
      const w = innerWidth, h = innerHeight, dpr = Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const column = main.getBoundingClientRect();
      const header = document.querySelector('#site-header');
      const top = (header ? header.getBoundingClientRect().bottom : 0) + 30;
      const sides = [[16, column.left - 16], [column.right + 16, w - 16]];
      if (sides.some(([a, b]) => b - a < CARD_W + 30) || h - top < 160) return null;
      const rnd = random(7);
      const rows = Math.max(2, Math.min(5, Math.floor((h - top - 20) / 120)));
      const cards = [];
      sides.forEach(([a, b], side) => {
        for (let i = 0; i < rows; i++) {
          const y = top + (i + 0.5) * ((h - top - 20) / rows) + (rnd() - 0.5) * 30;
          const x = (a + b) / 2 + (rnd() - 0.5) * Math.max(0, b - a - CARD_W - 10);
          cards.push({ x, y, r: (rnd() - 0.5) * 0.3, born: rnd() * 1.2, side, row: i });
        }
      });
      const index = (side, row) => side * rows + row;
      const links = [];
      let at = 1;
      for (let side = 0; side < 2; side++) {
        for (let i = 0; i + 1 < rows; i++) { links.push([index(side, i), index(side, i + 1), at]); at += 0.45; }
      }
      for (let i = 0; i < rows; i += 2) { links.push([index(0, i), index(1, Math.min(rows - 1, i + 1)), at]); at += 0.45; }
      const filed = { x: (sides[1][0] + sides[1][1]) / 2 + (rnd() - 0.5) * 20, y: top + (h - top) * 0.55, r: -0.08, born: FILED_AT, side: 1, filed: true };
      cards.push(filed);
      const last = cards.length - 1;
      links.push([index(1, Math.floor(rows / 2)), last, FILED_AT + 0.6], [index(1, Math.max(0, Math.floor(rows / 2) - 1)), last, FILED_AT + 0.9]);
      return { w, h, cards, links };
    }

    function draw(t) {
      if (!layout) { ctx.clearRect(0, 0, canvas.width, canvas.height); return; }
      const { w, h, cards, links } = layout;
      ctx.clearRect(0, 0, w, h);
      ctx.lineWidth = 1.3; ctx.strokeStyle = pen;
      for (const [a, b, start] of links) {
        const p = Math.max(0, Math.min(1, (t - start) / 0.7));
        const A = cards[a], B = cards[b];
        if (p === 0 || !A || !B) continue;
        const mx = (A.x + B.x) / 2 + (A.y - B.y) * 0.25, my = (A.y + B.y) / 2 + (B.x - A.x) * 0.25;
        ctx.globalAlpha = 0.45;
        ctx.beginPath();
        const steps = 32;
        for (let s = 0; s <= steps * p; s++) {
          const u = s / steps;
          const x = (1 - u) ** 2 * A.x + 2 * (1 - u) * u * mx + u * u * B.x;
          const y = (1 - u) ** 2 * A.y + 2 * (1 - u) * u * my + u * u * B.y;
          if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      for (const card of cards) {
        const q = Math.max(0, Math.min(1, (t - card.born) / (card.filed ? 0.6 : 0.5)));
        if (q === 0) continue;
        ctx.save();
        ctx.translate(card.x, card.y - (1 - q) * 14); ctx.rotate(card.r);
        ctx.globalAlpha = q * 0.9;
        ctx.fillStyle = paper; ctx.strokeStyle = edge; ctx.lineWidth = 1;
        ctx.shadowColor = 'rgba(0,0,0,0.12)'; ctx.shadowBlur = 4; ctx.shadowOffsetY = 1;
        ctx.fillRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H);
        ctx.shadowColor = 'transparent';
        ctx.strokeRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H);
        ctx.strokeStyle = soft; ctx.globalAlpha = q * 0.3;
        for (let l = 0; l < 3; l++) { ctx.beginPath(); ctx.moveTo(-19, -7 + l * 7); ctx.lineTo(19 - l * 6, -7 + l * 7); ctx.stroke(); }
        ctx.restore();
      }
    }

    let raf = 0, start = 0;
    const reduceQuery = matchMedia('(prefers-reduced-motion: reduce)');
    const still = reduceQuery.matches || threadsPlayed || document.visibilityState !== 'visible';
    threadsPlayed = true;
    const finish = () => { cancelAnimationFrame(raf); raf = 0; draw(TOTAL); };
    const tick = now => {
      const t = (now - start) / 1000;
      if (t >= TOTAL) { finish(); return; }
      draw(t);
      raf = requestAnimationFrame(tick);
    };
    let resizeTimer = 0;
    const onResize = () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { layout = plan(); if (!raf) draw(TOTAL); }, 150); };
    const onVisibility = () => { if (document.visibilityState !== 'visible' && raf) finish(); };
    const onReduce = () => { if (reduceQuery.matches && raf) finish(); };
    addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVisibility);
    reduceQuery.addEventListener('change', onReduce);
    threadsStop = () => {
      cancelAnimationFrame(raf); clearTimeout(resizeTimer);
      removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
      reduceQuery.removeEventListener('change', onReduce);
    };
    layout = plan();
    if (still || !layout) { draw(TOTAL); return; }
    raf = requestAnimationFrame(now => { start = now; tick(now); });
  }
`;
