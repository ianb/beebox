/** Owner-controlled one-time Custom Domain assignment for a prepared publication. */

import { useState, type FormEvent } from "react";
import { trpc, type RouterOutput } from "../../lib/trpc";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { ErrorText } from "../ui/ErrorText";
import { Heading } from "../ui/Heading";
import { Hint } from "../ui/Hint";
import { Stack } from "../ui/Stack";
import { Text } from "../ui/Text";
import { CheckboxField, SelectField, TextField } from "../ui/fields";

type Site = RouterOutput["publications"]["list"]["sites"][number];

function eligible(site: Site): boolean {
  const tier = site.pending?.requestedScope.tier;
  const assignedScope = site.pending?.requestedScope;
  const requestedHostname = assignedScope !== undefined && "customHostname" in assignedScope
    ? assignedScope.customHostname
    : undefined;
  const firstAssignment = site.assignedCustomHostname === null && site.customHostnameStatus === null && requestedHostname === undefined;
  const retryPendingAttach = site.assignedCustomHostname !== null && site.customHostnameStatus === "pending";
  return site.remoteStatus.status === "available"
    && site.approved?.status === "disabled"
    && site.pending !== null
    && (tier === "public" || tier === "secret")
    && (firstAssignment || retryPendingAttach);
}

export function CustomHostnameAssignment() {
  const publications = trpc.publications.list.useQuery();
  const utils = trpc.useUtils();
  const [pubId, setPubId] = useState("");
  const [hostname, setHostname] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const assign = trpc.publications.assignCustomHostname.useMutation({ onError: () => setStatus(null) });
  const eligibleSites = (publications.data?.sites ?? []).filter(eligible);
  const selected = eligibleSites.find((site) => site.pubId === pubId) ?? eligibleSites[0];
  const retrying = selected?.customHostnameStatus === "pending";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selected === undefined) return;
    setStatus(null);
    try {
      const destination = retrying ? selected.assignedCustomHostname : hostname.trim();
      if (destination === null) return;
      const result = await assign.mutateAsync({ pubId: selected.pubId, hostname: destination });
      setStatus(`Hostname ${result.hostname} is assigned and confirmed. HTTPS may still be provisioning. The workers.dev URL remains available.`);
      setHostname("");
      setAcknowledged(false);
      await utils.publications.list.invalidate();
    } catch (_error) {
      // Mutation state renders the sanitized error below the form.
    }
  }

  return (
    <Stack gap="sm">
      <Stack gap="xs">
        <Heading level={3}>Assign a custom hostname</Heading>
        <Hint>Assign one exact hostname to an existing disabled public or secret site. A box member must approve the destination before enabling it.</Hint>
      </Stack>
      <div role="note"><Badge tone="warning">Cloudflare will begin DNS and certificate changes immediately, even while the site is disabled. This hostname stays reserved to this publication; detaching it in Cloudflare does not release it for reuse in Bee Box.</Badge></div>
      {publications.isLoading ? <Text size="sm" tone="muted">Loading eligible publications…</Text> : null}
      {publications.error ? <div role="alert"><ErrorText>{publications.error.message}</ErrorText></div> : null}
      {assign.error ? <div role="alert"><ErrorText>{assign.error.message}</ErrorText></div> : null}
      {status ? <div role="status" aria-live="polite"><Text size="sm">{status}</Text></div> : null}
      {!publications.isLoading && !publications.error && eligibleSites.length === 0 ? <Text size="sm" tone="muted">No disabled, prepared public or secret publication is ready for a hostname.</Text> : null}
      {selected ? (
        <form onSubmit={(event) => void submit(event)}>
          <Stack gap="sm">
            <SelectField
              id="bbx-admin-publish-hostname-site"
              label="Prepared publication"
              value={selected.pubId}
              onChange={setPubId}
              options={eligibleSites.map((site) => ({ value: site.pubId, label: `${site.title || site.name} (${site.pending?.requestedScope.tier ?? "site"})` }))}
            />
            {retrying
              ? <Text size="sm">Retrying the reserved hostname: <Text mono>{selected.assignedCustomHostname}</Text></Text>
              : <TextField id="bbx-admin-publish-hostname" label="Exact hostname" value={hostname} onChange={setHostname} required maxLength={253} helper="Enter a hostname such as www.example.org, without https:// or a path." />}
            <CheckboxField
              id="bbx-admin-publish-hostname-ack"
              label={retrying
                ? "I understand this retries Cloudflare attachment for the already-reserved hostname; it cannot be changed here."
                : "I understand Cloudflare will change DNS/certificate routing now, the disabled Worker will own this hostname, and detaching it in Cloudflare will not release it for reuse in Bee Box."}
              checked={acknowledged}
              onChange={setAcknowledged}
            />
            <Button id="bbx-admin-publish-hostname-assign" type="submit" intent="primary" loading={assign.isPending} loadingLabel={retrying ? "Retrying…" : "Assigning…"} disabled={!acknowledged || (!retrying && hostname.trim().length === 0)}>
              {retrying ? "Retry hostname attachment" : "Assign hostname"}
            </Button>
          </Stack>
        </form>
      ) : null}
      {(publications.data?.sites ?? []).filter((site) => site.assignedCustomHostname !== null).map((site) => <Hint key={site.pubId}>{site.title || site.name}: {site.assignedCustomHostname} — {site.customHostnameStatus === "pending" ? "Cloudflare attachment is not confirmed; publication stays disabled until this exact hostname is confirmed." : "assigned and confirmed; HTTPS may still be provisioning."} This page cannot detach or change it.</Hint>)}
    </Stack>
  );
}
