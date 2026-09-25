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
import { AdminSectionCard } from "./AdminSectionCard";
import { GmailLabelList } from "./GmailFiltersSection-views";

type GmailConfig = RouterOutput["admin"]["gmailConfig"];
type GmailAction = NonNullable<GmailConfig["action"]>;

const DESCRIPTION = (
  <>
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
  </>
);
const RULES_DESCRIPTION = (
  <>
    This box uses named, bounded Gmail rules. Edit them in{" "}
    <code className="text-xs bg-warm-100 px-1 rounded">_config/connectors/gmail.json</code>
    . This simpler form is disabled so it cannot overwrite them.
  </>
);

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
      <AdminSectionCard id="gmail-filters" description={DESCRIPTION}>
        {initialError ? (
          <div className="p-3 bg-danger-50 border border-danger-100 rounded text-sm text-danger-dark">
            {initialError}
          </div>
        ) : null}
      </AdminSectionCard>
    );
  }

  if (gmailConfigQuery.data.usesRules) {
    return <AdminSectionCard id="gmail-filters" description={RULES_DESCRIPTION}>{null}</AdminSectionCard>;
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
    <AdminSectionCard id="gmail-filters" description={DESCRIPTION}>
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
    </AdminSectionCard>
  );
}
