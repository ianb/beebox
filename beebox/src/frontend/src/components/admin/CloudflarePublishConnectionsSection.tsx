/** Global-owner management for server-held Cloudflare publication credentials. */

import { useState, type FormEvent } from "react";
import { useParams } from "@tanstack/react-router";
import { trpc, type RouterOutput } from "../../lib/trpc";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import { Card } from "../ui/Card";
import { ErrorText } from "../ui/ErrorText";
import { Heading } from "../ui/Heading";
import { Hint } from "../ui/Hint";
import { Row } from "../ui/Row";
import { Stack } from "../ui/Stack";
import { Text } from "../ui/Text";
import { TextField } from "../ui/fields";
import { ExternalLink } from "../ui/ExternalLink";
import { FriendlyDate } from "../ui/FriendlyDate";

type Connection = RouterOutput["cloudflarePublishConnections"]["list"][number];

export function CloudflarePublishConnectionsSection() {
  const { boxSlug } = useParams({ strict: false });
  const connections = trpc.cloudflarePublishConnections.list.useQuery();
  const utils = trpc.useUtils();
  const [name, setName] = useState("");
  const [accountId, setAccountId] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [rotateTarget, setRotateTarget] = useState<string | null>(null);
  const [revokeAcknowledged, setRevokeAcknowledged] = useState<Record<string, boolean>>({});
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = () => utils.cloudflarePublishConnections.list.invalidate();
  const save = trpc.cloudflarePublishConnections.save.useMutation({
    onSuccess: async () => {
      setApiToken("");
      setRotateTarget(null);
      setActionError(null);
      await refresh();
    },
    onError: (error) => setActionError(error.message),
  });
  const grant = trpc.cloudflarePublishConnections.grant.useMutation({ onSuccess: refresh, onError: (error) => setActionError(error.message) });
  const revokeGrant = trpc.cloudflarePublishConnections.revokeGrant.useMutation({ onSuccess: refresh, onError: (error) => setActionError(error.message) });
  const revoke = trpc.cloudflarePublishConnections.revoke.useMutation({
    onSuccess: async () => {
      setActionError(null);
      await refresh();
    },
    onError: (error) => setActionError(error.message),
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActionError(null);
    save.mutate({ name: name.trim(), accountId: accountId.trim(), apiToken });
  }

  if (connections.isLoading) {
    return <Card as="section" aria-label="Cloudflare publishing connections" shadow aria-busy><Hint>Loading Cloudflare connections…</Hint></Card>;
  }

  return (
    <Card as="section" aria-labelledby="bbx-admin-cloudflare-publish-heading" shadow>
      <Stack gap="md">
        <Stack gap="xs">
          <Heading level={2}><span id="bbx-admin-cloudflare-publish-heading">Cloudflare publishing</span></Heading>
          <Hint>These credentials stay on this host. A server-only grant lets this box provision its sites; the box agent cannot read the token.</Hint>
        </Stack>

        {connections.error ? <div role="alert"><ErrorText>{connections.error.message}</ErrorText></div> : null}
        {actionError ? <div role="alert"><ErrorText>{actionError}</ErrorText></div> : null}

        <ConnectionEditor
          name={name}
          accountId={accountId}
          apiToken={apiToken}
          rotateTarget={rotateTarget}
          pending={save.isPending}
          setName={setName}
          setAccountId={setAccountId}
          setApiToken={setApiToken}
          onSubmit={submit}
          onCancelRotation={() => { setRotateTarget(null); setApiToken(""); }}
        />

        <Stack gap="sm">
          <Heading level={3}>Saved connections</Heading>
          {connections.data?.length === 0 ? <Text size="sm" tone="muted">No Cloudflare publishing connection has been added.</Text> : null}
          {connections.data?.map((connection) => (
            <ConnectionCard
              key={connection.name}
              connection={connection}
              currentBox={boxSlug ?? ""}
              revokeAcknowledged={revokeAcknowledged[connection.name] === true}
              setRevokeAcknowledged={(checked) => setRevokeAcknowledged((state) => ({ ...state, [connection.name]: checked }))}
              pending={grant.isPending || revokeGrant.isPending || revoke.isPending}
              onRotate={() => {
                setName(connection.name);
                setAccountId(connection.accountId);
                setApiToken("");
                setRotateTarget(connection.name);
              }}
              onGrant={(targetBox) => { setActionError(null); grant.mutate({ name: connection.name, boxSlug: targetBox }); }}
              onRevokeGrant={(targetBox) => { setActionError(null); revokeGrant.mutate({ name: connection.name, boxSlug: targetBox }); }}
              onRevoke={() => { setActionError(null); revoke.mutate({ name: connection.name }); }}
            />
          ))}
        </Stack>
      </Stack>
    </Card>
  );
}

function ConnectionEditor({
  name,
  accountId,
  apiToken,
  rotateTarget,
  pending,
  setName,
  setAccountId,
  setApiToken,
  onSubmit,
  onCancelRotation,
}: {
  name: string;
  accountId: string;
  apiToken: string;
  rotateTarget: string | null;
  pending: boolean;
  setName: (value: string) => void;
  setAccountId: (value: string) => void;
  setApiToken: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancelRotation: () => void;
}) {
  return (
    <form onSubmit={onSubmit}>
      <Stack gap="sm">
        <Heading level={3}>{rotateTarget === null ? "Add a connection" : `Rotate ${rotateTarget}`}</Heading>
        <Hint>Saving checks that the token is active and can identify the selected account. It does not test publishing permissions; the first site setup checks those.</Hint>
        <TextField id="bbx-admin-cf-publish-name" label="Connection name" value={name} onChange={setName} required maxLength={40} pattern="[a-z][a-z0-9-]{0,39}" helper="Choose a Bee Box label, such as makers. Lowercase letters, digits, and hyphens; starts with a letter." />
        <TextField id="bbx-admin-cf-publish-account" label="Cloudflare account ID" value={accountId} onChange={setAccountId} required minLength={32} maxLength={32} pattern="[a-fA-F0-9]{32}" helper={<span>Find it in Cloudflare under <Text weight="medium">Workers & Pages → Account Details</Text>, or follow <ExternalLink id="bbx-admin-cf-publish-account-help" href="https://developers.cloudflare.com/fundamentals/account/find-account-and-zone-ids/" variant="inline">Cloudflare&apos;s account ID instructions</ExternalLink>.</span>} />
        <TextField id="bbx-admin-cf-publish-token" label="API token" type="password" autoComplete="new-password" value={apiToken} onChange={setApiToken} required maxLength={4096} />
        <TokenSetupGuidance />
        <Row gap="sm" wrap>
          <Button id="bbx-admin-cf-publish-save" type="submit" intent="primary" loading={pending} loadingLabel="Verifying…">{rotateTarget === null ? "Verify and save" : "Verify and rotate"}</Button>
          {rotateTarget !== null ? <Button id="bbx-admin-cf-publish-cancel-rotate" type="button" intent="secondary" onClick={onCancelRotation}>Cancel rotation</Button> : null}
        </Row>
      </Stack>
    </form>
  );
}

function TokenSetupGuidance() {
  return (
    <Stack gap="xs">
      <Text size="sm" weight="medium">Create a Cloudflare API token</Text>
      <ol className="list-decimal space-y-2 pl-5">
        <li><Text size="sm">Open <ExternalLink id="bbx-admin-cf-publish-token-create" href="https://dash.cloudflare.com/profile/api-tokens" variant="inline">My Profile → API Tokens</ExternalLink> and choose <Text weight="medium">Create Token → Create Custom Token</Text> for a user API token.</Text></li>
        <li><TokenPermissionList /></li>
        <li><Text size="sm">Create the token, copy its value once, and paste it here. Do not use the separate R2 S3 Access Key and Secret.</Text></li>
      </ol>
      <Text size="sm">For account resources, select only the Cloudflare account whose ID you entered above. Cloudflare&apos;s <ExternalLink id="bbx-admin-cf-publish-token-permissions" href="https://developers.cloudflare.com/fundamentals/api/reference/permissions/" variant="inline">permission reference</ExternalLink> has details. Before the first publication, make sure <ExternalLink id="bbx-admin-cf-publish-r2-setup" href="https://developers.cloudflare.com/r2/get-started/" variant="inline">R2 is enabled</ExternalLink> and a <ExternalLink id="bbx-admin-cf-publish-workers-dev" href="https://developers.cloudflare.com/workers/configuration/routing/workers-dev/" variant="inline">workers.dev account subdomain</ExternalLink> exists.</Text>
    </Stack>
  );
}

function TokenPermissionList() {
  return (
    <Stack gap="xs">
      <Text size="sm">Add these account permissions:</Text>
      <Text size="sm">Account Settings: <Text weight="medium">Read</Text></Text>
      <Text size="sm">Workers R2 Storage: <Text weight="medium">Edit</Text> (called <Text mono>Workers R2 Storage Write</Text> in the API permission reference)</Text>
      <Text size="sm">Workers Scripts: <Text weight="medium">Edit</Text> (called <Text mono>Workers Scripts Write</Text> in the API permission reference)</Text>
    </Stack>
  );
}

function ConnectionCard({
  connection,
  currentBox,
  revokeAcknowledged,
  setRevokeAcknowledged,
  pending,
  onRotate,
  onGrant,
  onRevokeGrant,
  onRevoke,
}: {
  connection: Connection;
  currentBox: string;
  revokeAcknowledged: boolean;
  setRevokeAcknowledged: (checked: boolean) => void;
  pending: boolean;
  onRotate: () => void;
  onGrant: (boxSlug: string) => void;
  onRevokeGrant: (boxSlug: string) => void;
  onRevoke: () => void;
}) {
  const currentBoxHasGrant = connection.grants.some((item) => item.boxSlug === currentBox);
  const tokenId = connection.tokenId === null ? "not retained" : connection.tokenId;

  return (
    <Card as="article" muted={connection.tokenStatus === "revoked"}>
      <Stack gap="sm">
        <Stack gap="xs">
          <Row gap="sm" wrap align="center"><Heading level={3}>{connection.name}</Heading><Badge tone={connection.tokenStatus === "active" ? "success" : "warning"}>{connection.tokenStatus}</Badge></Row>
          <Text size="sm">Account <Text mono>{connection.accountId}</Text> · {connection.credentialType} · token {tokenId}</Text>
          <Text size="sm" tone="muted">Verified: {connection.verifiedAt === null ? "not verified" : <FriendlyDate iso={connection.verifiedAt} />}</Text>
        </Stack>

        <Stack gap="xs">
          <Text size="sm" weight="medium">Verified capabilities</Text>
          <Row gap="xs" wrap>
            {Object.entries(connection.capabilities).map(([capability, state]) => <Capability key={capability} name={capability} state={state} />)}
          </Row>
        </Stack>

        <Stack gap="xs">
          <Text size="sm" weight="medium">Server grants</Text>
          {connection.grants.length === 0 ? <Text size="sm" tone="muted">No boxes can use this connection.</Text> : null}
          {connection.grants.map((item) => (
            <Row key={item.boxSlug} gap="sm" align="center" wrap>
              <Text size="sm"><Text mono>{item.boxSlug}</Text>{item.boxSlug === currentBox ? " (this box)" : ""}</Text>
              <Button id={`bbx-admin-cf-publish-revoke-grant-${connection.name}-${item.boxSlug}`} size="sm" intent="secondary" disabled={pending} onClick={() => onRevokeGrant(item.boxSlug)}>Remove grant</Button>
            </Row>
          ))}
          {currentBox !== "" && !currentBoxHasGrant && connection.tokenStatus === "active" ? (
            <Button id={`bbx-admin-cf-publish-grant-${connection.name}`} intent="secondary" disabled={pending} onClick={() => onGrant(currentBox)}>Grant server access to this box</Button>
          ) : null}
        </Stack>

        <Row gap="sm" wrap>
          <Button id={`bbx-admin-cf-publish-rotate-${connection.name}`} intent="secondary" disabled={pending} onClick={onRotate}>{connection.tokenStatus === "active" ? "Rotate token" : "Replace token"}</Button>
          {connection.tokenStatus === "active" ? <Button id={`bbx-admin-cf-publish-revoke-${connection.name}`} intent="destructive" disabled={pending || !revokeAcknowledged} onClick={onRevoke}>Revoke credential</Button> : null}
        </Row>
        {connection.tokenStatus === "active" ? (
          <Row gap="sm" align="start">
            <input
              id={`bbx-admin-cf-publish-revoke-ack-${connection.name}`}
              type="checkbox"
              checked={revokeAcknowledged}
              onChange={(event) => setRevokeAcknowledged(event.target.checked)}
            />
            <Text size="sm">Revoking removes this host&apos;s token but does not take live sites offline. I have disabled sites first, or understand I will need a working credential to do so.</Text>
          </Row>
        ) : null}
        <Hint>Cloudflare dashboard: <ExternalLink href={`https://dash.cloudflare.com/${connection.accountId}`} id={`bbx-admin-cf-publish-dashboard-${connection.name}`} variant="inline">open this account</ExternalLink></Hint>
      </Stack>
    </Card>
  );
}

function Capability({ name, state }: { name: string; state: "verified" | "unverified" }) {
  const label = {
    tokenForAccount: "account token",
    r2ObjectWrite: "R2 writes",
    workerDeploy: "Worker deploy",
    accessLive: "Access live",
  }[name] ?? name;
  return <Badge tone={state === "verified" ? "success" : "neutral"} size="sm">{label}: {state}</Badge>;
}
