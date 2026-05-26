/**
 * Dismissible error banner shown over the capture viewport. Positioned
 * absolutely at the top so it overlays the camera view without pushing it.
 */

interface CaptureErrorBannerProps {
  message: string;
  onDismiss: () => void;
}

export function CaptureErrorBanner({ message, onDismiss }: CaptureErrorBannerProps) {
  return (
    <div className="absolute top-14 left-4 right-4 bg-danger-dark/80 text-danger-100 text-sm px-3 py-2 rounded-lg z-20">
      {message}
      <button onClick={onDismiss} className="float-right text-danger-light hover:text-white">&times;</button>
    </div>
  );
}
