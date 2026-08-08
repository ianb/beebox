import { useCallback, useEffect, useRef } from "react";

interface MissingChatCardLogOptions {
  enabled: boolean;
  path: string;
  cardLoaded: boolean;
  error: { message: string } | null;
}

/** Temporary diagnostics for chat embeds that reference a card before it exists. */
export function useMissingChatCardLog({ enabled, path, cardLoaded, error }: MissingChatCardLogOptions) {
  const hadErrorRef = useRef(false);
  useEffect(() => {
    if (!enabled) return;
    if (error) {
      hadErrorRef.current = true;
      console.log("[chat-card-retry] card query failed", { path, error: error.message });
    } else if (cardLoaded && hadErrorRef.current) {
      hadErrorRef.current = false;
      console.log("[chat-card-retry] card query recovered", { path });
    }
  }, [cardLoaded, enabled, error, path]);

  const logFileChange = useCallback((changedPath: string, matches: boolean) => {
    if (!enabled || !error) return;
    console.log("[chat-card-retry] file-change while card query is failed", { path, changedPath, matches });
    if (matches) console.log("[chat-card-retry] invalidating failed card query", { path });
  }, [enabled, error, path]);

  const logReconnect = useCallback(() => {
    if (enabled && error) {
      console.log("[chat-card-retry] event stream reconnected; resyncing failed card query", { path });
    }
  }, [enabled, error, path]);

  return { logFileChange, logReconnect };
}
