/**
 * ProcessNewsForm - Controls for running the news processing agent.
 *
 * The news processing pipeline has three phases:
 * 1. Triage: Review items in inbox/news/, trash uninteresting ones
 * 2. Analyze: Fetch content & add analysis, move to pool/news/
 * 3. Edition: Create edition from pool items, archive used ones
 */

import { useState } from "react";

export interface ProcessNewsArgs {
  batchSize: number;
  triageOnly: boolean;
  analyzeOnly: boolean;
  editionOnly: boolean;
}

interface ProcessNewsFormProps {
  onSubmit: (args: ProcessNewsArgs) => void;
  onClose: () => void;
  /** Items in box/inbox/news/ awaiting triage */
  inboxCount: number;
  /** Items in box/pool/news/ ready for edition */
  poolCount: number;
}

export function ProcessNewsForm({
  onSubmit,
  onClose,
  inboxCount,
  poolCount,
}: ProcessNewsFormProps) {
  const [batchSize, setBatchSize] = useState(10);
  const [phase, setPhase] = useState<"all" | "triage" | "analyze" | "edition">("all");

  const handleSubmit = () => {
    onSubmit({
      batchSize,
      triageOnly: phase === "triage",
      analyzeOnly: phase === "analyze",
      editionOnly: phase === "edition",
    });
  };

  return (
    <div className="bg-white rounded-lg shadow p-4 max-w-xl">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold text-gray-900">Process News</h3>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Status summary */}
      <div className="mb-4 p-3 bg-gray-50 rounded-lg">
        <div className="text-sm text-gray-600 mb-2">Pipeline Status:</div>
        <div className="flex gap-4 text-sm">
          <div className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-full bg-blue-500"></span>
            <span>{inboxCount} in inbox</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-full bg-green-500"></span>
            <span>{poolCount} in pool</span>
          </div>
        </div>
      </div>

      {/* Batch size */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">
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
        <span className="text-sm text-gray-500 ml-2">items per phase</span>
      </div>

      {/* Phase selection */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">
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
              className="text-blue-600"
            />
            <span className="text-sm">All phases (triage → analyze → edition)</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="phase"
              value="triage"
              checked={phase === "triage"}
              onChange={() => setPhase("triage")}
              className="text-blue-600"
              disabled={inboxCount === 0}
            />
            <span className={`text-sm ${inboxCount === 0 ? "text-gray-400" : ""}`}>
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
              className="text-blue-600"
              disabled={inboxCount === 0}
            />
            <span className={`text-sm ${inboxCount === 0 ? "text-gray-400" : ""}`}>
              Analyze only ({inboxCount} inbox items)
            </span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="phase"
              value="edition"
              checked={phase === "edition"}
              onChange={() => setPhase("edition")}
              className="text-blue-600"
              disabled={poolCount === 0}
            />
            <span className={`text-sm ${poolCount === 0 ? "text-gray-400" : ""}`}>
              Create edition ({poolCount} pool items)
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
          {phase === "edition" && " --edition-only"}
        </button>
        <button onClick={onClose} className="btn btn-secondary">
          Cancel
        </button>
      </div>

      <p className="text-xs text-gray-500 text-center mt-3">
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
  if (args.editionOnly) parts.push("--edition-only");
  return parts.join(" ");
}
