import SwiftUI

struct PairBoxView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var store: PairedBoxStore
    @State private var label = "Local test box"
    @State private var urlString = "http://localhost:3210/main/test1"
    @State private var sessionID = ""
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("Box") {
                    TextField("Label", text: $label)
                    TextField("Base URL", text: $urlString)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                    TextField("Session ID", text: $sessionID)
                        .textInputAutocapitalization(.never)
                }

                if let errorMessage {
                    Section {
                        Text(errorMessage)
                            .foregroundStyle(.red)
                    }
                }

                if store.boxes.isEmpty == false {
                    Section("Paired Boxes") {
                        ForEach(store.boxes) { box in
                            VStack(alignment: .leading) {
                                Text(box.label)
                                Text(box.baseURL.absoluteString)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        .onDelete(perform: store.remove)
                    }
                }
            }
            .navigationTitle("Pair Box")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") {
                        dismiss()
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add", action: addBox)
                }
            }
        }
    }

    private func addBox() {
        guard label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false else {
            errorMessage = "Add a label for this box."
            return
        }
        guard let url = URL(string: urlString), url.scheme != nil, url.host != nil else {
            errorMessage = "Enter a full box URL, including http:// or https://."
            return
        }
        store.addManualBox(label: label, baseURL: url, sessionID: sessionID)
        dismiss()
    }
}

#Preview {
    PairBoxView()
        .environmentObject(PairedBoxStore())
}
