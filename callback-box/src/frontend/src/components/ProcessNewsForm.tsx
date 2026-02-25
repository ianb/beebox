/**
 * ProcessNewsForm - Controls for running the news processing agent.
 *
 * The news processing pipeline has three phases:
 * 1. Triage: Review items in inbox/news/, trash uninteresting ones
 * 2. Analyze: Fetch content & add analysis, move to pool/news/
 * 3. Brief: Create brief from pool items, archive used ones
 */

import { useState } from "react";

export interface ProcessNewsArgs {
  batchSize: number;
  triageOnly: boolean;
  analyzeOnly: boolean;
  briefOnly: boolean;
}

interface ProcessNewsFormProps {
  onSubmit: (args: ProcessNewsArgs) => void;
  onClose: () => void;
  /** Items in box/inbox/news/ awaiting triage */
  inboxCount: number;
  /** Items in box/pool/news/ ready for brief */
  poolCount: number;
}

export function ProcessNewsForm({
  onSubmit,
  onClose,
  inboxCount,
  poolCount,
}: ProcessNewsFormProps) {
  const [batchSize, setBatchSize] = useState(10);
  const [phase, setPhase] = useState<"all" | "triage" | "analyze" | "brief">("all");

  const handleSubmit = () => {
    onSubmit({
      batchSize,
      triageOnly: phase === "triage",
      analyzeOnly: phase === "analyze",
      briefOnly: phase === "brief",
    });
  };

  return (
    <div className="bg-white rounded-lg shadow p-4 max-w-xl">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold text-warm-900">Process News</h3>
        <button
          onClick={onClose}
          className="text-warm-500 hover:text-warm-700"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Status summary */}
      <div className="mb-4 p-3 bg-warm-50 rounded-lg">
        <div className="text-sm text-warm-700 mb-2">Pipeline Status:</div>
        <div className="flex gap-4 text-sm">
          <div className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-full bg-plum" />
            <span>{inboxCount} in inbox</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-full bg-green-500" />
            <span>{poolCount} in pool</span>
          </div>
        </div>
      </div>

      {/* Batch size */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-warm-700 mb-1">
          Batch Size
        </label>
        <input
          type="number"
          min={1}
          max={50}
          value={batchSize}
          onChange={(e) => setBatchSize(parseInt(e.target.value) || 10)}
          className="input w-24"
        />
        <span className="text-sm text-warm-600 ml-2">items per phase</span>
      </div>

      {/* Phase selection */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-warm-700 mb-2">
          Run Phase
        </label>
        <div className="space-y-2">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="phase"
              value="all"
              checked={phase === "all"}
              onChange={() => setPhase("all")}
              className="text-plum"
            />
            <span className="text-sm">All phases (triage → analyze → brief)</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="phase"
              value="triage"
              checked={phase === "triage"}
              onChange={() => setPhase("triage")}
              className="text-plum"
              disabled={inboxCount === 0}
            />
            <span className={`text-sm ${inboxCount === 0 ? "text-warm-500" : ""}`}>
              Triage only ({inboxCount} inbox items)
            </span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="phase"
              value="analyze"
              checked={phase === "analyze"}
              onChange={() => setPhase("analyze")}
              className="text-plum"
              disabled={inboxCount === 0}
            />
            <span className={`text-sm ${inboxCount === 0 ? "text-warm-500" : ""}`}>
              Analyze only ({inboxCount} inbox items)
            </span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="phase"
              value="brief"
              checked={phase === "brief"}
              onChange={() => setPhase("brief")}
              className="text-plum"
              disabled={poolCount === 0}
            />
            <span className={`text-sm ${poolCount === 0 ? "text-warm-500" : ""}`}>
              Create brief ({poolCount} pool items)
            </span>
          </label>
        </div>
      </div>

      {/* Submit */}
      <div className="flex gap-2">
        <button
          onClick={handleSubmit}
          className="btn btn-primary flex-1 font-mono text-sm"
        >
          cb process-news
          {phase === "triage" && " --triage-only"}
          {phase === "analyze" && " --analyze-only"}
          {phase === "brief" && " --brief-only"}
        </button>
        <button onClick={onClose} className="btn btn-secondary">
          Cancel
        </button>
      </div>

      <p className="text-xs text-warm-600 text-center mt-3">
        The agent will process news items using Claude Code.
      </p>
    </div>
  );
}

/**
 * Build a command label for display.
 */
export function buildProcessNewsLabel(args: ProcessNewsArgs): string {
  const parts = ["cb process-news", `--batch-size ${args.batchSize}`];
  if (args.triageOnly) parts.push("--triage-only");
  if (args.analyzeOnly) parts.push("--analyze-only");
  if (args.briefOnly) parts.push("--brief-only");
  return parts.join(" ");
}
