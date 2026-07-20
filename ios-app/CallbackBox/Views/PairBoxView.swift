import SwiftUI

struct PairBoxView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var store: PairedBoxStore
    @EnvironmentObject private var boxLockManager: BoxLockManager
    @State private var label = "Local test box"
    @State private var urlString = "http://localhost:3210/main/test1"
    @State private var sessionID = ""
    @State private var errorMessage: String?
    @State private var showingScanner = false
    @State private var pairingInProgress = false
    @State private var authenticatingLockBoxID: PairedBox.ID?
    @State private var pendingDisableBox: PairedBox?

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
                    Button {
                        addBox()
                    } label: {
                        Label("Add Manual Box", systemImage: "plus")
                    }
                    .disabled(pairingInProgress)
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
                            VStack(alignment: .leading, spacing: 10) {
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

                                Toggle(
                                    "Require Device Unlock",
                                    isOn: lockBinding(for: box)
                                )
                                .disabled(authenticatingLockBoxID != nil)
                                if authenticatingLockBoxID == box.id {
                                    ProgressView("Authenticating…")
                                        .font(.caption)
                                }
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
            .alert("No Device Passcode", isPresented: showingDisableWithoutPasscode) {
                Button("Keep Lock", role: .cancel) {
                    pendingDisableBox = nil
                }
                Button("Disable Lock Anyway", role: .destructive) {
                    if let pendingDisableBox {
                        store.setRequiresDeviceUnlock(false, for: pendingDisableBox)
                    }
                    pendingDisableBox = nil
                }
            } message: {
                Text("This device cannot authenticate you because it has no passcode. You can still remove the local lock.")
            }
        }
    }

    private var showingDisableWithoutPasscode: Binding<Bool> {
        Binding(
            get: { pendingDisableBox != nil },
            set: { showing in
                if showing == false {
                    pendingDisableBox = nil
                }
            }
        )
    }

    private func lockBinding(for box: PairedBox) -> Binding<Bool> {
        Binding(
            get: {
                store.boxes.first(where: { $0.id == box.id })?.requiresDeviceUnlock ?? false
            },
            set: { requiresUnlock in
                if requiresUnlock {
                    store.setRequiresDeviceUnlock(true, for: box)
                } else {
                    authenticateToDisableLock(for: box)
                }
            }
        )
    }

    private func authenticateToDisableLock(for box: PairedBox) {
        guard authenticatingLockBoxID == nil else {
            return
        }
        authenticatingLockBoxID = box.id
        errorMessage = nil
        Task {
            let result = await boxLockManager.authenticateForLockRemoval()
            authenticatingLockBoxID = nil
            switch result {
            case .authenticated:
                store.setRequiresDeviceUnlock(false, for: box)
            case .cancelled:
                break
            case .passcodeNotSet:
                pendingDisableBox = box
            case .failed:
                errorMessage = "Authentication failed. The box remains locked."
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
        .environmentObject(BoxLockManager())
}
