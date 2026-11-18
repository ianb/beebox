// The "file room": a dark hand-drawn animation (canvas-loop's file-room sketch)
// behind the paper card on single-column pages in a wide window. The HTML, CSS
// and navigation script load first; this loader then fetches
// assets/file-room.js (bundled by room-bundle.ts) when the browser
// is idle, and only when the scene would show: a single-column page, a window
// at least 1200px wide, no reduced-motion preference, and WebGPU. Otherwise
// nothing is fetched and the page is as it was. The script is inlined into
// navigation.js and runs after every page swap.

export const ROOM_CSS = `
canvas.site-room { position: fixed; left: 0; top: 0; width: 100vw; height: 150vw; z-index: 0; pointer-events: none; opacity: 0; transition: opacity 1.2s; will-change: transform; background: #060608; }
canvas.site-room.on { opacity: 1; }
body[data-site-room] #site-workspace { position: relative; z-index: 1; }
body[data-site-room] #site-header.bbx-app-nav { position: relative; z-index: 2; }
body[data-site-room] canvas.site-threads { display: none; }
body[data-site-room] .pane-label { color: #e6dfd2; }
body[data-site-room] .pane-label a { color: #3a342c; }
@media (prefers-reduced-motion: reduce) { canvas.site-room { transition: none; } }
@media print { canvas.site-room { display: none; } }
`;

export const ROOM_SCRIPT = `
  let roomStop = null;
  let roomLoading = false;
  let roomFailed = false;
  // Wide enough for the margins to show the scene, and not so tall that the scene (2:3) would end above the window's foot.
  const roomWide = matchMedia('(min-width: 1200px) and (min-aspect-ratio: 2/3)');
  const roomCalm = matchMedia('(prefers-reduced-motion: reduce)');

  function roomEligible() {
    const main = page();
    return !!main && main.classList.contains('single') && roomWide.matches && !roomCalm.matches && 'gpu' in navigator;
  }

  function runRoom() {
    if (!roomEligible()) {
      if (roomStop) { roomStop.teardown(); roomStop = null; }
      return;
    }
    // A page swap keeps the mount; the new pane starts at its own scroll position.
    if (roomStop) { roomStop.place(); return; }
    if (roomLoading || roomFailed) return;
    roomLoading = true;
    const start = async () => {
      try {
        // The window may have narrowed, or the page changed, while this waited for an idle moment.
        if (!roomEligible()) return;
        const room = await import(base + 'assets/file-room.js');
        if (roomEligible() && !roomStop) roomStop = room.mountFileRoom();
      } catch (error) {
        roomFailed = true;
        console.warn('site background did not load', error);
      } finally {
        roomLoading = false;
      }
    };
    const idle = () => {
      if ('requestIdleCallback' in window) requestIdleCallback(() => { void start(); }, { timeout: 2000 });
      else setTimeout(() => { void start(); }, 1200);
    };
    if (document.readyState === 'complete') idle();
    else addEventListener('load', idle, { once: true });
  }
  roomWide.addEventListener('change', runRoom);
  roomCalm.addEventListener('change', runRoom);
`;
