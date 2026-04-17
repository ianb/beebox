/**
 * ProcessNewsForm - Controls for running the news processing agent.
 *
 * The news processing pipeline has three phases:
 * 1. Triage: Review items in inbox/news/, trash uninteresting ones
 * 2. Analyze: Fetch content & add analysis, move to pool/news/
 * 3. Brief: Create brief from pool items, archive used ones
 */

import { useState } from "react";
import { NumberField, RadioGroup } from "./ui/fields";
import { Button } from "./ui/Button";
import { CloseButton } from "./ui/CloseButton";
import { CancelButton } from "./ui/CancelButton";

type Phase = "all" | "triage" | "analyze" | "brief";

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
  const [phase, setPhase] = useState<Phase>("all");

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
        <CloseButton onClick={onClose} />
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
      <NumberField
        label="Batch Size"
        value={batchSize}
        onChange={(n) => setBatchSize(n === null ? 10 : n)}
        min={1}
        max={50}
        helper="items per phase"
        inputClassName="max-w-[8rem]"
        className="mb-4"
      />

      {/* Phase selection */}
      <RadioGroup
        label="Run Phase"
        name="phase"
        value={phase}
        onChange={(v) => setPhase(v as Phase)}
        options={[
          { value: "all", label: "All phases (triage → analyze → brief)" },
          { value: "triage", label: `Triage only (${inboxCount} inbox items)`, disabled: inboxCount === 0 },
          { value: "analyze", label: `Analyze only (${inboxCount} inbox items)`, disabled: inboxCount === 0 },
          { value: "brief", label: `Create brief (${poolCount} pool items)`, disabled: poolCount === 0 },
        ]}
        className="mb-4"
      />

      {/* Submit */}
      <div className="flex gap-2">
        <Button type="button" intent="primary" fullWidth size="sm" onClick={handleSubmit} className="flex-1">
          <span className="font-mono">
            cb process-news
            {phase === "triage" && " --triage-only"}
            {phase === "analyze" && " --analyze-only"}
            {phase === "brief" && " --brief-only"}
          </span>
        </Button>
        <CancelButton onClick={onClose} />
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
