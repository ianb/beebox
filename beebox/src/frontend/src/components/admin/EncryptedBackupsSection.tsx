import { useState, type FormEvent } from "react";
import { trpc, type RouterOutput } from "../../lib/trpc/client";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { ErrorText } from "../ui/ErrorText";
import { Hint } from "../ui/Hint";
import { Row } from "../ui/Row";
import { Stack } from "../ui/Stack";
import { Text } from "../ui/Text";
import { CheckboxField, TextField } from "../ui/fields/field";
import { FriendlyDate } from "../ui/FriendlyDate";
import { AdminSectionCard } from "./AdminSectionCard";

const DESCRIPTION = "Encrypted Restic snapshots of this box, separate from Git and git-annex copies.";

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function backupCommand({ boxRoot, boxSlug, installKind, operation }: { boxRoot: string; boxSlug: string; installKind: "unit-host" | "mac-app" | "docker" | "local"; operation: "run" | "status" }): string {
  if (installKind === "mac-app") return `"/Applications/Bee Box Desktop.app/Contents/MacOS/BeeBoxMac" backup ${operation}`;
  if (installKind === "docker") return `docker compose exec box bbx engine backup ${operation} /data/box`;
  if (installKind === "local") return `bbx engine backup ${operation} ${shellQuote(boxRoot)}`;
  const serviceUser = shellQuote(`bbx-${boxSlug}`);
  const script = `set -a; source /etc/beebox/box.env; set +a; exec bbx engine backup ${operation} "$1"`;
  return `sudo -u ${serviceUser} -H bash -c ${shellQuote(script)} backup-manual ${shellQuote(boxRoot)}`;
}

export function encryptedBackupStatusErrorMessage(code: string | undefined): string {
  return code === "FORBIDDEN"
    ? "Owner sign-in must be enabled for this box before an owner can configure encrypted backups."
    : "Could not read encrypted backup status.";
}

