/**
 * Dismissible error banner shown between the device controls and capture
 * viewport, so it never covers settings needed to recover from the error.
 */

interface CaptureErrorBannerProps {
  includeControlIds?: boolean;
  message: string;
  onDismiss: () => void;
}

export function CaptureErrorBanner({ message, onDismiss, includeControlIds }: CaptureErrorBannerProps) {
  const hasControlIds = includeControlIds !== false;
  return (
    <div className="mx-4 my-2 bg-danger-dark/80 text-danger-100 text-sm px-3 py-2 rounded-lg">
      {message}
      <button id={hasControlIds ? "bbx-capture-error-dismiss" : undefined} data-bbx-does="dismisses the capture error message" onClick={onDismiss} className="float-right text-danger-light hover:text-white">&times;</button>
    </div>
  );
}
