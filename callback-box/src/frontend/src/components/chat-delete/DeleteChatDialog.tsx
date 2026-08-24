import { useEffect, useRef, useState, type ReactNode } from "react";
import { trpc, type RouterOutput } from "../../lib/trpc";
import { Button } from "../ui/Button";

type DeleteResult = RouterOutput["chat"]["deleteSession"];

export interface DeleteChatDialogProps {
  open: boolean;
  sessionId: string;
  label: string | null;
  huskPath?: string | undefined;
  onClose: () => void;
  onResult?: ((result: DeleteResult) => void) | undefined;
}

export function DeleteChatDialog(props: DeleteChatDialogProps) {
  const { open, sessionId, label, huskPath, onClose, onResult } = props;
  const [result, setResult] = useState<DeleteResult | null>(null);
  const utils = trpc.useUtils();
  const mutation = trpc.chat.deleteSession.useMutation();
  const pendingRef = useRef(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const priorFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    pendingRef.current = mutation.isPending;
  }, [mutation.isPending]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || dialog === null) return;
    setResult(null);
    priorFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
      priorFocusRef.current?.focus();
      priorFocusRef.current = null;
    };
  }, [open]);

  if (!open) return null;
  const target = label ?? `Chat ${sessionId.slice(0, 8)}`;
  const cleanup = result?.status === "cleanup-required" ? result : null;
  const cleanupMessage =
    cleanup?.retry === "commit-trash"
      ? "The transcript is gone and the chat card is in Trash, but its git commit is still pending. Retry cleanup to commit the move."
      : cleanup?.retry === "trash-husk"
        ? "The transcript is gone, but the chat card could not be fully moved to Trash. Retry cleanup to finish the card move."
        : cleanup?.storage === "present"
          ? "The transcript remains on this machine because deletion did not complete. Retry cleanup to try again."
          : "The transcript was only partly removed. Retry cleanup to remove the remaining local session data.";

  const remove = async (): Promise<void> => {
    const next = await mutation.mutateAsync({ sessionId });
    setResult(next);
    await Promise.all([
      utils.chat.sessions.invalidate(),
      utils.chat.byLandmark.invalidate(),
      // Both chat-grouped surfaces: the pickers' full payload and the app bar's
      // lean counts. A deleted chat that still counted toward a landmark's
      // fresh badge is exactly the kind of ghost this dialog exists to remove.
      utils.chat.placeMenu.invalidate(),
      utils.chat.bootstrap.invalidate(),
      utils.chat.sessionAvailability.invalidate({ sessionId }),
      ...(huskPath === undefined ? [] : [utils.card.get.invalidate({ path: huskPath })]),
    ]);
    onResult?.(next);
    if (next.status === "deleted") onClose();
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="delete-chat-title"
      className="m-auto max-h-[calc(100%-3rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-lg bg-white p-5 shadow-xl backdrop:bg-black/60"
      onCancel={(event) => {
        event.preventDefault();
        if (!pendingRef.current) onCloseRef.current();
      }}
    >
        <h2 id="delete-chat-title" className="text-lg font-semibold text-warm-900">
          Delete this conversation?
        </h2>
        <p className="mt-2 text-sm text-warm-700">The resumable conversation on this machine will be permanently deleted. This cannot be undone.</p>
        <p className="mt-2 truncate text-sm font-medium text-warm-900" title={target}>
          {target}
        </p>

        <section className="mt-4 text-sm text-warm-700">
          <h3 className="font-semibold text-warm-900">Removed</h3>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            <li>The transcript and its subagent/session sidecars on this machine.</li>
            <li>The active chat listing; its card moves to box Trash and remains git-recoverable.</li>
            <li>Pending reminders linked to this conversation.</li>
          </ul>
        </section>

        <section className="mt-4 text-sm text-warm-700">
          <h3 className="font-semibold text-warm-900">Stays</h3>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            <li>Cards, files, memories, commits, and other effects created by the conversation.</li>
            <li>Transcript copies on other machines.</li>
            <li>Claude Code prompt history, checkpoints, debug data, and other application caches.</li>
            <li>Anthropic API data governed by Anthropic&apos;s retention policy.</li>
          </ul>
          <p className="mt-2 space-x-3">
            <a id="cb-chat-delete-docs-local" className="text-info-dark underline" href="https://code.claude.com/docs/en/claude-directory" target="_blank" rel="noreferrer">
              Claude local data
            </a>
            <a id="cb-chat-delete-docs-retention" className="text-info-dark underline" href="https://platform.claude.com/docs/en/manage-claude/api-and-data-retention" target="_blank" rel="noreferrer">
              Anthropic retention
            </a>
          </p>
        </section>

        {mutation.error ? (
          <p className="mt-4 rounded border border-danger-light bg-danger-50 p-2 text-sm text-danger-dark" role="alert">
            {mutation.error.message}
          </p>
        ) : null}
        {cleanup ? (
          <p className="mt-4 rounded border border-warning bg-warning/10 p-2 text-sm text-warm-800" role="alert">
            {cleanupMessage}
          </p>
        ) : null}

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button id="cb-chat-delete-cancel" autoFocus intent="secondary" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button id="cb-chat-delete-confirm" intent="destructive" onClick={remove} loading={mutation.isPending} loadingLabel="Deleting…">
            {cleanup ? "Retry cleanup" : "Delete permanently"}
          </Button>
        </div>
    </dialog>
  );
}

export function DeleteChatAction(props: {
  sessionId: string;
  label: string | null;
  huskPath?: string | undefined;
  className: string;
  children: ReactNode;
  onResult?: ((result: DeleteResult) => void) | undefined;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={triggerRef} type="button" className={props.className} onClick={() => setOpen(true)}>
        {props.children}
      </button>
      <DeleteChatDialog
        open={open}
        sessionId={props.sessionId}
        label={props.label}
        huskPath={props.huskPath}
        onClose={() => {
          setOpen(false);
          triggerRef.current?.focus();
        }}
        onResult={props.onResult}
      />
    </>
  );
}
