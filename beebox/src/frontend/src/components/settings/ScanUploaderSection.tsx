import { trpc, type RouterOutput } from "../../lib/trpc/client";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { FriendlyDate } from "../ui/FriendlyDate";
import { Row } from "../ui/Row";
import { Stack } from "../ui/Stack";
import { Text } from "../ui/Text";
import { ErrorText } from "../ui/ErrorText";
import { Hint } from "../ui/Hint";
import { Heading } from "../ui/Heading";

type UploaderToken = RouterOutput["scanTokens"]["list"][number];
function UploaderRow({ uploader }: { uploader: UploaderToken }) {
  const utils = trpc.useUtils();
  const revokeMutation = trpc.scanTokens.revoke.useMutation({
    onSuccess: () => {
      void utils.scanTokens.list.invalidate();
    },
  });
  return (
    <Row justify="between" align="center" className="py-2">
      <Text as="div">
        <Text weight="medium">{uploader.name}</Text>{" "}
        <Text size="xs" tone="muted" className="ml-1">
          Created <FriendlyDate iso={uploader.createdAt} mode="date" />
          {uploader.lastUsedAt ? (
            <>
              {" - "}
              <span title="Stamped by any authenticated request, including setup verification — not necessarily an upload.">
                last request <FriendlyDate iso={uploader.lastUsedAt} />
              </span>
            </>
          ) : null}
        </Text>
        {uploader.revoked ? <Badge tone="neutral" size="sm" className="ml-2">revoked</Badge> : null}
      </Text>
      {!uploader.revoked ? (
        <Stack gap="xs" align="end">
          <Button
            intent="destructive"
            size="sm"
            loading={revokeMutation.isPending}
            onClick={() => revokeMutation.mutate({ name: uploader.name })}
          >
            Revoke
          </Button>
          {revokeMutation.error ? <ErrorText>{revokeMutation.error.message}</ErrorText> : null}
        </Stack>
      ) : null}
    </Row>
  );
}

export function ScanUploaderSection() {
  const listQuery = trpc.scanTokens.list.useQuery();

  return (
    <Card as="section" aria-label="Scan uploaders" shadow material>
      <Stack gap="md">
        <Stack gap="xs">
          <Heading level={2}>
            Scan uploaders
          </Heading>
          <Hint>
            Credentials that let a Mac send files to this box. Bee Box Desktop creates one when you add a watched folder. Revoke one to stop it working.
          </Hint>
        </Stack>

        {listQuery.isLoading ? (
          <Hint>Loading uploaders...</Hint>
        ) : listQuery.error ? (
          <ErrorText>{listQuery.error.message}</ErrorText>
        ) : listQuery.data && listQuery.data.length > 0 ? (
          <div className="divide-y divide-warm-100">
            {listQuery.data.map((uploader) => (
              <UploaderRow key={uploader.name} uploader={uploader} />
            ))}
          </div>
        ) : (
          <Hint>No uploaders yet.</Hint>
        )}
      </Stack>
    </Card>
  );
}
