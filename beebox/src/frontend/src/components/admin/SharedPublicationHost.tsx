/** Owner-controlled shared publication hostname for this box. */

import { useState, type FormEvent } from "react";
import { trpc, type RouterOutput } from "../../lib/trpc";
import { Button } from "../ui/Button";
import { ErrorText } from "../ui/ErrorText";
import { Heading } from "../ui/Heading";
import { Hint } from "../ui/Hint";
import { Stack } from "../ui/Stack";
import { Text } from "../ui/Text";
import { SelectField, TextField } from "../ui/fields";

type SharedHost = NonNullable<RouterOutput["publications"]["list"]["sharedHost"]>;

export function SharedPublicationHost() {
  const publications = trpc.publications.list.useQuery();
  const connections = trpc.publications.connections.useQuery();
  const utils = trpc.useUtils();
  const [connectionName, setConnectionName] = useState("");
  const [hostname, setHostname] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const sharedHost = publications.data?.sharedHost ?? null;
  const availableConnections = connections.data?.connections ?? [];
  const legacyHosts = (publications.data?.sites ?? []).filter((site) => site.assignedCustomHostname !== null);
  const configure = trpc.publications.configureSharedHost.useMutation({
    onSuccess: async (result) => {
      setMessage(result.status === "attached"
        ? `Shared host https://${result.hostname} is attached and ready.`
        : `Shared host ${result.hostname} is reserved; retry setup to finish attaching it.`);
      await utils.publications.list.invalidate();
      await utils.publications.connections.invalidate();
    },
    onError: (error) => setMessage(error.message),
  });

  function configureHost() {
    setMessage(null);
    configure.mutate({
      connectionName: (sharedHost?.connectionName ?? connectionName) || availableConnections[0] || "",
      hostname: sharedHost?.hostname ?? hostname.trim().toLowerCase(),
    });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    configureHost();
  }

  return (
    <Stack gap="sm">
      <Stack gap="xs">
        <Heading level={3}>Shared publication host</Heading>
        <Hint>Set up one hostname for this box. Every path on it routes to this box’s publications, which share the same origin and can access one another’s browser storage. A member still approves each publication path before its content is served.</Hint>
      </Stack>
      {publications.error ? <div role="alert"><ErrorText>{publications.error.message}</ErrorText></div> : null}
      {connections.error ? <div role="alert"><ErrorText>{connections.error.message}</ErrorText></div> : null}
      {publications.isLoading || connections.isLoading ? <Text size="sm" tone="muted">Loading shared-host status…</Text> : null}
      {sharedHost ? (
        <SharedPublicationHostSummary host={sharedHost} />
      ) : publications.error || connections.error ? null : availableConnections.length === 0 ? (
        <Hint>No active Cloudflare connection is granted to this box. Add a connection and grant it here before configuring a shared host.</Hint>
      ) : (
        <form onSubmit={submit}>
          <Stack gap="sm">
            <SelectField id="bbx-admin-publish-shared-connection" label="Cloudflare connection" value={connectionName || availableConnections[0] || ""} onChange={setConnectionName} options={availableConnections.map((name) => ({ value: name, label: name }))} required />
            <TextField id="bbx-admin-publish-shared-hostname" label="Hostname" value={hostname} onChange={setHostname} required maxLength={253} helper="Enter a hostname such as publish.example.org, without https:// or a path. Cloudflare starts DNS and HTTPS setup when you submit." />
            <Button id="bbx-admin-publish-shared-setup" type="submit" intent="primary" loading={configure.isPending} loadingLabel="Setting up…">Configure shared host</Button>
          </Stack>
        </form>
      )}
      {sharedHost ? <Button id="bbx-admin-publish-shared-retry" intent="secondary" loading={configure.isPending} onClick={configureHost}>{sharedHost.status === "attached" ? "Check and repair shared-host setup" : "Retry shared-host setup"}</Button> : null}
      {legacyHosts.length > 0 ? (
        <Stack gap="xs">
          <Heading level={3}>Existing per-publication hostnames</Heading>
          <Hint>These older assignments remain attached to their existing Workers. Shared-host setup does not move or remove them.</Hint>
          {legacyHosts.map((site) => <Text key={site.pubId} size="sm">{site.title || site.name}: <Text mono>{site.assignedCustomHostname}</Text> · {site.customHostnameStatus === "pending" ? "attachment pending" : "attached"}</Text>)}
        </Stack>
      ) : null}
      {message ? <div role={configure.isError ? "alert" : "status"} aria-live="polite">{configure.isError ? <ErrorText>{message}</ErrorText> : <Text size="sm">{message}</Text>}</div> : null}
    </Stack>
  );
}

export function SharedPublicationHostSummary({ host }: { host: SharedHost }) {
  return (
    <Stack gap="xs">
      <Text size="sm">Destination: <Text mono breakAll>https://{host.hostname}/</Text></Text>
      <Text size="sm">Connection: {host.connectionName} · state: {host.status}</Text>
      {host.status === "attached"
        ? <Text size="sm" tone="muted">The hostname is attached. New publications can request paths beneath it. Use the check and repair action if a Worker update or route needs recovery.</Text>
        : <Hint>Setup is incomplete. Retry to finish attaching this reserved hostname; the hostname and connection cannot be changed here.</Hint>}
    </Stack>
  );
}
