/** The red "×" bubble pinned to a composer chip's top-right corner. */
export function RemoveBubble({ title, onClick }: { title: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-danger text-white flex items-center justify-center shadow hover:bg-danger-dark focus:outline-none focus:ring-2 focus:ring-danger"
      title={title}
    >
      <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    </button>
  );
}
