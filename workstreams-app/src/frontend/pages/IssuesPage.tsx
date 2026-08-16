import { useState } from "react";

import { issueChangeKey, IssuesPane } from "../components/IssuesPane.js";
import { Button } from "../components/ui.js";
import { trpc } from "../trpc.js";
import type { Issue, IssueChange } from "../types.js";

export function IssuesPage() {
  const [changes, setChanges] = useState<Map<string, IssueChange>>(new Map());
  const issues = trpc.issues.list.useQuery();
  const utils = trpc.useUtils();
  const save = trpc.issues.save.useMutation({
    onSuccess: async () => {
      setChanges(new Map());
      await utils.issues.list.invalidate();
    },
  });
  function change(next: IssueChange): void {
    setChanges((current) => {
      const updated = new Map(current);
      const key = issueChangeKey(next);
      if (next.priority === next.originalPriority && next.nextAction === next.originalNextAction) updated.delete(key);
      else updated.set(key, next);
      return updated;
    });
  }
  if (issues.isLoading) return <main className="simple-page"><section className="loading-skeleton" aria-busy="true"><span /><span /><span /></section></main>;
  if (issues.isError) return <main className="simple-page"><section className="error-state"><p>Couldn’t load issues: {issues.error.message}</p><Button onClick={() => void issues.refetch()}>Retry</Button></section></main>;
  const records: Issue[] = issues.data?.items ?? [];
  function submit(): void { save.mutate({ changes: [...changes.values()] }); }
  return <>{save.isError ? <p className="save-error" role="alert">Couldn’t save issue changes: {save.error.message}</p> : null}<IssuesPane issues={records} changes={changes} saving={save.isPending} onChange={change} onReset={() => setChanges(new Map())} onSave={submit} /></>;
}
