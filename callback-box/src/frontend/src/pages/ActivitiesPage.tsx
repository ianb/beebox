/**
 * Activities page — list all registered activity types, show the existing
 * instances of each, and offer a form to create a new instance.
 *
 * No chat UI here yet — the chat page for an activity instance is a
 * follow-up.
 */

import { useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { trpc } from "../lib/trpc";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Column } from "../components/ui/Column";
import { Row } from "../components/ui/Row";
import { Stack } from "../components/ui/Stack";
import { Text } from "../components/ui/Text";
import { TextField } from "../components/ui/fields";
import { Badge } from "../components/ui/Badge";
import { slugify } from "../../../lib/filename";

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
        <Text as="div" size="lg" weight="bold">
          {type.title}{type.singleton ? <> <Badge tone="neutral" size="sm">singleton</Badge></> : null}
        </Text>
        <Text as="div" tone="subtle" size="sm">{type.description}</Text>
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
  const { boxSlug } = useParams({ strict: false });
  return (
    <Stack gap="xs">
      {instances.map((i) => (
        <Link
          key={i.name}
          to="/$boxSlug/activities/$type/$instance"
          params={{ boxSlug: boxSlug !== undefined ? boxSlug : "", type, instance: i.name }}
        >
          <Row justify="between" align="center" className="py-1">
            <Stack gap="none">
              <Text as="div" weight="medium">{i.displayName}</Text>
              <Text as="div" tone="subtle" size="xs" mono>
                {type}/{i.name}
              </Text>
            </Stack>
            <Text tone="subtle" size="xs">
              created {formatRelative(i.createdAt)}
            </Text>
          </Row>
        </Link>
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
  const [error, setError] = useState<string | null>(null);
  const createMutation = trpc.activities.create.useMutation();

  const trimmed = name.trim();
  const slug = slugify(trimmed);
  const helper = slug === ""
    ? "Enter a name — it will become a directory like spanish-practice."
    : `Directory: ${slug}`;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (trimmed === "") {
      setError("Name is required");
      return;
    }
    if (slug === "") {
      setError("Name must contain letters or numbers");
      return;
    }
    try {
      await createMutation.mutateAsync({
        type: type.type,
        name: slug,
        displayName: trimmed,
      });
      setName("");
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <Card muted>
        <Stack gap="sm">
          <Text as="div" size="sm" weight="medium">New {type.title} instance</Text>
          <TextField
            label="Name"
            value={name}
            onChange={setName}
            placeholder="Spanish practice"
            helper={helper}
            required
            autoFocus
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
