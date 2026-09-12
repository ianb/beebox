import PhotosUI
import SwiftUI
import UIKit

struct ComposerActionsView: View {
    @EnvironmentObject private var store: PairedBoxStore
    @Binding var selectedPhotoItems: [PhotosPickerItem]
    var canCapture: Bool
    var canTakePhoto: Bool
    var canPasteImage: Bool
    var locationSharingEnabled: Bool
    var onCapture: () -> Void
    var onTakePhoto: () -> Void
    var onPasteImage: () -> Void
    var onChooseFile: () -> Void
    var onScreenshot: () -> Void
    var onToggleLocationSharing: () -> Void
    var onPairBox: () -> Void
    var onDismiss: () -> Void

    var body: some View {
        NavigationStack {
            List {
                Section("Capture") {
                    Button(action: onCapture) {
                        Label("Capture", systemImage: "viewfinder")
                    }
                    .disabled(canCapture == false)
                    .controlAnchor(
                        "bbx-composer-capture",
                        label: "Capture",
                        does: "opens the capture screen — record photos, audio or video into this chat",
                        disabled: canCapture == false
                    )

                    if canCapture == false {
                        Text("Send a message first")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                Section("Add") {
                    Button(action: onTakePhoto) {
                        Label("Take Photo", systemImage: "camera")
                    }
                    .disabled(canTakePhoto == false)

                    PhotosPicker(
                        selection: $selectedPhotoItems,
                        maxSelectionCount: 0,
                        matching: .images
                    ) {
                        Label("Choose Photos", systemImage: "photo.on.rectangle")
                    }

                    Button(action: onPasteImage) {
                        Label("Paste Image", systemImage: "doc.on.clipboard")
                    }
                    .disabled(canPasteImage == false)

                    Button(action: onChooseFile) {
                        Label("Choose File", systemImage: "doc")
                    }

                    Button(action: onScreenshot) {
                        Label("Screenshot", systemImage: "rectangle.dashed.badge.record")
                    }

                    Button(action: onToggleLocationSharing) {
                        HStack {
                            Label(
                                locationSharingEnabled ? "Sharing Location" : "Share Location",
                                systemImage: locationSharingEnabled ? "location.fill" : "location"
                            )
                            if locationSharingEnabled {
                                Spacer()
                                Image(systemName: "checkmark")
                            }
                        }
                    }
                }

                Section("Boxes") {
                    if store.boxes.isEmpty == false {
                        ForEach(store.boxes) { box in
                            Button {
                                store.select(box)
                                onDismiss()
                            } label: {
                                HStack {
                                    Text(box.label)
                                    Spacer()
                                    if box.requiresDeviceUnlock {
                                        Image(systemName: "lock.fill")
                                    }
                                    if box.id == store.selectedBox?.id {
                                        Image(systemName: "checkmark")
                                    }
                                }
                            }
                        }
                    }
                    Button(action: onPairBox) {
                        Label("Pair or Manage Boxes", systemImage: "rectangle.stack.badge.plus")
                    }
                }
            }
            .navigationTitle("Add")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    // A checkmark, matching the rows below it — this sheet
                    // already marks the selected box and active location
                    // sharing with one. A plain-text bar button is also what
                    // Accessibility's Button Shapes underlines, which is how
                    // "Done, underlined" looked to the boxholder.
                    Button(action: onDismiss) {
                        Label("Done", systemImage: "checkmark")
                            .labelStyle(.iconOnly)
                    }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .onChange(of: selectedPhotoItems) { _, items in
            if items.isEmpty == false {
                onDismiss()
            }
        }
    }
}

struct CameraImagePicker: UIViewControllerRepresentable {
    var onImage: (UIImage) -> Void
    var onCancel: () -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onImage: onImage, onCancel: onCancel)
    }

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}

    final class Coordinator: NSObject, UINavigationControllerDelegate, UIImagePickerControllerDelegate {
        var onImage: (UIImage) -> Void
        var onCancel: () -> Void

        init(onImage: @escaping (UIImage) -> Void, onCancel: @escaping () -> Void) {
            self.onImage = onImage
            self.onCancel = onCancel
        }

        func imagePickerController(
            _ picker: UIImagePickerController,
            didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
        ) {
            guard let image = info[.originalImage] as? UIImage else {
                onCancel()
                return
            }
            onImage(image)
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            onCancel()
        }
    }
}
