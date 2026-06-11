import { useEffect, useState } from "react";
import { getActiveBox, type ClerkConfig } from "../domain/config.js";
import { loadConfig } from "../platform/config-storage.js";

export function SidepanelApp() {
  const [config, setConfig] = useState<ClerkConfig | null>(null);

  useEffect(() => {
    loadConfig().then(setConfig);
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== "local") return;
      if ("clerkConfig" in changes) loadConfig().then(setConfig);
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  const activeBox = config === null ? null : getActiveBox(config);

  return (
    <div className="p-4">
      <h1 className="mb-2 text-lg font-semibold">Callback Clerk</h1>
      {activeBox !== null ? (
        <div className="text-sm">
          <span className="font-medium">{activeBox.title}</span>
          <span className="block truncate text-xs text-gray-400">{activeBox.boxUrl}</span>
        </div>
      ) : (
        <p className="text-sm text-gray-600">No box enabled.</p>
      )}
    </div>
  );
}
