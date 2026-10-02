import { useLayoutEffect, useState } from "react";

/** A refresh after idle must not recreate a completed send's empty spacer. */
export function useSendSpacer(sendSignal: number, idle: boolean): boolean {
  const [completedSend, setCompletedSend] = useState(0);
  useLayoutEffect(() => {
    if (idle) setCompletedSend(sendSignal);
  }, [idle, sendSignal]);
  return !idle && sendSignal > completedSend;
}

