/** The token-creation walkthrough inside the Cloudflare add-connection form. */

import { Stack } from "../../ui/Stack";
import { Text } from "../../ui/Text";
import { ExternalLink } from "../../ui/ExternalLink";

export function TokenSetupGuidance() {
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
