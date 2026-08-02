import { useState } from "react";
import { getApiBase } from "../../api";
import { trpc, type RouterOutput } from "../../lib/trpc";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { FriendlyDate } from "../ui/FriendlyDate";
import { Row } from "../ui/Row";
import { Stack } from "../ui/Stack";
import { Text } from "../ui/Text";
import { TextField } from "../ui/fields";

type UploaderToken = RouterOutput["scanTokens"]["list"][number];
type MintedToken = RouterOutput["scanTokens"]["create"];

const NAME_PATTERN = /^[\dA-Za-z][\w.-]{0,63}$/;

function boxBaseUrl(): string {
  const apiBase = getApiBase();
  const boxPath = apiBase.endsWith("/api") ? apiBase.slice(0, -"/api".length) : apiBase;
  return new URL(boxPath, window.location.origin).toString().replace(/\/$/, "");
}

function defaultName(): string {
  const today = new Date().toISOString().slice(0, 10);
  return `uploader-${today}`;
}

function configureCommand(name: string): string {
  return `bin/scan-uploader configure ${boxBaseUrl()} --name ${name} --folder <your-scan-folder>`;
}

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
        <Button
          intent="destructive"
          size="sm"
          loading={revokeMutation.isPending}
          onClick={() => revokeMutation.mutate({ name: uploader.name })}
        >
          Revoke
        </Button>
      ) : null}
    </Row>
  );
}

function InstallInstructions() {
  return (
    <details>
      <summary className="cursor-pointer text-sm font-medium text-warm-700 hover:text-warm-900">
        First-time setup on a new machine
      </summary>
      <Stack gap="xs" className="mt-2">
        <Text size="sm" tone="muted">
          On the machine connected to the scanner, one time:
        </Text>
        <code className="block max-w-full overflow-auto rounded bg-warm-100 px-2 py-1 text-xs text-warm-800 whitespace-pre">
          {"git clone <repo>\n" + "pnpm install --filter scan-uploader...  # from the repo root"}
        </code>
        <Text size="sm" tone="muted">
          Then mint a token below and run the configure command it shows (from the repo root —
          bin/scan-uploader runs the CLI straight from source, so a checkout always stays current).
          No checkout on that machine? Build once elsewhere (pnpm --filter scan-uploader build),
          copy the resulting scan-uploader/dist/scan-uploader.mjs, and run it there with plain node.
        </Text>
      </Stack>
    </details>
  );
}

export function ScanUploaderSection() {
  const listQuery = trpc.scanTokens.list.useQuery();
  const utils = trpc.useUtils();
  const createMutation = trpc.scanTokens.create.useMutation({
    onSuccess: () => {
      void utils.scanTokens.list.invalidate();
    },
  });
  const [name, setName] = useState(defaultName());
  const [minted, setMinted] = useState<MintedToken | null>(null);
  const [copyError, setCopyError] = useState(false);

  const nameError = name.length > 0 && !NAME_PATTERN.test(name)
    ? "Use letters, digits, underscore, dot, or hyphen, starting with a letter or digit (max 64 chars)."
    : undefined;

  const mint = async () => {
    if (nameError) return;
    const next = await createMutation.mutateAsync({ name });
    setMinted(next);
    setCopyError(false);
  };

  const copyToken = async () => {
    if (!minted) return;
    try {
      await navigator.clipboard.writeText(minted.token);
      setCopyError(false);
    } catch (e) {
      setCopyError(true);
      throw e;
    }
  };

  return (
    <Card as="section" aria-label="Scan uploaders" shadow className="mt-6">
      <Stack gap="md">
        <Stack gap="xs">
          <Text as="h2" size="lg" weight="semibold">
            Scan uploaders
          </Text>
          <Text size="sm" tone="muted">
            Mint a token for a machine running the scan uploader, then paste it into `configure`.
          </Text>
        </Stack>

        <Row gap="sm" wrap align="end">
          <TextField
            label="Token name"
            value={name}
            onChange={setName}
            error={nameError}
            className="w-64"
          />
          <Button
            intent="primary"
            loading={createMutation.isPending}
            loadingLabel="Minting..."
            disabled={nameError !== undefined}
            onClick={mint}
          >
            Mint token
          </Button>
        </Row>

        {createMutation.error ? (
          <Text size="sm" tone="danger">
            {createMutation.error.data?.code === "CONFLICT"
              ? `A token named "${name}" already exists — choose another name.`
              : createMutation.error.message}
          </Text>
        ) : null}

        {minted ? (
          <Stack gap="sm">
            <Text size="sm" tone="muted">
              This token is shown once — copy it now. It won't be shown again.
            </Text>
            <code className="block max-w-full overflow-auto rounded bg-warm-100 px-2 py-1 text-xs text-warm-800">
              {minted.token}
            </code>
            <Row gap="sm" wrap>
              <Button onClick={copyToken} flash={{ label: "Copied" }}>
                Copy token
              </Button>
              <Button onClick={() => setMinted(null)}>Done — hide token</Button>
            </Row>
            {copyError ? (
              <Text size="sm" tone="danger">
                Copy failed — select the token text manually.
              </Text>
            ) : null}
            <Stack gap="xs">
              <Text size="sm" tone="muted">Paste-ready setup command:</Text>
              <code className="block max-w-full overflow-auto rounded bg-warm-100 px-2 py-1 text-xs text-warm-800 whitespace-pre">
                {configureCommand(minted.name)}
              </code>
              <Text size="sm" tone="muted">then paste the token when prompted</Text>
            </Stack>
          </Stack>
        ) : null}

        <Stack gap="xs">
          <Text as="h3" size="sm" weight="semibold">Uploaders</Text>
          {listQuery.isLoading ? (
            <Text size="sm" tone="muted">Loading uploaders...</Text>
          ) : listQuery.error ? (
            <Text size="sm" tone="danger">{listQuery.error.message}</Text>
          ) : listQuery.data && listQuery.data.length > 0 ? (
            <div className="divide-y divide-warm-100">
              {listQuery.data.map((uploader) => (
                <UploaderRow key={uploader.name} uploader={uploader} />
              ))}
            </div>
          ) : (
            <Text size="sm" tone="muted">No uploaders yet.</Text>
          )}
        </Stack>

        <InstallInstructions />
      </Stack>
    </Card>
  );
}
