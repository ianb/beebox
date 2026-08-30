import { useEffect, useRef, useState } from "react";
import { useParams } from "@tanstack/react-router";
import { trpc } from "../../lib/trpc";
import { href } from "../../lib/routing";
import { Button } from "../ui/Button";
import { Dropdown } from "../ui/Dropdown";
import { MenuItem } from "../ui/dropdown-menu-item";
import { Text } from "../ui/Text";

function MoreIcon() {
  return <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5" aria-hidden="true"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>;
}

export function CardActions({ path, onTrashed }: { path: string; onTrashed?: (() => void) | undefined }) {
  const { boxSlug } = useParams({ strict: false });
  const [confirming, setConfirming] = useState(false);
  const refs = trpc.card.inboundRefs.useQuery({ path }, { enabled: confirming });
  const trash = trpc.card.trash.useMutation();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const priorFocusRef = useRef<HTMLElement | null>(null);
  const utils = trpc.useUtils();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!confirming || dialog === null) return;
    priorFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
      priorFocusRef.current?.focus();
      priorFocusRef.current = null;
    };
  }, [confirming]);

  const doTrash = async () => {
    try {
      await trash.mutateAsync({ path, allowDanglingRefs: referrers.length > 0 });
      await Promise.all([utils.card.get.invalidate({ path }), utils.card.inboundRefs.invalidate({ path })]);
      setConfirming(false);
      onTrashed?.();
    } catch (_error) {
      await refs.refetch();
    }
  };
  const referrers = refs.data?.referrers ?? [];

  return (
    <>
      <Dropdown
        trigger={({ toggle, ariaProps }) => (
          <Button icon={<MoreIcon />} label="Card actions" intent="ghost" size="sm" onClick={toggle} {...ariaProps} />
        )}
      >
        <MenuItem to={`${href(`/${boxSlug}/history`)}?path=${encodeURIComponent(path)}`}>View history</MenuItem>
        <MenuItem danger onClick={() => setConfirming(true)}>Move to Trash…</MenuItem>
      </Dropdown>
      {confirming ? (
        <dialog
          ref={dialogRef}
          aria-labelledby="trash-card-title"
          className="m-auto max-h-[calc(100%-3rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-lg bg-white p-5 shadow-xl backdrop:bg-black/60"
          onCancel={(event) => { event.preventDefault(); if (!trash.isPending) setConfirming(false); }}
        >
          <h2 id="trash-card-title" className="text-lg font-semibold text-warm-900">Move this card to Trash?</h2>
          <Text as="p" size="sm" tone="subtle" className="mt-2">The card remains recoverable from box Trash and git history.</Text>
          {refs.isLoading ? <Text as="p" size="sm" tone="muted" className="mt-4">Checking links…</Text> : null}
          {refs.error ? <Text as="p" size="sm" tone="danger" className="mt-4">Could not check links: {refs.error.message}</Text> : null}
          {referrers.length > 0 ? (
            <section className="mt-4">
              <Text as="h3" size="sm" weight="semibold">{referrers.length} file{referrers.length === 1 ? "" : "s"} link to this card</Text>
              <Text as="p" size="sm" tone="subtle" className="mt-1">Those links will stop working. They are not changed automatically.</Text>
              <ul className="mt-2 list-disc pl-5 text-sm text-warm-700">
                {referrers.map((referrer) => <li key={referrer.path}>{referrer.path} ({referrer.refs})</li>)}
              </ul>
            </section>
          ) : null}
          {trash.error ? <Text as="p" size="sm" tone="danger" className="mt-4">{trash.error.message}</Text> : null}
          <div className="mt-5 flex justify-end gap-2">
            <Button intent="secondary" onClick={() => setConfirming(false)} disabled={trash.isPending}>Cancel</Button>
            <Button intent="destructive" onClick={doTrash} loading={trash.isPending} disabled={refs.isLoading || refs.isError} loadingLabel="Moving…">Move to Trash</Button>
          </div>
        </dialog>
      ) : null}
    </>
  );
}
