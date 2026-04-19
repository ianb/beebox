/**
 * Activities page — list all registered activity types, show the existing
 * instances of each, and offer a form to create a new instance.
 *
 * No chat UI here yet — the chat page for an activity instance is a
 * follow-up.
 */

import { useState } from "react";
import { trpc } from "../lib/trpc";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Column } from "../components/ui/Column";
import { Row } from "../components/ui/Row";
import { Stack } from "../components/ui/Stack";
import { Text } from "../components/ui/Text";
import { TextField } from "../components/ui/fields";
import { Badge } from "../components/ui/Badge";

export function ActivitiesPage() {
  const { data: types, isLoading } = trpc.activities.listTypes.useQuery();

  if (isLoading) {
    return <Text as="div" tone="subtle" className="p-8">Loading...</Text>;
  }

  return (
    <Column overflow="auto" className="h-full">
      <Stack gap="lg" className="max-w-2xl mx-auto py-8 px-4">
        <Text as="h1" size="2xl" weight="bold">Activities</Text>
        <Text as="p" tone="subtle">
          Reusable chat shapes — each activity has one or more modes that
          frame the conversation differently.
        </Text>

        {types === undefined || types.length === 0 ? (
          <Text as="p" tone="subtle">No activities registered.</Text>
        ) : (
          <Stack gap="lg">
            {types.map((t) => (
              <ActivityTypeCard key={t.type} type={t} />
            ))}
          </Stack>
        )}
      </Stack>
    </Column>
  );
}

function ActivityTypeCard({
  type,
}: {
  type: { type: string; title: string; description: string; singleton: boolean };
}) {
  const utils = trpc.useUtils();
  const { data: instances, isLoading } = trpc.activities.listInstances.useQuery({ type: type.type });
  const [creating, setCreating] = useState(false);

  const hasInstances = instances !== undefined && instances.length > 0;
  const canCreate = !type.singleton || !hasInstances;

  return (
    <Card>
      <Stack gap="md">
        <TypeHeader type={type} canCreate={canCreate && !creating ? true : false} onCreate={() => setCreating(true)} />

        {creating ? (
          <NewInstanceForm
            type={type}
            onCancel={() => setCreating(false)}
            onCreated={() => {
              setCreating(false);
              void utils.activities.listInstances.invalidate({ type: type.type });
            }}
          />
        ) : null}

        {isLoading ? (
          <Text tone="subtle" size="sm">Loading instances…</Text>
        ) : instances !== undefined && instances.length > 0 ? (
          <InstanceList type={type.type} instances={instances} />
        ) : (
          <Text tone="subtle" size="sm">No instances yet.</Text>
        )}
      </Stack>
    </Card>
  );
}

function TypeHeader({
  type,
  canCreate,
  onCreate,
}: {
  type: { title: string; description: string; singleton: boolean };
  canCreate: boolean;
  onCreate: () => void;
}) {
  return (
    <Row justify="between" align="center" wrap>
      <Stack gap="xs">
        <Text size="lg" weight="bold">
          {type.title}{type.singleton ? <> <Badge tone="neutral" size="sm">singleton</Badge></> : null}
        </Text>
        <Text tone="subtle" size="sm">{type.description}</Text>
      </Stack>
      {canCreate ? (
        <Button intent="primary" onClick={onCreate}>New instance</Button>
      ) : null}
    </Row>
  );
}

function InstanceList({
  type,
  instances,
}: {
  type: string;
  instances: Array<{ name: string; displayName: string; createdAt: string }>;
}) {
  return (
    <Stack gap="xs">
      {instances.map((i) => (
        <Row key={i.name} justify="between" align="center" className="py-1">
          <Stack gap="none">
            <Text weight="medium">{i.displayName}</Text>
            <Text tone="subtle" size="xs" mono>
              {type}/{i.name}
            </Text>
          </Stack>
          <Text tone="subtle" size="xs">
            created {formatRelative(i.createdAt)}
          </Text>
        </Row>
      ))}
    </Stack>
  );
}

function NewInstanceForm({
  type,
  onCancel,
  onCreated,
}: {
  type: { type: string; title: string };
  onCancel: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const createMutation = trpc.activities.create.useMutation();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const trimmedName = name.trim();
    const trimmedDisplay = displayName.trim();
    if (trimmedName === "") {
      setError("Name is required");
      return;
    }
    try {
      await createMutation.mutateAsync({
        type: type.type,
        name: trimmedName,
        displayName: trimmedDisplay === "" ? trimmedName : trimmedDisplay,
      });
      setName("");
      setDisplayName("");
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <Card muted>
        <Stack gap="sm">
          <Text size="sm" weight="medium">New {type.title} instance</Text>
          <TextField
            label="Name"
            value={name}
            onChange={setName}
            placeholder="spanish-practice"
            helper="Used as a directory name: a-z, 0-9, - and _"
            pattern="^[a-z0-9][a-z0-9_-]*$"
            required
            autoFocus
          />
          <TextField
            label="Display name"
            value={displayName}
            onChange={setDisplayName}
            placeholder="(defaults to name)"
          />
          {error !== null ? (
            <Text tone="danger" size="sm">{error}</Text>
          ) : null}
          <Row gap="sm" justify="end">
            <Button intent="secondary" onClick={onCancel}>Cancel</Button>
            <Button type="submit" intent="primary" loading={createMutation.isPending}>
              Create
            </Button>
          </Row>
        </Stack>
      </Card>
    </form>
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const deltaSec = Math.round((now - then) / 1000);
  if (deltaSec < 60) return "just now";
  const deltaMin = Math.round(deltaSec / 60);
  if (deltaMin < 60) return `${deltaMin}m ago`;
  const deltaHr = Math.round(deltaMin / 60);
  if (deltaHr < 24) return `${deltaHr}h ago`;
  const deltaDay = Math.round(deltaHr / 24);
  return `${deltaDay}d ago`;
}
