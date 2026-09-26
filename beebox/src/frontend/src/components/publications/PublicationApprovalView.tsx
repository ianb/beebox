/** Loads the server-owned publication record and wires member-gated actions. */

import { useState } from "react";
import { trpc } from "../../lib/trpc";
import { SignInLink } from "../BoxSelectionTiles";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { ErrorText } from "../ui/ErrorText";
import { Stack } from "../ui/Stack";
import { StatusMessage } from "../ui/StatusMessage";
import { PublicationReviewCard } from "./PublicationReviewCard";

interface MutationNotice {
  message: string;
  needsSignIn: boolean;
}

export function handlePublicationMutationError(
  input: {
    error: { message: string; data?: { code?: string } | null };
    setNotice: (notice: MutationNotice) => void;
    refreshList: () => Promise<unknown>;
  },
): Promise<unknown> {
  input.setNotice({ message: input.error.message, needsSignIn: input.error.data?.code === "UNAUTHORIZED" || input.error.data?.code === "FORBIDDEN" });
  return input.refreshList();
}

/** Fetches current server authority and wires the existing member-gated actions. */
export function PublicationApprovalView({ pubId }: { pubId: string }) {
  const query = trpc.publications.list.useQuery();
  const utils = trpc.useUtils();
  const [mutationError, setMutationError] = useState<MutationNotice | null>(null);
  const refreshList = () => utils.publications.list.invalidate();
  const onMutationError = (error: { message: string; data?: { code?: string } | null }) => handlePublicationMutationError({ error, setNotice: setMutationError, refreshList });
  const prepare = trpc.publications.prepare.useMutation({
    onSuccess: async () => { setMutationError(null); await refreshList(); },
    onError: onMutationError,
  });
  const approve = trpc.publications.approve.useMutation({
    onSuccess: async () => { setMutationError(null); await refreshList(); },
    onError: onMutationError,
  });
  const enable = trpc.publications.enable.useMutation({
    onSuccess: async () => { setMutationError(null); await refreshList(); },
    onError: onMutationError,
  });
  const disable = trpc.publications.disable.useMutation({
    onSuccess: async () => { setMutationError(null); await refreshList(); },
    onError: onMutationError,
  });
  const pending = prepare.isPending || approve.isPending || enable.isPending || disable.isPending;
  const site = query.data?.sites.find((publication) => publication.pubId === pubId);
  const sharedHost = query.data?.sharedHost ?? null;

  if (query.isLoading) return <StatusMessage>Loading publication review…</StatusMessage>;
  if (query.error) return <div role="alert"><Card><Stack gap="sm"><ErrorText>{query.error.message}</ErrorText>{query.error.data?.code === "UNAUTHORIZED" || query.error.data?.code === "FORBIDDEN" ? <SignInLink returnTo={window.location.pathname + window.location.search} /> : <Button id={`bbx-publication-review-retry-${pubId}`} intent="secondary" onClick={() => void query.refetch()}>Retry</Button>}</Stack></Card></div>;
  if (site === undefined) return <StatusMessage>This publication is not available in this box.</StatusMessage>;

  return <Stack gap="sm">
    {mutationError ? <div role="alert"><Stack gap="xs"><ErrorText>{mutationError.message}</ErrorText>{mutationError.needsSignIn ? <SignInLink returnTo={window.location.pathname + window.location.search} /> : null}</Stack></div> : null}
    <PublicationReviewCard
      site={site}
      sharedHost={sharedHost}
      pending={pending}
      onPrepare={() => { setMutationError(null); prepare.mutate({ name: site.name }); }}
      onApprove={(candidate) => { setMutationError(null); approve.mutate({ pubId: site.pubId, expectedRevision: candidate.revision }); }}
      onEnable={() => { setMutationError(null); enable.mutate({ pubId: site.pubId }); }}
      onDisable={() => { setMutationError(null); disable.mutate({ pubId: site.pubId }); }}
    />
  </Stack>;
}
