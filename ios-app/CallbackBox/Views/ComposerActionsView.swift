import PhotosUI
import SwiftUI
import UIKit

struct ComposerActionsView: View {
    @EnvironmentObject private var store: PairedBoxStore
    @Binding var selectedPhotoItems: [PhotosPickerItem]
    var canTakePhoto: Bool
    var onTakePhoto: () -> Void
    var onShareLocation: () -> Void
    var onPairBox: () -> Void
    var onRemoveBox: (PairedBox) -> Void
    var onDismiss: () -> Void

    var body: some View {
        NavigationStack {
            List {
                Section("Add") {
                    Button(action: onTakePhoto) {
                        Label("Take Photo", systemImage: "camera")
                    }
                    .disabled(canTakePhoto == false)

                    PhotosPicker(
                        selection: $selectedPhotoItems,
                        maxSelectionCount: 4,
                        matching: .images
                    ) {
                        Label("Choose Photos", systemImage: "photo.on.rectangle")
                    }

                    Button(action: onShareLocation) {
                        Label("Share Location", systemImage: "location")
                    }
                }

                if store.boxes.isEmpty == false {
                    Section("Boxes") {
                        ForEach(store.boxes) { box in
                            Button {
                                store.select(box)
                                onDismiss()
                            } label: {
                                HStack {
                                    Text(box.label)
                                    Spacer()
                                    if box.id == store.selectedBox?.id {
                                        Image(systemName: "checkmark")
                                    }
                                }
                            }
                        }
                    }
                }

                Section("Settings") {
                    Button(action: onPairBox) {
                        Label("Pair or Manage Boxes", systemImage: "rectangle.stack.badge.plus")
                    }
                    if let selectedBox = store.selectedBox {
                        Button(role: .destructive) {
                            onRemoveBox(selectedBox)
                        } label: {
                            Label("Remove Current Box", systemImage: "trash")
                        }
                    }
                }
            }
            .navigationTitle("Add & Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done", action: onDismiss)
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
