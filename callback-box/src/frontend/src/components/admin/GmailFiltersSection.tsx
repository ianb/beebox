/**
 * Gmail filter config — `query` (Gmail search syntax) and/or `labels` (OR-joined).
 * Only renders when Gmail is enabled for this box (per box-config).
 */

import { useState } from "react";
import { trpc, type RouterOutput } from "../../lib/trpc";
import { TextField } from "../ui/fields";
import { Button } from "../ui/Button";

type GmailConfig = RouterOutput["admin"]["gmailConfig"];

export function GmailFiltersSection() {
  const boxConfigQuery = trpc.admin.boxConfig.useQuery();
  const gmailConfigQuery = trpc.admin.gmailConfig.useQuery();

  const enabled = boxConfigQuery.data?.googleServices?.gmail === true;
  const initialError =
    boxConfigQuery.error?.message ?? gmailConfigQuery.error?.message ?? null;

  if (boxConfigQuery.isLoading || gmailConfigQuery.isLoading) return null;
  if (!enabled) return null;

  if (initialError || !gmailConfigQuery.data) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-warm-800 mb-2">Gmail Filters</h2>
        {initialError ? (
          <div className="p-3 bg-danger-50 border border-danger-100 rounded text-sm text-danger-dark">
            {initialError}
          </div>
        ) : null}
      </div>
    );
  }

  return <GmailFiltersForm initial={gmailConfigQuery.data} />;
}

function GmailFiltersForm({ initial }: { initial: GmailConfig }) {
  const updateMutation = trpc.admin.updateGmailConfig.useMutation();
  const utils = trpc.useUtils();

  const [query, setQuery] = useState(initial.query);
  const [labels, setLabels] = useState<string[]>(initial.labels);
  const [newLabel, setNewLabel] = useState("");
  const [savedFlash, setSavedFlash] = useState(false);

  const dirty =
    query !== initial.query ||
    labels.length !== initial.labels.length ||
    labels.some((l, i) => l !== initial.labels[i]);

  const handleSave = async () => {
    setSavedFlash(false);
    try {
      const result = await updateMutation.mutateAsync({ query, labels });
      setQuery(result.query);
      setLabels(result.labels);
      utils.admin.gmailConfig.invalidate();
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
    } catch (_e) {
      // error surfaced to the user via updateMutation.error state
    }
  };

  const handleAddLabel = () => {
    const label = newLabel.trim();
    if (!label || labels.includes(label)) {
      setNewLabel("");
      return;
    }
    setLabels([...labels, label]);
    setNewLabel("");
  };

  const handleRemoveLabel = (label: string) => {
    setLabels(labels.filter((l) => l !== label));
  };

  const error = updateMutation.error?.message ?? null;

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-lg font-semibold text-warm-800 mb-2">Gmail Filters</h2>
      <p className="text-sm text-warm-700 mb-4">
        Restrict which Gmail messages get pulled into this box. Uses{" "}
        <a
          href="https://support.google.com/mail/answer/7190?hl=en"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline"
        >
          Gmail search syntax
        </a>
        . If query is set, it overrides labels. If both are empty, the connector
        defaults to <code className="text-xs bg-warm-100 px-1 rounded">label:inbox</code>.
      </p>

      <div className="mb-4">
        <TextField
          label="Search query"
          value={query}
          onChange={setQuery}
          placeholder="label:inbox -category:promotions"
          helper="Full Gmail search expression. Leave empty to use the labels list below."
        />
      </div>

      <div className="mb-4">
        <label className="block text-sm font-medium text-warm-700 mb-2">
          Labels (OR-joined when no query is set)
        </label>
        {labels.length > 0 ? (
          <div className="mb-2 space-y-2">
            {labels.map((label) => (
              <div
                key={label}
                className="flex items-center gap-2 p-2 bg-warm-50 border border-warm-200 rounded text-sm"
              >
                <span className="flex-1 text-warm-800">{label}</span>
                <button
                  onClick={() => handleRemoveLabel(label)}
                  disabled={updateMutation.isPending}
                  className="text-warm-500 hover:text-danger-dark text-xs px-2"
                >
                  remove
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="mb-2 p-3 bg-warm-50 border border-warm-200 rounded text-sm text-warm-600">
            No labels configured.
          </div>
        )}
        <div className="flex gap-2 items-start">
          <TextField
            label="Add label"
            hideLabel
            value={newLabel}
            onChange={setNewLabel}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAddLabel();
              }
            }}
            placeholder="inbox"
            className="flex-1"
          />
          <Button
            intent="secondary"
            onClick={handleAddLabel}
            disabled={!newLabel.trim()}
          >
            Add
          </Button>
        </div>
      </div>

      <div className="flex gap-3 items-center">
        <Button
          intent="primary"
          onClick={handleSave}
          disabled={!dirty}
          loading={updateMutation.isPending}
          loadingLabel="Saving…"
        >
          Save
        </Button>
        {savedFlash ? (
          <span className="text-sm text-success-dark">Saved.</span>
        ) : null}
      </div>

      {error ? (
        <div className="mt-3 p-3 bg-danger-50 border border-danger-100 rounded text-sm text-danger-dark">
          {error}
        </div>
      ) : null}
    </div>
  );
}
