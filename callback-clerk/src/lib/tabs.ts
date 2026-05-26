export interface TabInfo {
  id: number;
  windowId: number;
  url: string;
  title: string;
  active: boolean;
  pinned: boolean;
}

export async function getTabSnapshot(): Promise<TabInfo[]> {
  const tabs = await chrome.tabs.query({});
  return tabs
    .filter((t) => t.id != null && t.url != null)
    .map((t) => ({
      id: t.id!,
      windowId: t.windowId,
      url: t.url ?? "",
      title: t.title ?? "",
      active: t.active,
      pinned: t.pinned,
    }));
}

// Pure function for testing: converts raw tab-like objects to TabInfo[]
export function toTabInfoList(
  tabs: Array<{
    id?: number;
    windowId: number;
    url?: string;
    title?: string;
    active: boolean;
    pinned: boolean;
  }>
): TabInfo[] {
  return tabs
    .filter((t) => t.id != null && t.url != null)
    .map((t) => ({
      id: t.id!,
      windowId: t.windowId,
      url: t.url ?? "",
      title: t.title ?? "",
      active: t.active,
      pinned: t.pinned,
    }));
}
