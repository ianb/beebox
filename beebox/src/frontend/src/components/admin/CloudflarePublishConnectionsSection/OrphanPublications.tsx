/** Publications the server still serves or records but no card in the box points at. */

import { trpc, type RouterOutput } from "../../../lib/trpc/client";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { Card } from "../../ui/Card";
import { ErrorText } from "../../ui/ErrorText";
import { Heading } from "../../ui/Heading";
import { Hint } from "../../ui/Hint";
import { Row } from "../../ui/Row";
import { Stack } from "../../ui/Stack";
import { Text } from "../../ui/Text";

type PublicationSite = RouterOutput["publications"]["list"]["sites"][number];

/** Rows with no card at all; duplicate-card rows have cards and are fixed there. */
export function orphanPublications(sites: readonly PublicationSite[]): PublicationSite[] {
  return sites.filter((site) => site.cardPath === null && site.duplicateCardPaths.length === 0);
}

function servingState(site: PublicationSite): { label: string; tone: "danger" | "success" | "warning" | "neutral" } {
  if (site.remoteStatus.status === "unavailable") return { label: "unknown", tone: "danger" };
  if (site.approved?.status === "live") return { label: "live", tone: "success" };
  if (site.approved?.status === "disabled") return { label: "disabled", tone: "warning" };
  return { label: site.approved?.status ?? "not enabled", tone: "neutral" };
}

/** Presentational list; renders nothing when every publication has a card. */
export function OrphanPublicationList(props: {
  sites: readonly PublicationSite[];
  disablingPubId: string | null;
  error: string | null;
  onDisable: (pubId: string) => void;
}) {
  const orphans = orphanPublications(props.sites);
  if (orphans.length === 0) return null;
  return (
    <Stack gap="sm">
      <Stack gap="xs">
        <Heading level={3}>Publications without a card</Heading>
        <Hint>No card in this box describes these publications. Disable any that should stop serving.</Hint>
      </Stack>
      {props.error ? <div role="alert"><ErrorText>{props.error}</ErrorText></div> : null}
      {orphans.map((site) => {
        const state = servingState(site);
        return (
          <Card key={site.pubId} as="article">
            <Row gap="sm" wrap align="center" justify="between">
              <Stack gap="xs">
                <Text weight="medium">{site.title || site.name}</Text>
                <Text size="sm">Serving state: <Badge tone={state.tone}>{state.label}</Badge></Text>
              </Stack>
              {site.approved?.status === "live" ? (
                <Button
                  id={`bbx-admin-orphan-publication-disable-${site.pubId}`}
                  intent="secondary"
                  loading={props.disablingPubId === site.pubId}
                  disabled={props.disablingPubId !== null}
                  onClick={() => props.onDisable(site.pubId)}
                >
                  Disable
                </Button>
              ) : null}
            </Row>
          </Card>
        );
      })}
    </Stack>
  );
}

export function OrphanPublications() {
  const publications = trpc.publications.list.useQuery();
  const utils = trpc.useUtils();
  const disable = trpc.publications.disable.useMutation({
    onSettled: () => utils.publications.list.invalidate(),
  });
  return (
    <OrphanPublicationList
      sites={publications.data?.sites ?? []}
      disablingPubId={disable.isPending ? disable.variables.pubId : null}
      error={disable.error?.message ?? null}
      onDisable={(pubId) => disable.mutate({ pubId })}
    />
  );
}
