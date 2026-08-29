export function bottomScrollTop(geometry: {
  scrollHeight: number;
  clientHeight: number;
  scrollTop: number;
  scrollerTop: number;
  liveContentBottom: number | null;
}): number {
  const naturalBottom = geometry.scrollHeight - geometry.clientHeight;
  if (geometry.liveContentBottom === null) return naturalBottom;
  return Math.max(0, geometry.scrollTop + geometry.liveContentBottom - geometry.scrollerTop - geometry.clientHeight);
}

export function currentBottomTop(el: HTMLDivElement, content: HTMLDivElement | null): number {
  const live = content?.querySelector("[data-chat-live-turn-content]") ?? null;
  return bottomScrollTop({
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
    scrollTop: el.scrollTop,
    scrollerTop: el.getBoundingClientRect().top,
    liveContentBottom: live?.getBoundingClientRect().bottom ?? null,
  });
}
