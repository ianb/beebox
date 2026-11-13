/** The "Show password" button inside a revealable password field. The name stays constant; `aria-pressed` carries the state. */
export function RevealButton({ id, revealed, onToggle }: { id: string; revealed: boolean; onToggle: () => void }) {
  return (
    <button
      id={id}
      type="button"
      aria-label="Show password"
      aria-pressed={revealed}
      onClick={onToggle}
      className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r text-warm-700 hover:text-warm-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
        <circle cx="12" cy="12" r="3" />
        {revealed ? <path strokeLinecap="round" d="M4 4l16 16" /> : null}
      </svg>
    </button>
  );
}
