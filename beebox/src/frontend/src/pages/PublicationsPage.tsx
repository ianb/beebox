/** Compatibility index that opens each publication's reference card. */

import { useState } from "react";
import { useParams, useNavigate } from "@tanstack/react-router";
import { trpc } from "../lib/trpc/client";
import { href } from "../lib/routing";
import { serializeViewUrl } from "../lib/view-url";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { ErrorText } from "../components/ui/ErrorText";
import { Heading } from "../components/ui/Heading";
import { Hint } from "../components/ui/Hint";
import { Stack } from "../components/ui/Stack";
import { StatusMessage } from "../components/ui/StatusMessage";
import { Text } from "../components/ui/Text";
import { TextLink } from "../components/ui/TextLink";
import { SignInLink } from "../components/BoxSelectionTiles";

export function PublicationsPage() {
  const { boxSlug } = useParams({ strict: false });
  const navigate = useNavigate();
  const [ensureCommitWarning, setEnsureCommitWarning] = useState<{ message: string; cardPath: string } | null>(null);
  const query = trpc.publications.list.useQuery();
  const ensureCard = trpc.publications.ensureCard.useMutation({
    onSuccess: async ({ cardPath, commitWarning }) => {
      if (commitWarning !== null) {
        setEnsureCommitWarning({ message: commitWarning, cardPath });
      } else {
        await navigate({ to: href(`/${boxSlug}/views/${serializeViewUrl({ path: cardPath, viewer: null, params: {}, viewState: null })}`) });
      }
    },
  });
  const openCard = (cardPath: string) => href(`/${boxSlug}/views/${serializeViewUrl({ path: cardPath, viewer: null, params: {}, viewState: null })}`);

  return (
    <Stack gap="none" overflow="auto" focusable className="h-full">
      <Stack gap="lg" className="max-w-3xl mx-auto py-8 px-4 w-full">
        <Stack gap="xs">
          <Text as="h1" size="2xl" weight="bold">Publications</Text>
          <Hint>Open a publication&apos;s reference card to review its prepared files and serving controls. The card links to server-owned state; its notes and fields do not grant approval.</Hint>
        </Stack>

        {ensureCard.error ? <div role="alert"><Stack gap="xs"><ErrorText>{ensureCard.error.message}</ErrorText>{ensureCard.error.data?.code === "UNAUTHORIZED" || ensureCard.error.data?.code === "FORBIDDEN" ? <SignInLink returnTo={window.location.pathname + window.location.search} /> : null}</Stack></div> : null}
        {ensureCommitWarning ? <div role="alert"><Stack gap="xs"><ErrorText>{ensureCommitWarning.message}</ErrorText><TextLink id="bbx-publication-open-created-card" className="self-start" to={openCard(ensureCommitWarning.cardPath)}>Open review card</TextLink></Stack></div> : null}
        {query.error ? <div role="alert"><Card><Stack gap="sm"><ErrorText>{query.error.message}</ErrorText>{query.error.data?.code === "UNAUTHORIZED" || query.error.data?.code === "FORBIDDEN" ? <SignInLink returnTo={window.location.pathname + window.location.search} /> : <Button id="bbx-publications-retry" intent="secondary" onClick={() => void query.refetch()}>Retry</Button>}</Stack></Card></div> : null}
        {query.isLoading ? <StatusMessage>Loading publications…</StatusMessage> : null}
        {query.data?.sites.length === 0 ? (
          <Card><Stack gap="sm"><Heading level={2}>Nothing prepared yet</Heading><Text size="sm">Ask the box agent to prepare a publication. It will appear here for review.</Text></Stack></Card>
        ) : null}
        {query.data?.sites.map((site) => (
          <Card key={site.pubId} as="article">
            <Stack gap="sm">
              <Stack gap="xs">
                <Heading level={2}>{site.title || site.name}</Heading>
                <Text size="sm">Serving state: <Badge tone={site.remoteStatus.status === "unavailable" ? "danger" : site.approved?.status === "live" ? "success" : site.approved?.status === "disabled" ? "warning" : "neutral"}>{site.remoteStatus.status === "unavailable" ? "unknown" : site.approved?.status ?? "not enabled"}</Badge></Text>
                {site.pending ? <Hint>A prepared update is waiting for review.</Hint> : null}
              </Stack>
              {site.hasCard
                ? <TextLink id={`bbx-publication-card-${site.pubId}`} className="self-start" to={openCard(site.cardPath)}>Open review card</TextLink>
                : <Button id={`bbx-publication-ensure-card-${site.pubId}`} className="self-start" intent="secondary" loading={ensureCard.isPending} disabled={ensureCard.isPending} onClick={() => { setEnsureCommitWarning(null); ensureCard.mutate({ pubId: site.pubId }); }}>Ensure card and open</Button>}
            </Stack>
          </Card>
        ))}
      </Stack>
    </Stack>
  );
}
