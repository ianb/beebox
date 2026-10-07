import SwiftUI

/// The screen for one box as a whole: unfinished quick chat messages, recent
/// chats, the box-wide pages, the other boxes, and a composer for a new thought.
/// It is not a chat and mounts no web content; each link hands a box-relative
/// path to `onOpen`, which shows the web app at that path.
///
/// When the person's own send or choose comes back, the store's `followUp`
/// says what to do: open the chat it went to, as "Open chat" does, or scroll
/// its row into view and announce its status line.
struct BoxScreenView: View {
    /// Box-relative paths of the box-wide pages, as the web landmark menu used.
    static let boxPages: [(label: String, path: String, symbol: String)] = [
        ("Dashboard", "views/_config/interface/dashboard.card", "square.grid.2x2"),
        ("Browse", "views/_config/interface/browse.card", "folder"),
        ("History", "views/_config/interface/history.card", "clock.arrow.circlepath"),
        ("Storage", "views/_config/interface/inventory.card", "internaldrive"),
    ]
    static let allChatsPath = "chats"
    private static let boxesSectionID = "boxes"

    var box: PairedBox
    var boxes: [PairedBox]
    @ObservedObject var screenStore: BoxScreenStore
    @ObservedObject var outbox: QuickChatOutbox
    @ObservedObject var draftStore: ComposerDraftStore
    /// Never activated: a quick chat composer does not touch pending emissions,
    /// but the composer's type requires a store.
    @ObservedObject var pendingStore: PendingEmissionStore
    var onOpen: (String) -> Void
    var onSelectBox: (PairedBox) -> Void
    /// Open scrolled to the Boxes section, for the multi-box fixture.
    var initiallyShowsBoxes = false

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
                List {
                    refreshNotice
                    needsSection
                    sentSection
                    recentSection
                    boxSection
                    boxesSection
                }
                .task(id: screenStore.homes[box.id] != nil) {
                    // Again once the home answer lands, which grows the list above.
                    if initiallyShowsBoxes {
                        proxy.scrollTo(Self.boxesSectionID, anchor: .top)
                    }
                }
                .onChange(of: screenStore.followUp) { _, request in
                    perform(request, proxy: proxy)
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle(box.label)
            .navigationBarTitleDisplayMode(.inline)
            .refreshable {
                await screenStore.refresh(boxID: box.id)
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                composer
            }
        }
        .onAppear {
            screenStore.setShownBox(box.id)
        }
        .onChange(of: box.id) { _, boxID in
            screenStore.setShownBox(boxID)
        }
        .onDisappear {
            screenStore.setShownBox(nil)
        }
    }

    private func perform(_ request: BoxScreenFollowUpRequest?, proxy: ScrollViewProxy) {
        guard let request, request.boxID == box.id else {
            return
        }
        screenStore.consumeFollowUp(request)
        switch request.followUp {
        case .openChat(let sessionID):
            onOpen(Self.chatPath(sessionID: sessionID))
        case .reveal(let rowID, let status):
            // After this update has put the row in the list.
            DispatchQueue.main.async {
                withAnimation {
                    proxy.scrollTo(rowID, anchor: .center)
                }
                UIAccessibility.post(notification: .announcement, argument: status)
            }
        }
    }

    // MARK: Sections

    @ViewBuilder
    private var refreshNotice: some View {
        if screenStore.refreshes[box.id] == .failed {
            Section {
                HStack {
                    Label("Could not refresh", systemImage: "exclamationmark.triangle")
                        .foregroundStyle(.secondary)
                    Spacer()
                    Button("Retry") {
                        Task { await screenStore.refresh(boxID: box.id) }
                    }
                    .buttonStyle(.borderless)
                }
            }
        }
    }

    @ViewBuilder
    private var needsSection: some View {
        let needs = screenStore.needs(boxID: box.id)
        if needs.isEmpty == false {
            Section("Needs you") {
                ForEach(needs) { need in
                    switch need {
                    case .outbox(let entry, let status):
                        outboxRow(entry, status: status)
                            .id(entry.id)
                    case .record(let view):
                        recordRow(view)
                            .id(view.id)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var sentSection: some View {
        let sent = screenStore.sent(boxID: box.id)
        if sent.isEmpty == false {
            Section {
                ForEach(sent) { view in
                    sentRow(view)
                        .id(view.id)
                }
            }
        }
    }

    @ViewBuilder
    private var recentSection: some View {
        Section("Pick up where you left off") {
            if let home = screenStore.homes[box.id] {
                ForEach(Array(home.recentChats.enumerated()), id: \.element.id) { index, chat in
                    recentChatRow(chat, primary: index == 0)
                }
            } else if screenStore.refreshes[box.id] != .failed {
                HStack {
                    ProgressView()
                    Text("Loading chats")
                        .foregroundStyle(.secondary)
                }
            }
            Button {
                onOpen(Self.allChatsPath)
            } label: {
                Label("All chats", systemImage: "bubble.left.and.bubble.right")
            }
        }
    }

    private var boxSection: some View {
        Section("In this box") {
            ForEach(Self.boxPages, id: \.path) { page in
                Button {
                    onOpen(page.path)
                } label: {
                    Label(page.label, systemImage: page.symbol)
                }
            }
            ForEach(screenStore.homes[box.id]?.shortcuts ?? [], id: \.to) { shortcut in
                Button {
                    onOpen(Self.boxPath(fromShortcut: shortcut.to))
                } label: {
                    Label(shortcut.label, systemImage: "link")
                }
            }
        }
    }

    @ViewBuilder
    private var boxesSection: some View {
        if boxes.count >= 2 {
            Section("Boxes") {
                ForEach(boxes) { other in
                    Button {
                        onSelectBox(other)
                    } label: {
                        HStack {
                            Label(other.label, systemImage: "shippingbox")
                            Spacer()
                            if other.id == box.id {
                                Image(systemName: "checkmark")
                                    .foregroundStyle(.tint)
                                    .accessibilityLabel("Current box")
                            }
                        }
                    }
                    .disabled(other.id == box.id)
                }
            }
            .id(Self.boxesSectionID)
        }
    }

    private var composer: some View {
        VStack(spacing: 0) {
            Text("New thought. The box picks the conversation.")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal)
                .padding(.top, 8)
            NativeComposerView(
                box: box,
                draftStore: draftStore,
                pendingStore: pendingStore,
                captureAvailable: false,
                narrationEnabled: false,
                hqDictationEnabled: false,
                speechPlaybackActive: false,
                responseActive: false,
                locationSharingEnabled: false,
                onToggleLocationSharing: {},
                onTakeScreenshot: {},
                submitTarget: .quickChat { [screenStore, boxID = box.id] text, origin in
                    await screenStore.submitThought(text, origin: origin, boxID: boxID)
                },
                automaticallyResumeVoicePreparations: false
            )
        }
        .background(.bar)
    }

    // MARK: Rows

    private func outboxRow(_ entry: QuickChatOutboxEntry, status: QuickChatOutbox.Status) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(entry.text)
                .lineLimit(4)
            switch status {
            case .sending:
                HStack(spacing: 6) {
                    ProgressView()
                    Text("Sending")
                }
                .font(.footnote)
                .foregroundStyle(.secondary)
            case .waiting:
                Text("Waiting to send")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                outboxActions(entry)
            case .notSent:
                Text("Not sent")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.red)
                outboxActions(entry)
            }
        }
        .padding(.vertical, 4)
    }

    private func outboxActions(_ entry: QuickChatOutboxEntry) -> some View {
        HStack {
            Button("Retry") {
                Task { await screenStore.retryOutboxEntry(id: entry.id, boxID: box.id) }
            }
            Button("Discard", role: .destructive) {
                Task { await outbox.discard(id: entry.id) }
            }
        }
        .buttonStyle(.bordered)
        .controlSize(.small)
    }

    @ViewBuilder
    private func recordRow(_ view: QuickChatView) -> some View {
        let busy = screenStore.busyIDs.contains(view.id)
        VStack(alignment: .leading, spacing: 8) {
            Text(view.message)
                .lineLimit(4)
            switch view.state {
            case .needsChoice:
                Text(view.statusLine)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                choiceButtons(view)
                discardButton(view)
            case .sending where view.expired == true:
                Text(view.statusLine)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                HStack {
                    openChatButton(view)
                    discardButton(view)
                }
            case .sending:
                Text(view.statusLine)
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.red)
                if let lastError = view.lastError {
                    Text(lastError)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                HStack {
                    Button("Retry") {
                        Task { await screenStore.retry(view, boxID: box.id) }
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                    discardButton(view)
                }
            case .sent, .discarded:
                // `needs` lists only open records.
                EmptyView()
            }
            if let error = screenStore.actionErrors[view.id] {
                Text(error)
                    .font(.footnote)
                    .foregroundStyle(.red)
            }
        }
        .disabled(busy)
        .opacity(busy ? 0.6 : 1)
        .padding(.vertical, 4)
    }

    private func choiceButtons(_ view: QuickChatView) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(view.choices ?? []) { choice in
                Button {
                    Task { await screenStore.choose(choice, for: view, boxID: box.id) }
                } label: {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(choice.label)
                        if let detail = choice.detail {
                            Text(detail)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.bordered)
            }
        }
    }

    private func discardButton(_ view: QuickChatView) -> some View {
        Button("Discard", role: .destructive) {
            Task { await screenStore.discard(view, boxID: box.id) }
        }
        .buttonStyle(.bordered)
        .controlSize(.small)
    }

    @ViewBuilder
    private func openChatButton(_ view: QuickChatView) -> some View {
        if let sessionID = view.destination?.sessionId {
            Button("Open chat") {
                onOpen(Self.chatPath(sessionID: sessionID))
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
        } else {
            Button("All chats") {
                onOpen(Self.allChatsPath)
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
        }
    }

    private func sentRow(_ view: QuickChatView) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(view.message)
                .lineLimit(2)
                .foregroundStyle(.secondary)
            HStack {
                Label(view.statusLine, systemImage: "checkmark.circle")
                .font(.footnote)
                Spacer()
                openChatButton(view)
            }
        }
        .padding(.vertical, 4)
    }

    @ViewBuilder
    private func recentChatRow(_ chat: QuickChatRecentChat, primary: Bool) -> some View {
        let button = Button {
            onOpen(Self.chatPath(sessionID: chat.sessionId))
        } label: {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(chat.label)
                        .font(primary ? .headline : .body)
                        .lineLimit(1)
                    if let landmark = chat.landmark {
                        Text([landmark.symbol, landmark.label].compactMap(\.self).joined(separator: " "))
                            .font(.caption)
                            .foregroundStyle(primary ? Color.white.opacity(0.85) : Color.secondary)
                            .lineLimit(1)
                    }
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.caption)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        if primary {
            button
                .buttonStyle(.borderedProminent)
                .listRowInsets(EdgeInsets(top: 8, leading: 12, bottom: 8, trailing: 12))
        } else {
            button
                .foregroundStyle(.primary)
        }
    }

    // MARK: Text and paths

    static func chatPath(sessionID: String) -> String {
        var components = URLComponents()
        components.path = "chat"
        components.queryItems = [URLQueryItem(name: "session", value: sessionID)]
        return components.string ?? "chat"
    }

    /// A `nav.card` entry's `to` is box-relative with a leading slash.
    static func boxPath(fromShortcut to: String) -> String {
        String(to.drop { $0 == "/" })
    }
}
