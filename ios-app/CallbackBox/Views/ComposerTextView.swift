import SwiftUI
import UIKit

struct ComposerTextView: UIViewRepresentable {
    @Binding var text: String
    @Binding var selection: NSRangeValue
    @Binding var isFocused: Bool
    @Binding var height: CGFloat

    var minimumHeight: CGFloat = 58
    var maximumHeight: CGFloat = 138

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    func makeUIView(context: Context) -> UITextView {
        let textView = UITextView()
        textView.delegate = context.coordinator
        textView.backgroundColor = .clear
        textView.font = .preferredFont(forTextStyle: .body)
        textView.adjustsFontForContentSizeCategory = true
        textView.textContainerInset = UIEdgeInsets(top: 12, left: 11, bottom: 12, right: 11)
        textView.textContainer.lineFragmentPadding = 5
        textView.textContainer.widthTracksTextView = true
        textView.textContainer.lineBreakMode = .byWordWrapping
        textView.isScrollEnabled = false
        textView.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        textView.setContentHuggingPriority(.defaultLow, for: .horizontal)
        textView.accessibilityLabel = "Type a message"
        return textView
    }

    func updateUIView(_ textView: UITextView, context: Context) {
        context.coordinator.parent = self
        if textView.text != text {
            textView.text = text
        }
        let desiredSelection = selection.clamped(to: text)
        if textView.selectedRange != desiredSelection {
            textView.selectedRange = desiredSelection
        }
        if isFocused, textView.isFirstResponder == false {
            textView.becomeFirstResponder()
        } else if isFocused == false, textView.isFirstResponder {
            textView.resignFirstResponder()
        }
        context.coordinator.updateHeight(for: textView)
    }

    final class Coordinator: NSObject, UITextViewDelegate {
        var parent: ComposerTextView

        init(parent: ComposerTextView) {
            self.parent = parent
        }

        func textViewDidChange(_ textView: UITextView) {
            parent.text = textView.text
            updateHeight(for: textView)
        }

        func textViewDidChangeSelection(_ textView: UITextView) {
            let range = textView.selectedRange
            let value = NSRangeValue(location: range.location, length: range.length)
            if parent.selection != value {
                parent.selection = value
            }
        }

        func textViewDidBeginEditing(_ textView: UITextView) {
            parent.isFocused = true
        }

        func textViewDidEndEditing(_ textView: UITextView) {
            parent.isFocused = false
        }

        func updateHeight(for textView: UITextView) {
            guard textView.bounds.width > 0 else {
                return
            }
            let fittingSize = CGSize(width: textView.bounds.width, height: .greatestFiniteMagnitude)
            let measuredHeight = textView.sizeThatFits(fittingSize).height
            let newHeight = min(parent.maximumHeight, max(parent.minimumHeight, measuredHeight))
            textView.isScrollEnabled = measuredHeight > parent.maximumHeight
            if abs(parent.height - newHeight) > 0.5 {
                DispatchQueue.main.async { [weak self] in
                    guard let self, abs(self.parent.height - newHeight) > 0.5 else {
                        return
                    }
                    self.parent.height = newHeight
                }
            }
        }
    }
}
