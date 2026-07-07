import SwiftUI

struct PairBoxView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var store: PairedBoxStore
    @State private var label = "Local test box"
    @State private var urlString = "http://localhost:3210/main/test1"
    @State private var sessionID = ""
    @State private var errorMessage: String?
    @State private var showingScanner = false
    @State private var pairingInProgress = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Button {
                        showingScanner = true
                    } label: {
                        Label("Scan Pairing QR", systemImage: "qrcode.viewfinder")
                    }
                    .disabled(pairingInProgress)
                }

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
                            HStack(alignment: .center) {
                                VStack(alignment: .leading) {
                                    Text(box.label)
                                    Text(box.baseURL.absoluteString)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                    Text(box.authToken == nil ? "No mobile token" : "Mobile token saved")
                                        .font(.caption2)
                                        .foregroundStyle(box.authToken == nil ? .orange : .secondary)
                                }
                                Spacer()
                                Button("Remove", role: .destructive) {
                                    store.remove(box)
                                }
                                .buttonStyle(.borderless)
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
                        .disabled(pairingInProgress)
                }
            }
            .sheet(isPresented: $showingScanner) {
                NavigationStack {
                    QRScannerView { code in
                        showingScanner = false
                        pairScannedCode(code)
                    } onCancel: {
                        showingScanner = false
                    }
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

    private func pairScannedCode(_ code: String) {
        guard let url = URL(string: code) else {
            errorMessage = "The QR code did not contain a pairing link."
            return
        }
        pairingInProgress = true
        errorMessage = nil
        Task {
            let paired = await store.pair(from: url)
            pairingInProgress = false
            if paired {
                dismiss()
            } else {
                errorMessage = "Pairing failed. Create a fresh QR code and try again."
            }
        }
    }
}

#Preview {
    PairBoxView()
        .environmentObject(PairedBoxStore())
}
