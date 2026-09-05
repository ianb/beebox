import { Profiler, type ProfilerOnRenderCallback, type ReactNode } from "react";
import { shouldRecordScrollTrace, recordScrollTrace } from "../../lib/scroll-diagnostics";

const recordRender: ProfilerOnRenderCallback = (...render) => {
  const [id, phase, actualDuration, baseDuration, startTime, commitTime] = render;
  if (!shouldRecordScrollTrace()) return;
  // A Profiler callback means React committed this component subtree. It does
  // not imply that React changed the DOM; DOM mutations are traced separately.
  recordScrollTrace("react-commit", {
    id,
    phase,
    actualMs: Math.round(actualDuration * 100) / 100,
    baseMs: Math.round(baseDuration * 100) / 100,
    startMs: Math.round(startTime * 100) / 100,
    commitMs: Math.round(commitTime * 100) / 100,
  });
};

export function ChatRenderProfiler(props: { id: string; children: ReactNode }) {
  const { id, children } = props;
  if (!import.meta.env.DEV) return children;
  return <Profiler id={id} onRender={recordRender}>{children}</Profiler>;
}
