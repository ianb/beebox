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

function destinationLabels(site: Site | undefined, hostnameInput: string): { hostname: string; site: string } {
  return {
    hostname: site?.assignedCustomHostname || hostnameInput.trim() || "the entered hostname",
    site: site?.title || site?.name || "the selected publication",
  };
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
  const { hostname: hostLabel, site: destinationSite } = destinationLabels(selected, hostname);

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

  function changePublication(nextPubId: string) {
    setPubId(nextPubId);
    setAcknowledged(false);
  }

  function changeHostname(nextHostname: string) {
    setHostname(nextHostname);
    setAcknowledged(false);
  }

  return (
    <Stack gap="sm">
      <Stack gap="xs">
        <Heading level={3}>Assign a custom hostname</Heading>
        <Hint>Assign one exact hostname to an existing disabled public or secret site. A box member must approve the destination before enabling it.</Hint>
      </Stack>
      <div role="note"><Badge tone="warning">For {destinationSite} at {hostLabel}, every path will route to Bee Box. Bee Box checks for conflicting Worker Custom Domain assignments, but does not inspect existing DNS records or Workers Routes; review those before assigning. Cloudflare begins DNS and certificate changes immediately, even while the site is disabled. This hostname stays reserved to this publication; detaching it in Cloudflare does not release it for reuse in Bee Box.</Badge></div>
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
              onChange={changePublication}
              options={eligibleSites.map((site) => ({ value: site.pubId, label: `${site.title || site.name} (${site.pending?.requestedScope.tier ?? "site"})` }))}
            />
            {retrying
              ? <Text size="sm">Retrying the reserved hostname: <Text mono>{selected.assignedCustomHostname}</Text></Text>
              : <TextField id="bbx-admin-publish-hostname" label="Exact hostname" value={hostname} onChange={changeHostname} required maxLength={253} helper="Enter a hostname such as www.example.org, without https:// or a path." />}
            <CheckboxField
              id="bbx-admin-publish-hostname-ack"
              label={retrying
                ? `I understand this retries the reserved hostname ${hostLabel} for ${destinationSite}; all paths route to Bee Box and the hostname cannot be released here.`
                : `I checked existing DNS records and Workers Routes for ${hostLabel}; all paths will route to Bee Box, and this hostname cannot be released here.`}
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