export function EncryptedBackupsSection() {
  const utils = trpc.useUtils();
  const query = trpc.admin.encryptedBackupStatus.useQuery();
  const configure = trpc.admin.configureEncryptedBackup.useMutation();
  const setSchedule = trpc.admin.updateEncryptedBackupSchedule.useMutation({
    onSettled: async () => utils.admin.encryptedBackupStatus.invalidate(),
  });
  const [repository, setRepository] = useState("");
  const [password, setPassword] = useState("");
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await configure.mutateAsync({ repository: repository.trim(), password });
      setPassword("");
      setRepository("");
      await utils.admin.encryptedBackupStatus.invalidate();
    } catch (_error) {
      setPassword("");
    }
  };

  const copyCommand = async (command: string) => {
    try {
      await navigator.clipboard.writeText(command);
      setCopyFailed(false);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (_error) {
      setCopied(false);
      setCopyFailed(true);
    }
  };

  return (
    <AdminSectionCard id="encrypted-backups" description={DESCRIPTION} busy={query.isLoading}>
      {query.isLoading ? <Hint>Checking encrypted backup status…</Hint> : null}
      {query.error ? <ErrorText>{encryptedBackupStatusErrorMessage(query.error.data?.code)}</ErrorText> : null}
      {query.data ? (
        <Stack gap="md">
          <Card background="warm" border="subtle" padding="sm">
            <Stack gap="xs">
              <Text size="sm" weight="semibold">Keep the recovery password somewhere safe</Text>
              <Text size="sm">It is stored on this host to run backups. Anyone who gets both the repository and this password can read the backups. Save a separate copy outside this machine; it cannot be recovered from Admin.</Text>
            </Stack>
          </Card>
          <Hint>S3 or SFTP provider credentials must already be available to the host before that destination can be used.</Hint>

          {!query.data.configured ? (
            <form onSubmit={(event) => void submit(event)}>
              <Stack gap="md">
                <TextField
                  id="bbx-admin-encrypted-backups-repository"
                  label="Repository"
                  value={repository}
                  onChange={setRepository}
                  required
                  autoComplete="url"
                  helper="Use a repository this host can reach, such as an S3 or SFTP destination."
                />
                <TextField
                  id="bbx-admin-encrypted-backups-password"
                  label="Recovery password"
                  type="text"
                  inputClassName="bbx-secret-value-mask"
                  value={password}
                  onChange={setPassword}
                  required
                  autoComplete="off"
                  spellCheck={false}
                  autoCapitalize="off"
                  helper="Write-only: Admin never reads this value back."
                />
                <Button id="bbx-admin-encrypted-backups-configure" className="self-start" intent="primary" type="submit" loading={configure.isPending} loadingLabel="Saving…">
                  Save destination
                </Button>
                {configure.error ? <div role="alert"><ErrorText>Could not configure encrypted backups. Check the repository and host credentials, then try again.</ErrorText></div> : null}
              </Stack>
            </form>
          ) : (
            <Stack gap="md">
              <div>
                <Row gap="sm" wrap><Text size="sm" weight="semibold">Destination</Text><Text size="sm" breakAll>{query.data.repository}</Text></Row>
                <Row gap="sm" wrap><Text size="sm" weight="semibold">Schedule</Text><Text size="sm">{query.data.schedule === "daily" ? "Daily" : "Manual only"}</Text></Row>
                {query.data.retention ? <Row gap="sm" wrap><Text size="sm" weight="semibold">Retention</Text><Text size="sm">{query.data.retention.daily} daily · {query.data.retention.weekly} weekly · {query.data.retention.monthly} monthly snapshots</Text></Row> : null}
              </div>

              <DailyBackupControl
                status={query.data}
                pending={setSchedule.isPending}
                error={setSchedule.error !== null}
                refreshing={query.isFetching}
                onChange={(schedule) => setSchedule.mutate({ schedule })}
                onRefresh={() => void query.refetch()}
              />

              <Stack gap="xs">
                <Text size="sm" weight="semibold">Latest verified snapshot</Text>
                {query.data.newestVerified ? (
                  <Text size="sm">Snapshot <Text as="span" mono size="sm">{query.data.newestVerified.snapshotId}</Text>, verified <FriendlyDate iso={query.data.newestVerified.verifiedAt} />.</Text>
                ) : <Text size="sm">No verified snapshot is recorded on this host yet. Use the host CLI status command below to inspect the repository.</Text>}
                {query.data.lastAttempt ? (
                  <>
                    <Text size="sm">
                      Last attempt {query.data.lastAttempt.outcome === "verified" ? "verified" : "failed"} <FriendlyDate iso={query.data.lastAttempt.completedAt} />.
                    </Text>
                    {query.data.lastAttempt.outcome === "failed" && query.data.lastAttempt.error ? <ErrorText>{query.data.lastAttempt.error}</ErrorText> : null}
                  </>
                ) : null}
                {query.data.maintenance === "running" ? <Hint>A backup is running.</Hint> : null}
                {query.data.maintenance === "interrupted" ? <ErrorText>The last backup was interrupted. Retry it from the host.</ErrorText> : null}
                <Button id="bbx-admin-encrypted-backups-refresh" className="self-start" intent="secondary" onClick={() => void query.refetch()} loading={query.isFetching} loadingLabel="Refreshing…">Refresh</Button>
              </Stack>

              <Card background="warm" border="subtle" padding="sm">
                <Stack gap="sm">
                  <Text size="sm" weight="semibold">Run a backup from the host</Text>
                  <Hint>Run the first backup manually with this command. Daily backups use the same CLI when enabled. S3 or SFTP provider credentials must already be available to this host.</Hint>
                  {query.data.boxRoot ? (
                    <>
                      <Text size="xs" tone="muted">Host command</Text>
                      <Text size="sm" mono breakAll>{backupCommand({ boxRoot: query.data.boxRoot, boxSlug: query.data.boxSlug, installKind: query.data.installKind, operation: "run" })}</Text>
                      {query.data.installKind === "docker" ? <Hint>Run this from the directory containing compose.yaml.</Hint> : null}
                      <Button id="bbx-admin-encrypted-backups-copy-command" className="self-start" intent="secondary" onClick={() => void copyCommand(backupCommand({ boxRoot: query.data.boxRoot, boxSlug: query.data.boxSlug, installKind: query.data.installKind, operation: "run" }))} flash={{ label: "Copied" }}>
                        {copied ? "Copied" : "Copy command"}
                      </Button>
                      {copyFailed ? <div role="alert"><ErrorText>Could not copy. Select and copy the command above.</ErrorText></div> : null}
                      {query.data.newestVerified === null ? <Text size="sm" mono breakAll>{backupCommand({ boxRoot: query.data.boxRoot, boxSlug: query.data.boxSlug, installKind: query.data.installKind, operation: "status" })}</Text> : null}
                    </>
                  ) : null}
                </Stack>
              </Card>
            </Stack>
          )}
        </Stack>
      ) : null}
    </AdminSectionCard>
  );
}

function DailyBackupControl({ status, pending, error, refreshing, onChange, onRefresh }: {
  status: RouterOutput["admin"]["encryptedBackupStatus"];
  pending: boolean;
  error: boolean;
  refreshing: boolean;
  onChange: (schedule: "daily" | "off") => void;
  onRefresh: () => void;
}) {
  const available = status.runnerStatus === "enabled" || status.runnerStatus === "running";
  const unitHost = status.installKind === "unit-host";
  return (
    <Stack gap="xs">
      <Text size="sm" weight="semibold">Unattended backups</Text>
      <CheckboxField
        id="bbx-admin-encrypted-backups-daily"
        label="Daily backups"
        checked={status.schedule === "daily"}
        disabled={pending}
        onChange={(checked) => onChange(checked ? "daily" : "off")}
        helper={unitHost ? "Uses this box's installed server timer." : "Runs while this box is open and catches up after it starts again."}
      />
      {!available ? (
        <div role="alert">
          <ErrorText>{unitHost ? "The server timer is unavailable. An operator must enable it before Daily can run." : "The automatic backup runner is unavailable. Restart the box service before enabling Daily."}</ErrorText>
          {unitHost ? <Text size="sm" mono breakAll>{`sudo systemctl enable --now ${shellQuote(`beebox-backup@${status.boxSlug}.timer`)}`}</Text> : null}
          <Button className="self-start" intent="secondary" onClick={onRefresh} loading={refreshing} loadingLabel="Checking…">Check again</Button>
        </div>
      ) : null}
      {status.schedule === "daily" && available ? <Hint>{unitHost ? "Server timer enabled." : "Automatic checks run while this box is open and catch up after restart."}</Hint> : null}
      {error ? <div role="alert"><ErrorText>Could not update the backup schedule.</ErrorText></div> : null}
    </Stack>
  );
}
