import SwiftUI

/// One native control, pointed at.
///
/// The web draws an absolutely-positioned ring with `pointer-events: none`; this
/// is the same idea in the same spirit — a ring around the control's box, gone
/// on a timer, capturing nothing. No mask, no dimming, no modal layer: the
/// reason the plan rejected a guided-tour treatment is that it takes over the
/// screen, and the mask is the part that does that. The user must be able to tap
/// the control being pointed at *while* it is being pointed at, which is why
/// `allowsHitTesting(false)` is not a detail here.
///
/// The box arrives in **global** (window) coordinates, because that is what the
/// registry captured from each anchor's `GeometryReader`. The overlay converts
/// into its own space rather than assuming it starts at the window origin — a
/// safe-area inset or a presentation container would otherwise shift the ring by
/// exactly the inset.
struct NativeControlRingView: View {
    /// The control's box, in global coordinates.
    let frame: CGRect
    /// Called once the ring has had its time on screen.
    let onDone: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var expanded = false

    /// How long the ring stays. Matches the web's `ControlRing`, because the two
    /// are one gesture seen on two surfaces.
    private static let duration = Duration.seconds(2)
    /// Breathing room around the control, so the ring reads as *around* it.
    private static let inset: CGFloat = 6

    var body: some View {
        GeometryReader { proxy in
            let origin = proxy.frame(in: .global).origin
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(Color.accentColor, lineWidth: 3)
                .frame(
                    width: frame.width + Self.inset * 2,
                    height: frame.height + Self.inset * 2
                )
                .scaleEffect(expanded ? 1.06 : 1)
                .opacity(expanded ? 0.7 : 1)
                .position(x: frame.midX - origin.x, y: frame.midY - origin.y)
                .animation(pulse, value: expanded)
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        .onAppear {
            // Reduce Motion gets a plain static ring: the pulse is decoration,
            // and the thing being communicated is *where*, which a still ring
            // says just as well.
            if !reduceMotion {
                expanded = true
            }
        }
        .task {
            try? await Task.sleep(for: Self.duration)
            guard !Task.isCancelled else {
                return
            }
            onDone()
        }
    }

    private var pulse: Animation? {
        reduceMotion ? nil : .easeInOut(duration: 0.9).repeatForever(autoreverses: true)
    }
}
