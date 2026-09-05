/**
 * Gmail filter config — `query` (Gmail search syntax) and/or `labels`
 * (OR-joined), plus what to do with a match. The action is deliberately not
 * defaulted here: it used to be implied, which made saving a filter create
 * cards without ever saying it would.
 * Only renders when Gmail is enabled for this box (per box-config).
 */

import { useState } from "react";
import { trpc, type RouterOutput } from "../../lib/trpc";
import { SelectField, TextField } from "../ui/fields";
import { Button } from "../ui/Button";

type GmailConfig = RouterOutput["admin"]["gmailConfig"];
type GmailAction = NonNullable<GmailConfig["action"]>;

const PROCEDURE_REF_PATTERN = /^_config\/procedures\/(?!.*\.\.)[^/]+\.procedure\.card$/;

const ACTION_OPTIONS = [
  { value: "", label: "Choose what happens…", disabled: true },
  { value: "stage", label: "Stage for review — records a list, creates nothing" },
  { value: "track", label: "Track as cards (bounded, 25 per 7 days)" },
  { value: "procedure", label: "Run a procedure — creates no cards" },
];

export function GmailFiltersSection() {
  const boxConfigQuery = trpc.admin.boxConfig.useQuery();
  const gmailConfigQuery = trpc.admin.gmailConfig.useQuery();

  const enabled = boxConfigQuery.data?.googleServices.gmail === true;
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

  if (gmailConfigQuery.data.usesRules) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-warm-800 mb-2">Gmail Rules</h2>
        <p className="text-sm text-warm-700">
          This box uses named, bounded Gmail rules. Edit them in{" "}
          <code className="text-xs bg-warm-100 px-1 rounded">
            _config/connectors/gmail.json
          </code>
          . This simpler form is disabled so it cannot overwrite them.
        </p>
      </div>
    );
  }

  return <GmailFiltersForm initial={gmailConfigQuery.data} />;
}

/** The chosen action, or null when the form cannot yet describe a valid one. */
function buildAction(input: { actionType: string; procedureRef: string }): GmailAction | null {
  if (input.actionType === "track") return { type: "track" };
  if (input.actionType === "stage") return { type: "stage" };
  if (input.actionType !== "procedure") return null;
  const ref = input.procedureRef.trim();
  return PROCEDURE_REF_PATTERN.test(ref) ? { type: "procedure", ref } : null;
}

function GmailFiltersForm({ initial }: { initial: GmailConfig }) {
  const updateMutation = trpc.admin.updateGmailConfig.useMutation();
  const utils = trpc.useUtils();

  const [query, setQuery] = useState(initial.query);
  const [labels, setLabels] = useState<string[]>(initial.labels);
  const [newLabel, setNewLabel] = useState("");
  const [actionType, setActionType] = useState(initial.action?.type ?? "");
  const [procedureRef, setProcedureRef] = useState(
    initial.action?.type === "procedure" ? initial.action.ref : "",
  );
  const [savedFlash, setSavedFlash] = useState(false);

  const action = buildAction({ actionType, procedureRef });
  const matches = query.trim() !== "" || labels.length > 0;
  const dirty =
    query !== initial.query ||
    actionType !== (initial.action?.type ?? "") ||
    procedureRef !== (initial.action?.type === "procedure" ? initial.action.ref : "") ||
    labels.length !== initial.labels.length ||
    labels.some((l, i) => l !== initial.labels[i]);

  const handleSave = async () => {
    if (matches && action === null) return;
    setSavedFlash(false);
    try {
      const result = await updateMutation.mutateAsync({
        query,
        labels,
        ...(action === null ? {} : { action }),
      });
      setQuery(result.query);
      setLabels(result.labels);
      setActionType(result.action?.type ?? "");
      void utils.admin.gmailConfig.invalidate();
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
        Choose which Gmail threads this box collects, and what happens to them. Uses{" "}
        <a
          id="bbx-admin-gmail-syntax-help"
          href="https://support.google.com/mail/answer/7190?hl=en"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline"
        >
          Gmail search syntax
        </a>
        . Matching threads are not stored until you say what should happen to
        them below. If both fields are empty, nothing matches.
      </p>

      <div className="mb-4">
        <TextField
          id="bbx-admin-gmail-query"
          label="Search query"
          value={query}
          onChange={setQuery}
          placeholder="label:inbox -category:promotions"
          helper="Full Gmail search expression. Leave empty to use the labels list below."
        />
      </div>

      <GmailLabelList
        labels={labels}
        newLabel={newLabel}
        busy={updateMutation.isPending}
        onNewLabelChange={setNewLabel}
        onAdd={handleAddLabel}
        onRemove={handleRemoveLabel}
      />

      <div className="mb-4">
        <SelectField
          id="bbx-admin-gmail-on-match"
          label="On match"
          value={actionType}
          onChange={setActionType}
          options={ACTION_OPTIONS}
          helper={
            matches
              ? "Staging records a summary you read with `bbx connector gmail pending` and promote by hand. Tracking writes a card per matching thread. A procedure runs instead, and writes nothing itself."
              : "Add a query or a label above — there is nothing to act on yet."
          }
        />
      </div>

      {actionType === "procedure" ? (
        <div className="mb-4">
          <TextField
            id="bbx-admin-gmail-procedure"
            label="Procedure"
            value={procedureRef}
            onChange={setProcedureRef}
            placeholder="_config/procedures/triage-mail.procedure.card"
            error={
              procedureRef.trim() !== "" && !PROCEDURE_REF_PATTERN.test(procedureRef.trim())
                ? "Must be a path under _config/procedures/ ending in .procedure.card"
                : undefined
            }
            helper="Runs when new mail matches. Inspect matches with: bbx connector gmail pending"
          />
        </div>
      ) : null}

      <div className="flex gap-3 items-center">
        <Button
          id="bbx-admin-gmail-save"
          intent="primary"
          onClick={handleSave}
          disabled={!dirty || (matches && action === null)}
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

interface GmailLabelListProps {
  labels: string[];
  newLabel: string;
  busy: boolean;
  onNewLabelChange: (value: string) => void;
  onAdd: () => void;
  onRemove: (label: string) => void;
}

function GmailLabelList({
  labels,
  newLabel,
  busy,
  onNewLabelChange,
  onAdd,
  onRemove,
}: GmailLabelListProps) {
  return (
      <div className="mb-4">
      {/* Heading for the label-chips group below, not a control label — the
          actual input ("Add label") carries its own associated label. */}
      <p className="block text-sm font-medium text-warm-700 mb-2">
        Labels (OR-joined when no query is set)
      </p>
      {labels.length > 0 ? (
        <div className="mb-2 space-y-2">
          {labels.map((label) => (
            <div
              key={label}
              className="flex items-center gap-2 p-2 bg-warm-50 border border-warm-200 rounded text-sm"
            >
              <span className="flex-1 text-warm-800">{label}</span>
              <button
                onClick={() => onRemove(label)}
                disabled={busy}
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
          id="bbx-admin-gmail-new-label"
          label="Add label"
          hideLabel
          value={newLabel}
          onChange={onNewLabelChange}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onAdd();
            }
          }}
          placeholder="inbox"
          className="flex-1"
        />
        <Button
          id="bbx-admin-gmail-add-label"
          intent="secondary"
          onClick={onAdd}
          disabled={!newLabel.trim()}
        >
          Add
        </Button>
      </div>
    </div>
  );
}
