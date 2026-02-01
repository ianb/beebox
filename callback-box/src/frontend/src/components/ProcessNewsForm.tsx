/**
 * ProcessNewsForm - Controls for running the news processing agent.
 */

import { useState } from "react";

export interface ProcessNewsArgs {
  batchSize: number;
  triageOnly: boolean;
  fetchOnly: boolean;
  summarizeOnly: boolean;
}

interface ProcessNewsFormProps {
  onSubmit: (args: ProcessNewsArgs) => void;
  onClose: () => void;
  newCount: number;
  interestingCount: number;
  fetchedCount: number;
}

export function ProcessNewsForm({
  onSubmit,
  onClose,
  newCount,
  interestingCount,
  fetchedCount,
}: ProcessNewsFormProps) {
  const [batchSize, setBatchSize] = useState(5);
  const [phase, setPhase] = useState<"all" | "triage" | "fetch" | "summarize">("all");

  const handleSubmit = () => {
    onSubmit({
      batchSize,
      triageOnly: phase === "triage",
      fetchOnly: phase === "fetch",
      summarizeOnly: phase === "summarize",
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
        <div className="text-sm text-gray-600 mb-2">Current Status:</div>
        <div className="flex gap-4 text-sm">
          <div className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-full bg-blue-500"></span>
            <span>{newCount} new</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-full bg-yellow-500"></span>
            <span>{interestingCount} interesting</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-full bg-green-500"></span>
            <span>{fetchedCount} fetched</span>
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
          max={20}
          value={batchSize}
          onChange={(e) => setBatchSize(parseInt(e.target.value) || 5)}
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
            <span className="text-sm">All phases (triage → fetch → summarize)</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="phase"
              value="triage"
              checked={phase === "triage"}
              onChange={() => setPhase("triage")}
              className="text-blue-600"
              disabled={newCount === 0}
            />
            <span className={`text-sm ${newCount === 0 ? "text-gray-400" : ""}`}>
              Triage only ({newCount} new items)
            </span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="phase"
              value="fetch"
              checked={phase === "fetch"}
              onChange={() => setPhase("fetch")}
              className="text-blue-600"
              disabled={interestingCount === 0}
            />
            <span className={`text-sm ${interestingCount === 0 ? "text-gray-400" : ""}`}>
              Fetch only ({interestingCount} interesting items)
            </span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="phase"
              value="summarize"
              checked={phase === "summarize"}
              onChange={() => setPhase("summarize")}
              className="text-blue-600"
              disabled={fetchedCount === 0}
            />
            <span className={`text-sm ${fetchedCount === 0 ? "text-gray-400" : ""}`}>
              Summarize only ({fetchedCount} fetched items)
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
          {phase === "fetch" && " --fetch-only"}
          {phase === "summarize" && " --summarize-only"}
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
  if (args.fetchOnly) parts.push("--fetch-only");
  if (args.summarizeOnly) parts.push("--summarize-only");
  return parts.join(" ");
}
