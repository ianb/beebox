import AVFAudio
import XCTest
import UIKit
@testable import CallbackBox

@MainActor
final class ComposerTextViewTests: XCTestCase {
    func testUserDrivenTextMatchDoesNotReplayStaleSelection() {
        let textView = UITextView()
        textView.text = "swiped"
        textView.selectedRange = NSRange(location: 6, length: 0)

        ComposerTextView.reconcileTextAndSelection(
            in: textView,
            text: "swiped",
            selection: NSRangeValue(location: 0, length: 0)
        )

        XCTAssertEqual(textView.selectedRange, NSRange(location: 6, length: 0))
    }

    func testProgrammaticTextReplacementAlsoPlacesSelection() {
        let textView = UITextView()
        textView.text = "draft"
        textView.selectedRange = NSRange(location: 2, length: 0)

        ComposerTextView.reconcileTextAndSelection(
            in: textView,
            text: "draft [file1]",
            selection: NSRangeValue(location: 13, length: 0)
        )

        XCTAssertEqual(textView.text, "draft [file1]")
        XCTAssertEqual(textView.selectedRange, NSRange(location: 13, length: 0))
    }
}

final class NativeComposerLayoutTests: XCTestCase {
    func testStatusOnlyContextDoesNotUseCappedScrollContainer() {
        XCTAssertFalse(
            NativeComposerView.contextNeedsScrolling(
                pendingCount: 0,
                voicePreparationCount: 0,
                imageCount: 0,
                fileCount: 0,
                selectionCount: 0
            )
        )
    }

    func testAttachmentContextRemainsCappedAndScrollable() {
        XCTAssertTrue(
            NativeComposerView.contextNeedsScrolling(
                pendingCount: 0,
                voicePreparationCount: 0,
                imageCount: 1,
                fileCount: 0,
                selectionCount: 0
            )
        )
    }
}

final class NativeVoiceTurnTests: XCTestCase {
    func testPlainVoiceSendListensWhileWaitingAndPausesOnlyForSpeech() {
        var turn = NativeVoiceTurnState()

        XCTAssertEqual(turn.handle(.microphoneStarted), .startDictation)
        XCTAssertEqual(turn.handle(.voiceMessageSent(closeMicrophone: false)), .startDictation)
        XCTAssertEqual(turn.handle(.speechPlaybackChanged(playing: true)), .stopDictation)
        XCTAssertEqual(turn.handle(.speechPlaybackChanged(playing: true)), .none)
        XCTAssertEqual(turn.handle(.speechPlaybackChanged(playing: false)), .startDictation)
        XCTAssertTrue(turn.isActive)
    }

    func testSendAndCloseDoesNotResumeAfterSpeech() {
        var turn = NativeVoiceTurnState()
        _ = turn.handle(.microphoneStarted)

        XCTAssertEqual(
            turn.handle(.voiceMessageSent(closeMicrophone: true)),
            .stopDictation
        )
        XCTAssertEqual(turn.handle(.speechPlaybackChanged(playing: true)), .none)
        XCTAssertEqual(turn.handle(.speechPlaybackChanged(playing: false)), .none)
        XCTAssertFalse(turn.isActive)
    }

    /// Pressing record while the box is talking is barge-in: the turn listens
    /// immediately and the speech is cut off, matching the web composer's
    /// `START_DICTATION`. Waiting instead is what made the button look broken
    /// with the volume down.
    func testPressingRecordDuringSpeechInterruptsInsteadOfWaiting() {
        var turn = NativeVoiceTurnState()

        XCTAssertEqual(turn.handle(.speechPlaybackChanged(playing: true)), .none)
        XCTAssertEqual(turn.handle(.microphoneStarted), .startDictationInterruptingSpeech)
        XCTAssertTrue(turn.isActive)
    }

    /// The `playing:false` a barge-in causes must not restart the dictation the
    /// press already started: only a mic that was deferred *for* the speech
    /// resumes when it ends.
    func testBargeInDoesNotRestartItselfWhenTheSpeechReportsStopped() {
        var turn = NativeVoiceTurnState()
        _ = turn.handle(.speechPlaybackChanged(playing: true))
        _ = turn.handle(.microphoneStarted)

        XCTAssertEqual(turn.handle(.speechPlaybackChanged(playing: false)), .none)
        XCTAssertTrue(turn.isActive)
    }

    /// The automatic reopen after a send is the system resuming, not the user
    /// talking, so it keeps waiting for the box to finish its reply.
    func testSendingWhileTheBoxSpeaksStillWaitsForTheReplyToEnd() {
        var turn = NativeVoiceTurnState()
        _ = turn.handle(.microphoneStarted)
        _ = turn.handle(.speechPlaybackChanged(playing: true))

        XCTAssertEqual(turn.handle(.voiceMessageSent(closeMicrophone: false)), .none)
        XCTAssertEqual(turn.handle(.speechPlaybackChanged(playing: false)), .startDictation)
        XCTAssertTrue(turn.isActive)
    }

    /// Erasing a draft mid-speech is also automatic; it may not cut the box off.
    func testErasingDraftDuringSpeechWaitsRatherThanInterrupting() {
        var turn = NativeVoiceTurnState()
        _ = turn.handle(.microphoneStarted)
        _ = turn.handle(.speechPlaybackChanged(playing: true))

        XCTAssertEqual(turn.handle(.draftErased), .none)
        XCTAssertEqual(turn.handle(.speechPlaybackChanged(playing: false)), .startDictation)
    }

    func testErasingDraftKeepsActiveVoiceTurnListening() {
        var turn = NativeVoiceTurnState()
        _ = turn.handle(.microphoneStarted)

        XCTAssertEqual(turn.handle(.draftErased), .startDictation)
        XCTAssertTrue(turn.isActive)
    }

    func testErasingDraftDoesNotStartAnInactiveVoiceTurn() {
        var turn = NativeVoiceTurnState()

        XCTAssertEqual(turn.handle(.draftErased), .none)
        XCTAssertFalse(turn.isActive)
    }

    func testMicrophoneOffStillStopsAfterErasingDraft() {
        var turn = NativeVoiceTurnState()
        _ = turn.handle(.microphoneStarted)
        _ = turn.handle(.draftErased)

        XCTAssertEqual(turn.handle(.microphoneStopped), .stopDictation)
        XCTAssertFalse(turn.isActive)
    }
}

final class NativeEarconStateTests: XCTestCase {
    func testFreshRecordingGetsStartCueButAutomaticResumeStaysQuiet() {
        var state = NativeEarconState()

        XCTAssertEqual(state.handle(.microphoneRequested), [])
        XCTAssertEqual(
            state.handle(.dictationStateChanged(.recording)),
            [.play(.recordingStart)]
        )
        XCTAssertEqual(state.handle(.dictationStateChanged(.editableResult)), [.stopStillListening])
        XCTAssertEqual(state.handle(.dictationStateChanged(.recording)), [])
    }

    func testStartFailureAndMidRecordingFailureUseDistinctWebCues() {
        var startup = NativeEarconState()
        _ = startup.handle(.microphoneRequested)
        XCTAssertEqual(
            startup.handle(.dictationStateChanged(.failed(message: "denied"))),
            [.play(.recordingError), .stopStillListening]
        )

        var interrupted = NativeEarconState()
        _ = interrupted.handle(.microphoneRequested)
        _ = interrupted.handle(.dictationStateChanged(.recording))
        XCTAssertEqual(
            interrupted.handle(.recordingInterrupted),
            [.play(.recordingDropped), .stopStillListening]
        )
    }

    func testSendTicksUntilObservedResponseFinishes() {
        var state = NativeEarconState()

        XCTAssertEqual(
            state.handle(.voiceMessageSent(responseAlreadyActive: false)),
            [.play(.send), .startWaitingTicks]
        )
        XCTAssertEqual(state.handle(.responseActiveChanged(false)), [])
        XCTAssertEqual(state.handle(.responseActiveChanged(true)), [])
        XCTAssertEqual(
            state.handle(.responseActiveChanged(false)),
            [.stopWaitingTicks]
        )
    }

    func testSendDuringActiveResponseStopsAtItsNextFinishedEdge() {
        var state = NativeEarconState()

        _ = state.handle(.voiceMessageSent(responseAlreadyActive: true))
        XCTAssertEqual(
            state.handle(.responseActiveChanged(false)),
            [.stopWaitingTicks]
        )
    }

    func testStillListeningTimerRestartsWithEachTranscriptUpdate() {
        var state = NativeEarconState()
        _ = state.handle(.dictationStateChanged(.recording))

        XCTAssertEqual(
            state.handle(.transcriptChanged(hasText: true)),
            [.restartStillListening]
        )
        XCTAssertEqual(
            state.handle(.transcriptChanged(hasText: true)),
            [.restartStillListening]
        )
        XCTAssertEqual(
            state.handle(.transcriptChanged(hasText: false)),
            [.stopStillListening]
        )
    }

    func testEarconsUseTheSameFilesAndVolumesAsWeb() {
        XCTAssertEqual(NativeEarcon.send.resource, .init(filename: "beeprising.wav", volume: 0.3))
        XCTAssertEqual(NativeEarcon.tick.resource, .init(filename: "tick2.wav", volume: 0.6))
        XCTAssertEqual(NativeEarcon.stillListening.resource, .init(filename: "book-close.wav", volume: 0.3))
        XCTAssertEqual(NativeEarcon.recordingStart.resource, .init(filename: "recording-start.mp3", volume: 0.7))
        XCTAssertEqual(NativeEarcon.recordingStop.resource, .init(filename: "recording-stop.mp3", volume: 0.7))
        XCTAssertEqual(NativeEarcon.recordingError.resource, .init(filename: "recording-error.wav", volume: 0.7))
        XCTAssertEqual(NativeEarcon.recordingDropped.resource, .init(filename: "krell-alarm-7.wav", volume: 0.7))
    }

    func testAppBundleContainsEveryEarconResource() throws {
        let bundle = Bundle(for: NativeEarconPlayer.self)
        for earcon in NativeEarcon.allCases {
            let resource = earcon.resource
            let file = resource.filename as NSString
            let url = try XCTUnwrap(
                bundle.url(
                    forResource: file.deletingPathExtension,
                    withExtension: file.pathExtension
                ),
                resource.filename
            )
            XCTAssertNoThrow(try AVAudioPlayer(contentsOf: url), resource.filename)
        }
    }
}

final class ComposerDraftReducerTests: XCTestCase {
    func testLiveDictationMovesCaretToNewestTranscript() {
        var draft = ComposerDraft.empty
        ComposerDraftReducer.reduce(&draft, .setText("older words"))
        ComposerDraftReducer.reduce(
            &draft,
            .setSelection(NSRangeValue(location: 0, length: 0))
        )

        ComposerDraftReducer.reduce(
            &draft,
            .setDictationTranscript("older words followed by the newest spoken words")
        )

        XCTAssertEqual(
            draft.selection,
            NSRangeValue(location: (draft.text as NSString).length, length: 0)
        )
    }

    func testVoiceKeywordSendUsesLiveTranscriptWhenNarrationIsOff() {
        XCTAssertEqual(
            NativeVoiceKeywordSendPlan.make(
                liveTranscript: "native words <send-message phrase=\"send now\" />",
                action: .send,
                narrationEnabled: false
            ),
            .live(text: "native words <send-message phrase=\"send now\" />")
        )
    }

    func testVoiceKeywordSendUsesHQPreparationWhenNarrationIsOn() {
        XCTAssertEqual(
            NativeVoiceKeywordSendPlan.make(
                liveTranscript: "native words",
                action: .send,
                narrationEnabled: true
            ),
            .hq
        )
    }

    func testCleanupKeywordUsesHQPreparationWhenNarrationIsOff() {
        XCTAssertEqual(
            NativeVoiceKeywordSendPlan.make(
                liveTranscript: "native words",
                action: .sendHq,
                narrationEnabled: false
            ),
            .hq
        )
    }

    func testVoiceCompositionStateTransitionsAreExplicit() {
        var state = VoiceCompositionState.idle
        VoiceCompositionReducer.reduce(&state, .requestPermission)
        XCTAssertEqual(state, .requestingPermission)
        VoiceCompositionReducer.reduce(&state, .permissionGranted)
        XCTAssertEqual(state, .recording)
        VoiceCompositionReducer.reduce(&state, .keywordDetected)
        XCTAssertEqual(state, .preparingHQ)
        VoiceCompositionReducer.reduce(&state, .preparationCompleted)
        XCTAssertEqual(state, .idle)
        VoiceCompositionReducer.reduce(&state, .recordingStopped(hasText: true))
        XCTAssertEqual(state, .editableResult)
        VoiceCompositionReducer.reduce(&state, .fail(message: "interrupted"))
        XCTAssertEqual(state, .failed(message: "interrupted"))
        VoiceCompositionReducer.reduce(&state, .reset)
        XCTAssertEqual(state, .idle)
    }

    @MainActor
    func testResettingDictationClearsInterruptionNotice() {
        let dictation = SpeechDictation()
        dictation.failPreparation("Dictation was interrupted.")

        dictation.resetDictationState()

        XCTAssertNil(dictation.errorMessage)
        XCTAssertEqual(dictation.state, .idle)
        XCTAssertEqual(dictation.interruptionCount, 0)
    }

    @MainActor
    func testCancellationDuringDictationStartupIsExpected() {
        XCTAssertTrue(
            SpeechDictation.isExpectedCancellation(
                CancellationError(),
                taskWasCancelled: false
            )
        )
        XCTAssertTrue(
            SpeechDictation.isExpectedCancellation(
                CocoaError(.fileReadUnknown),
                taskWasCancelled: true
            )
        )
        XCTAssertFalse(
            SpeechDictation.isExpectedCancellation(
                CocoaError(.fileReadUnknown),
                taskWasCancelled: false
            )
        )
    }

    @MainActor
    func testCancelledStartupCannotClearNewerStartupHandle() async {
        var permissionRequests: [CheckedContinuation<Bool, Never>] = []
        var completedStartups = 0
        let dictation = SpeechDictation(
            permissionRequester: {
                await withCheckedContinuation { continuation in
                    permissionRequests.append(continuation)
                }
            },
            startupDidFinish: {
                completedStartups += 1
            }
        )

        dictation.toggle(currentText: "")
        await waitUntil { permissionRequests.count == 1 }
        dictation.stop()
        dictation.toggle(currentText: "")
        await waitUntil { permissionRequests.count == 2 }

        permissionRequests[0].resume(returning: true)
        await waitUntil { completedStartups == 1 }

        XCTAssertTrue(dictation.hasPendingStart)
        XCTAssertEqual(dictation.state, .requestingPermission)
        dictation.toggle(currentText: "")
        await Task.yield()
        XCTAssertEqual(permissionRequests.count, 2)
        permissionRequests[1].resume(returning: false)
        await waitUntil { completedStartups == 2 }
        XCTAssertFalse(dictation.hasPendingStart)
    }

    @MainActor
    private func waitUntil(_ condition: @MainActor () -> Bool) async {
        for _ in 0..<100 {
            if condition() {
                return
            }
            await Task.yield()
        }
        XCTFail("Timed out waiting for the dictation startup state")
    }

    func testVoicePreparationResolutionPreservesFallbackAndRebuildsHQText() {
        let preparation = VoicePreparation(
            id: UUID(),
            boxID: UUID(),
            draft: .empty,
            liveTranscript: "live words <send-message phrase=\"send now\" />",
            priorInput: "typed first",
            action: .send,
            matchedPhrase: "send now",
            audioFilename: "voice.wav",
            createdAt: Date()
        )

        XCTAssertEqual(
            VoicePreparationResolver.text(for: preparation, hqTranscript: nil),
            preparation.liveTranscript
        )
        XCTAssertEqual(
            VoicePreparationResolver.text(for: preparation, hqTranscript: "clearer words"),
            "typed first clearer words <send-message phrase=\"send now\" />"
        )
    }

    func testUnicodeCaretInsertionUsesUTF16Offsets() {
        var draft = ComposerDraft.empty
        ComposerDraftReducer.reduce(&draft, .setText("A 👩🏽‍💻 Z"))
        let emojiRange = (draft.text as NSString).range(of: "👩🏽‍💻")
        ComposerDraftReducer.reduce(
            &draft,
            .setSelection(NSRangeValue(location: NSMaxRange(emojiRange), length: 0))
        )
        ComposerDraftReducer.reduce(&draft, .addFile(DraftFile(
            id: 7,
            filename: "payload.pdf",
            originalName: "payload.pdf",
            size: 12,
            mimetype: "application/pdf",
            state: .local
        )))

        XCTAssertEqual(draft.text, "A 👩🏽‍💻 [file7] Z")
        XCTAssertEqual(draft.selection.location, ("A 👩🏽‍💻 [file7]" as NSString).length)
        XCTAssertEqual(draft.nextFileID, 8)
    }

    func testRemovingAnItemKeepsMonotonicIDsAndStripsOnlyItsToken() {
        var draft = ComposerDraft.empty
        ComposerDraftReducer.reduce(&draft, .addImage(DraftImage(id: 2, filename: "a.jpg", mimeType: "image/jpeg", state: .local)))
        ComposerDraftReducer.reduce(&draft, .addImage(DraftImage(id: 5, filename: "b.jpg", mimeType: "image/jpeg", state: .local)))
        ComposerDraftReducer.reduce(&draft, .removeImage(2))

        XCTAssertEqual(draft.images.map(\.id), [5])
        XCTAssertFalse(draft.text.contains("[image2]"))
        XCTAssertTrue(draft.text.contains("[image5]"))
        XCTAssertEqual(draft.nextImageID, 6)
    }

    func testCaretInsideComposedEmojiFallsBackToEnd() {
        let text = "👩🏽‍💻 then"
        let emojiRange = (text as NSString).range(of: "👩🏽‍💻")
        let invalid = NSRangeValue(location: emojiRange.location + 1, length: 0)

        XCTAssertEqual(invalid.clamped(to: text), NSRange(location: (text as NSString).length, length: 0))
    }

    func testResetKeepsCommandDedupHistoryOutsideEditableContent() {
        var draft = ComposerDraft.empty
        ComposerDraftReducer.reduce(
            &draft,
            .applySelectionCommand(
                commandID: "command-1",
                selection: DraftSelection(
                    id: 1,
                    ref: "/plan.md",
                    text: "selected",
                    position: "line 1",
                    anchor: nil,
                    spokenWords: nil
                )
            )
        )

        ComposerDraftReducer.reduce(&draft, .reset)

        XCTAssertEqual(draft.processedCommandIDs, ["command-1"])
        XCTAssertTrue(draft.text.isEmpty)
        XCTAssertTrue(draft.selections.isEmpty)
    }
}

final class ComposerDraftRepositoryTests: XCTestCase {
    private var rootURL: URL!

    override func setUpWithError() throws {
        rootURL = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: rootURL, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: rootURL)
    }

    func testAtomicManifestReloadsForItsBox() async throws {
        let boxID = UUID()
        let repository = ComposerDraftRepository(rootURL: rootURL)
        var draft = ComposerDraft.empty
        ComposerDraftReducer.reduce(&draft, .setText("durable text"))
        try await repository.save(draft, boxID: boxID)

        let restored = try await ComposerDraftRepository(rootURL: rootURL).load(boxID: boxID)
        XCTAssertEqual(restored, draft)
        let files = try FileManager.default.contentsOfDirectory(atPath: rootURL.appendingPathComponent(boxID.uuidString.lowercased()).path)
        XCTAssertEqual(files, ["manifest.json"])
    }

    func testCorruptManifestIsQuarantined() async throws {
        let boxID = UUID()
        let repository = ComposerDraftRepository(rootURL: rootURL)
        let manifestURL = await repository.manifestURL(boxID: boxID)
        try FileManager.default.createDirectory(at: manifestURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("not json".utf8).write(to: manifestURL)

        await XCTAssertThrowsErrorAsync {
            _ = try await repository.load(boxID: boxID)
        }
        let files = try FileManager.default.contentsOfDirectory(atPath: manifestURL.deletingLastPathComponent().path)
        XCTAssertFalse(files.contains("manifest.json"))
        XCTAssertTrue(files.contains { $0.hasPrefix("manifest.corrupt-") })
    }

    func testPayloadRoundTripAndFilenameValidation() async throws {
        let boxID = UUID()
        let repository = ComposerDraftRepository(rootURL: rootURL)
        let expected = Data("image bytes".utf8)

        try await repository.savePayload(expected, filename: "image-1.jpg", boxID: boxID)
        let restored = try await repository.loadPayload(filename: "image-1.jpg", boxID: boxID)
        XCTAssertEqual(restored, expected)
        await XCTAssertThrowsErrorAsync {
            try await repository.savePayload(expected, filename: "../outside.jpg", boxID: boxID)
        }
        try await repository.removePayload(filename: "image-1.jpg", boxID: boxID)
        await XCTAssertThrowsErrorAsync {
            _ = try await repository.loadPayload(filename: "image-1.jpg", boxID: boxID)
        }
    }

    @MainActor
    func testStoredImagesKeepStableIDsAcrossRemovalAndRelaunch() async throws {
        let suite = "ComposerDraftImages.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let boxID = UUID()
        let repository = ComposerDraftRepository(rootURL: rootURL)
        let store = ComposerDraftStore(repository: repository, defaults: defaults)
        await store.activate(boxID: boxID)

        await store.addImage(data: Data("first".utf8), mimeType: "image/jpeg", fileExtension: "jpg")
        await store.addImage(data: Data("second".utf8), mimeType: "image/jpeg", fileExtension: "jpg")
        await store.removeImage(id: 1)

        XCTAssertEqual(store.draft.images.map(\.id), [2])
        XCTAssertEqual(store.draft.nextImageID, 3)
        XCTAssertFalse(store.draft.text.contains("[image1]"))
        XCTAssertTrue(store.draft.text.contains("[image2]"))

        let relaunched = ComposerDraftStore(repository: repository, defaults: defaults)
        await relaunched.activate(boxID: boxID)
        XCTAssertEqual(relaunched.draft.images.map(\.id), [2])
        let attachments = try await relaunched.emissionImages(from: relaunched.draft, boxID: boxID)
        XCTAssertEqual(attachments.map(\.id), [2])
        XCTAssertEqual(attachments.first?.dataBase64, Data("second".utf8).base64EncodedString())
    }

    @MainActor
    func testInterruptedImageProcessingRestoresAsRetryableFailure() async throws {
        let suite = "ComposerDraftImageProcessing.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let boxID = UUID()
        let repository = ComposerDraftRepository(rootURL: rootURL)
        let store = ComposerDraftStore(repository: repository, defaults: defaults)
        await store.activate(boxID: boxID)

        let imported = await store.beginImageImport(data: Data("source".utf8), mimeType: "image/png")
        let image = try XCTUnwrap(imported)
        XCTAssertEqual(image.state, .uploading(progress: 0))

        let relaunched = ComposerDraftStore(repository: repository, defaults: defaults)
        await relaunched.activate(boxID: boxID)
        XCTAssertEqual(
            relaunched.draft.images.first?.state,
            .failed(message: "Image processing was interrupted. Retry to continue.")
        )
        XCTAssertEqual(relaunched.restoreNotice, "An interrupted attachment is ready to retry.")
        let restoredData = await relaunched.imageData(for: image, boxID: boxID)
        XCTAssertEqual(restoredData, Data("source".utf8))
    }

    @MainActor
    func testRelaunchRemovesManifestImagesWithMissingPayloads() async throws {
        let suite = "ComposerDraftMissingImage.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let boxID = UUID()
        let repository = ComposerDraftRepository(rootURL: rootURL)
        var draft = ComposerDraft.empty
        ComposerDraftReducer.reduce(
            &draft,
            .addImage(DraftImage(id: 4, filename: "missing.jpg", mimeType: "image/jpeg", state: .local))
        )
        try await repository.save(draft, boxID: boxID)

        let store = ComposerDraftStore(repository: repository, defaults: defaults)
        await store.activate(boxID: boxID)

        XCTAssertTrue(store.draft.images.isEmpty)
        XCTAssertFalse(store.draft.text.contains("[image4]"))
        XCTAssertEqual(store.restoreNotice, "Some draft attachments were missing and were removed.")
    }

    @MainActor
    func testFileImportUploadAndEmissionSurviveRelaunch() async throws {
        let suite = "ComposerDraftFile.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let boxID = UUID()
        let sourceURL = rootURL.appendingPathComponent("report.pdf")
        let payload = Data("report".utf8)
        try payload.write(to: sourceURL)
        let repository = ComposerDraftRepository(rootURL: rootURL.appendingPathComponent("drafts"))
        let store = ComposerDraftStore(repository: repository, defaults: defaults)
        await store.activate(boxID: boxID)

        let imported = await store.addFile(
            from: sourceURL,
            originalName: "report.pdf",
            mimeType: "application/pdf",
            size: payload.count
        )
        let file = try XCTUnwrap(imported)
        await store.setFileState(id: file.id, state: .uploading(progress: 0.5), boxID: boxID)
        await store.setFileProgress(id: file.id, progress: 0.75, boxID: boxID)
        XCTAssertEqual(store.draft.files.first?.state, .uploading(progress: 0.75))
        await store.markFileUploaded(id: file.id, upload: UploadedChatFile(
            path: "tmp/report.pdf",
            originalName: "report.pdf",
            size: payload.count,
            mimetype: "application/pdf"
        ), boxID: boxID)

        let relaunched = ComposerDraftStore(repository: repository, defaults: defaults)
        await relaunched.activate(boxID: boxID)
        let emitted = try relaunched.emissionFiles(from: relaunched.draft)
        XCTAssertEqual(emitted.map(\.path), ["tmp/report.pdf"])
        XCTAssertEqual(relaunched.draft.text, "[file1]")
    }

    @MainActor
    func testSelectionCommandIsDurableIdempotentAndEmitsTypedSelection() async throws {
        let suite = "ComposerDraftSelectionCommand.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let boxID = UUID()
        let repository = ComposerDraftRepository(rootURL: rootURL)
        let store = ComposerDraftStore(repository: repository, defaults: defaults)
        await store.activate(boxID: boxID)
        let command = NativeComposerCommand(
            id: "selection-command-1",
            selection: NativeComposerCommand.Selection(
                ref: "/notes/plan.md",
                text: "Ship the complete contract",
                position: "body; paragraph 2"
            )
        )

        let first = await store.applySelectionCommand(command, boxID: boxID)
        let duplicate = await store.applySelectionCommand(command, boxID: boxID)

        XCTAssertTrue(first.accepted)
        XCTAssertEqual(duplicate, first)
        XCTAssertEqual(store.draft.selections.count, 1)
        XCTAssertEqual(store.draft.text, "[selection1]")
        XCTAssertEqual(store.draft.processedCommandIDs, [command.id])

        let relaunched = ComposerDraftStore(repository: repository, defaults: defaults)
        await relaunched.activate(boxID: boxID)
        let afterRelaunch = await relaunched.applySelectionCommand(command, boxID: boxID)
        XCTAssertEqual(afterRelaunch, first)
        XCTAssertEqual(relaunched.draft.selections.count, 1)
        XCTAssertEqual(relaunched.draft.text, "[selection1]")
        XCTAssertEqual(
            relaunched.emissionSelections(from: relaunched.draft),
            [NativeEmissionSelection(
                id: 1,
                ref: "/notes/plan.md",
                text: "Ship the complete contract",
                position: "body; paragraph 2",
                anchor: nil,
                spokenWords: nil
            )]
        )

        await relaunched.removeSelection(id: 1)
        XCTAssertTrue(relaunched.draft.selections.isEmpty)
        XCTAssertEqual(relaunched.draft.text, "")
    }

    @MainActor
    func testSelectionCommandUsesActiveVoiceAnchorThenReturnsToTypedTokens() async throws {
        let suite = "ComposerDraftVoiceSelection.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let boxID = UUID()
        let store = ComposerDraftStore(
            repository: ComposerDraftRepository(rootURL: rootURL),
            defaults: defaults
        )
        await store.activate(boxID: boxID)
        store.setVoiceSelectionContext(
            transcript: "one two three four five six seven eight nine ten",
            active: true
        )
        let voiceCommand = NativeComposerCommand(
            id: "voice-selection",
            selection: NativeComposerCommand.Selection(ref: "/voice.md", text: "voice", position: "line 1")
        )

        let voiceAcknowledgement = await store.applySelectionCommand(voiceCommand, boxID: boxID)
        XCTAssertTrue(voiceAcknowledgement.accepted)
        XCTAssertEqual(store.draft.selections.first?.anchor, "three four five six seven eight nine ten")
        XCTAssertEqual(store.draft.selections.first?.spokenWords, 10)
        XCTAssertFalse(store.draft.text.contains("[selection1]"))

        store.setVoiceSelectionContext(transcript: "", active: false)
        let typedCommand = NativeComposerCommand(
            id: "typed-selection",
            selection: NativeComposerCommand.Selection(ref: "/typed.md", text: "typed", position: "line 2")
        )
        let typedAcknowledgement = await store.applySelectionCommand(typedCommand, boxID: boxID)
        XCTAssertTrue(typedAcknowledgement.accepted)
        XCTAssertTrue(store.draft.text.contains("[selection2]"))
        XCTAssertNil(store.draft.selections.last?.anchor)
        XCTAssertNil(store.draft.selections.last?.spokenWords)
    }

    @MainActor
    func testSelectionCommandBeforeStartupActivationRestoresThenPersists() async throws {
        let boxID = UUID()
        let repository = ComposerDraftRepository(rootURL: rootURL)
        let store = ComposerDraftStore(repository: repository)
        let command = NativeComposerCommand(
            id: "startup-selection",
            selection: NativeComposerCommand.Selection(
                ref: "/startup.md",
                text: "arrived early",
                position: "line 1"
            )
        )

        let acknowledgement = await store.applySelectionCommand(command, boxID: boxID)

        XCTAssertTrue(acknowledgement.accepted)
        XCTAssertTrue(store.isReady)
        let relaunched = ComposerDraftStore(repository: repository)
        await relaunched.activate(boxID: boxID)
        XCTAssertEqual(relaunched.draft.selections.first?.text, "arrived early")
        XCTAssertTrue(relaunched.draft.text.contains("[selection1]"))
    }

    @MainActor
    func testRapidActivationCannotLetOlderBoxOverwriteNewerBox() async throws {
        let firstBoxID = UUID()
        let secondBoxID = UUID()
        let repository = ComposerDraftRepository(rootURL: rootURL)
        var firstDraft = ComposerDraft.empty
        ComposerDraftReducer.reduce(&firstDraft, .setText("first"))
        var secondDraft = ComposerDraft.empty
        ComposerDraftReducer.reduce(&secondDraft, .setText("second"))
        try await repository.save(firstDraft, boxID: firstBoxID)
        try await repository.save(secondDraft, boxID: secondBoxID)
        let store = ComposerDraftStore(repository: repository)

        let firstActivation = Task { await store.activate(boxID: firstBoxID) }
        await Task.yield()
        await store.activate(boxID: secondBoxID)
        await firstActivation.value

        XCTAssertTrue(store.isReady)
        XCTAssertEqual(store.draft.text, "second")
    }

    func testLegacyManifestWithoutProcessedCommandIDsStillDecodes() throws {
        let json = #"{"text":"","selection":{"location":0,"length":0},"images":[],"files":[],"selections":[],"nextImageID":1,"nextFileID":1,"nextSelectionID":1}"#
        let draft = try JSONDecoder().decode(ComposerDraft.self, from: Data(json.utf8))

        XCTAssertEqual(draft, .empty)
    }

    @MainActor
    func testPendingEmissionsPersistReplayAndHandleOutOfOrderReceipts() async throws {
        let boxID = UUID()
        let repository = ComposerDraftRepository(rootURL: rootURL)
        let store = PendingEmissionStore(repository: repository)
        await store.activate(boxID: boxID)
        var firstDraft = ComposerDraft.empty
        ComposerDraftReducer.reduce(&firstDraft, .setText("first"))
        var secondDraft = ComposerDraft.empty
        ComposerDraftReducer.reduce(&secondDraft, .setText("second"))

        let first = try await store.enqueue(
            draft: firstDraft,
            text: "first",
            origin: .typed,
            diarized: false,
            boxID: boxID
        )
        let second = try await store.enqueue(
            draft: secondDraft,
            text: "second",
            origin: .voice,
            diarized: true,
            boxID: boxID
        )
        await store.markDeliveryAttempt(id: first.id, at: Date(timeIntervalSince1970: 10))
        await store.markDeliveryAttempt(id: second.id, at: Date(timeIntervalSince1970: 11))

        let relaunched = PendingEmissionStore(repository: repository)
        await relaunched.activate(boxID: boxID)
        XCTAssertEqual(relaunched.deliveries.map(\.id), [first.id, second.id])
        XCTAssertEqual(
            relaunched.pending.map(\.state),
            [
                .pending(deliveryAttempts: 1, lastAttemptAt: Date(timeIntervalSince1970: 10)),
                .pending(deliveryAttempts: 1, lastAttemptAt: Date(timeIntervalSince1970: 11))
            ]
        )
        await relaunched.markDeliveryAttempt(id: first.id, at: Date(timeIntervalSince1970: 12))
        XCTAssertEqual(
            relaunched.pending.first?.state,
            .pending(deliveryAttempts: 2, lastAttemptAt: Date(timeIntervalSince1970: 12))
        )

        await relaunched.handleReceipt(NativeEmissionReceipt(
            emissionID: second.id,
            disposition: .queued,
            reason: nil
        ))
        await relaunched.handleReceipt(NativeEmissionReceipt(
            emissionID: first.id,
            disposition: .rejected,
            reason: "offline"
        ))
        XCTAssertEqual(relaunched.pending.map(\.id), [first.id])
        XCTAssertEqual(relaunched.pending.first?.state, .rejected(reason: "offline"))
        XCTAssertTrue(relaunched.deliveries.isEmpty)

        await relaunched.retry(id: first.id)
        XCTAssertEqual(relaunched.deliveries.map(\.id), [first.id])
        await relaunched.handleReceipt(NativeEmissionReceipt(
            emissionID: first.id,
            disposition: .sent,
            reason: nil
        ))
        XCTAssertTrue(relaunched.pending.isEmpty)
        XCTAssertTrue(relaunched.deliveries.isEmpty)
    }

    @MainActor
    func testPendingRestoreKeepsPayloadWhileDiscardDeletesIt() async throws {
        let boxID = UUID()
        let repository = ComposerDraftRepository(rootURL: rootURL)
        let store = PendingEmissionStore(repository: repository)
        await store.activate(boxID: boxID)
        let filename = "image-pending.jpg"
        try await repository.savePayload(Data("image".utf8), filename: filename, boxID: boxID)
        var draft = ComposerDraft.empty
        ComposerDraftReducer.reduce(
            &draft,
            .addImage(DraftImage(id: 1, filename: filename, mimeType: "image/jpeg", state: .local))
        )

        let first = try await store.enqueue(
            draft: draft,
            text: draft.text,
            origin: .typed,
            diarized: false,
            boxID: boxID
        )
        let restored = await store.takeForRestore(id: first.id)
        let restoredPayload = try await repository.loadPayload(filename: filename, boxID: boxID)
        XCTAssertNotNil(restored)
        XCTAssertEqual(restoredPayload, Data("image".utf8))

        let second = try await store.enqueue(
            draft: draft,
            text: draft.text,
            origin: .typed,
            diarized: false,
            boxID: boxID
        )
        await store.discard(id: second.id)
        await XCTAssertThrowsErrorAsync {
            _ = try await repository.loadPayload(filename: filename, boxID: boxID)
        }
    }

    @MainActor
    func testPendingStoreSwitchesBoxesWithoutCrossDelivery() async throws {
        let firstBoxID = UUID()
        let secondBoxID = UUID()
        let repository = ComposerDraftRepository(rootURL: rootURL)
        let store = PendingEmissionStore(repository: repository)
        await store.activate(boxID: firstBoxID)
        let first = try await store.enqueue(
            draft: .empty,
            text: "first box",
            origin: .typed,
            diarized: false,
            boxID: firstBoxID
        )

        await store.activate(boxID: secondBoxID)
        XCTAssertTrue(store.pending.isEmpty)
        XCTAssertTrue(store.deliveries.isEmpty)
        let second = try await store.enqueue(
            draft: .empty,
            text: "second box",
            origin: .typed,
            diarized: false,
            boxID: secondBoxID
        )
        XCTAssertEqual(store.deliveries.map(\.id), [second.id])

        await store.activate(boxID: firstBoxID)
        XCTAssertEqual(store.pending.map(\.id), [first.id])
        XCTAssertEqual(store.deliveries.map(\.id), [first.id])
    }

    @MainActor
    func testVoicePreparationSurvivesRelaunchWithoutClobberingNextDraft() async throws {
        let suite = "VoicePreparation.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let boxID = UUID()
        let repository = ComposerDraftRepository(rootURL: rootURL)
        let draftStore = ComposerDraftStore(repository: repository, defaults: defaults)
        let pendingStore = PendingEmissionStore(repository: repository)
        await draftStore.activate(boxID: boxID)
        await pendingStore.activate(boxID: boxID)
        draftStore.setText("original live <send-message phrase=\"send now\" />")
        await draftStore.flush()
        let snapshot = draftStore.draft
        let audioURL = rootURL.deletingLastPathComponent()
            .appendingPathComponent("voice-source-\(UUID().uuidString).wav")
        try Data("voice bytes".utf8).write(to: audioURL)
        defer { try? FileManager.default.removeItem(at: audioURL) }

        let preparation = try await pendingStore.stageVoicePreparation(
            draft: snapshot,
            liveTranscript: snapshot.text,
            priorInput: "original",
            action: .send,
            matchedPhrase: "send now",
            audioURL: audioURL,
            boxID: boxID
        )
        await draftStore.clearForSending(boxID: boxID)
        draftStore.setText("next draft")
        await draftStore.flush()
        let nextEmission = try await pendingStore.enqueue(
            draft: draftStore.draft,
            text: "next draft",
            origin: .typed,
            diarized: false,
            boxID: boxID
        )
        XCTAssertTrue(pendingStore.deliveries.isEmpty, "later sends wait behind durable voice preparation")

        let relaunchedPending = PendingEmissionStore(repository: repository)
        await relaunchedPending.activate(boxID: boxID)
        let relaunchedDraft = ComposerDraftStore(repository: repository, defaults: defaults)
        await relaunchedDraft.activate(boxID: boxID)
        XCTAssertEqual(relaunchedPending.voicePreparations, [preparation])
        XCTAssertEqual(relaunchedDraft.draft.text, "next draft")
        XCTAssertTrue(relaunchedPending.deliveries.isEmpty)
        let restoredAudioURL = await relaunchedPending.voiceAudioURL(for: preparation)
        let durableAudioURL = try XCTUnwrap(restoredAudioURL)
        XCTAssertEqual(try Data(contentsOf: durableAudioURL), Data("voice bytes".utf8))

        try await relaunchedPending.finishVoicePreparation(
            id: preparation.id,
            text: "original HQ <send-message phrase=\"send now\" />",
            diarized: true
        )
        XCTAssertTrue(relaunchedPending.voicePreparations.isEmpty)
        XCTAssertEqual(relaunchedPending.pending.map(\.id), [preparation.id, nextEmission.id])
        XCTAssertEqual(relaunchedPending.deliveries.map(\.id), [preparation.id, nextEmission.id])
        XCTAssertEqual(relaunchedPending.pending.first?.draft, snapshot)
        XCTAssertEqual(relaunchedPending.pending.first?.diarized, true)
        XCTAssertEqual(relaunchedDraft.draft.text, "next draft")
        await XCTAssertThrowsErrorAsync {
            _ = try await repository.loadPayload(
                filename: try XCTUnwrap(preparation.audioFilename),
                boxID: boxID
            )
        }
    }

    @MainActor
    func testLegacyTextMigratesOnceAndBoxSwitchingRestoresIndependentDrafts() async throws {
        let suite = "ComposerDraftTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let firstBox = UUID()
        let secondBox = UUID()
        defaults.set("legacy text", forKey: "draft.\(firstBox.uuidString)")
        let repository = ComposerDraftRepository(rootURL: rootURL)
        let store = ComposerDraftStore(repository: repository, defaults: defaults)

        await store.activate(boxID: firstBox)
        XCTAssertEqual(store.draft.text, "legacy text")
        XCTAssertNil(defaults.string(forKey: "draft.\(firstBox.uuidString)"))
        store.setText("first box")
        await store.flush()
        await store.activate(boxID: secondBox)
        XCTAssertEqual(store.draft.text, "")
        store.setText("second box")
        await store.flush()
        await store.activate(boxID: firstBox)
        XCTAssertEqual(store.draft.text, "first box")
    }

    func testLegacyAwaitingWebViewStateDecodesAsNeverAttemptedPending() throws {
        let json = #"{"awaitingWebView":{}}"#
        let state = try JSONDecoder().decode(PendingEmissionState.self, from: Data(json.utf8))

        XCTAssertEqual(state, .pending(deliveryAttempts: 0, lastAttemptAt: nil))
    }

    func testLegacyAwaitingReceiptStateDecodesPreservingAttemptAndDate() throws {
        let sentAt = Date(timeIntervalSince1970: 1_000)
        let json = """
        {"awaitingReceipt":{"attempt":3,"sentAt":\(sentAt.timeIntervalSinceReferenceDate)}}
        """
        let state = try JSONDecoder().decode(PendingEmissionState.self, from: Data(json.utf8))

        XCTAssertEqual(state, .pending(deliveryAttempts: 3, lastAttemptAt: sentAt))
    }

    func testPendingEmissionStateRoundTripsThroughItsNewEncoding() throws {
        let states: [PendingEmissionState] = [
            .pending(deliveryAttempts: 0, lastAttemptAt: nil),
            .pending(deliveryAttempts: 4, lastAttemptAt: Date(timeIntervalSince1970: 2_000)),
            .rejected(reason: "offline")
        ]

        for state in states {
            let encoded = try JSONEncoder().encode(state)
            XCTAssertEqual(try JSONDecoder().decode(PendingEmissionState.self, from: encoded), state)
        }

        let neverAttempted = try JSONEncoder().encode(PendingEmissionState.pending(deliveryAttempts: 0, lastAttemptAt: nil))
        XCTAssertEqual(String(decoding: neverAttempted, as: UTF8.self), #"{"pending":{"deliveryAttempts":0}}"#)
    }

    @MainActor
    func testStoredEmissionWithLegacyStateReplaysWithItsOriginalAttemptCount() async throws {
        let boxID = UUID()
        let repository = ComposerDraftRepository(rootURL: rootURL)
        let store = PendingEmissionStore(repository: repository)
        await store.activate(boxID: boxID)
        var draft = ComposerDraft.empty
        ComposerDraftReducer.reduce(&draft, .setText("stuck"))
        let emission = try await store.enqueue(
            draft: draft,
            text: "stuck",
            origin: .typed,
            diarized: false,
            boxID: boxID
        )
        let sentAt = Date(timeIntervalSince1970: 1_500)
        await store.markDeliveryAttempt(id: emission.id, at: sentAt)

        // Rewrite the persisted manifest in the pre-collapse encoding, reusing the
        // encoder's own numbers so the fixture matches what a real device holds.
        let url = await repository.pendingManifestURL(boxID: boxID)
        var manifest = try XCTUnwrap(
            JSONSerialization.jsonObject(with: try Data(contentsOf: url)) as? [String: Any]
        )
        var emissions = try XCTUnwrap(manifest["emissions"] as? [[String: Any]])
        let state = try XCTUnwrap(emissions[0]["state"] as? [String: Any])
        let pendingPayload = try XCTUnwrap(state["pending"] as? [String: Any])
        emissions[0]["state"] = [
            "awaitingReceipt": [
                "attempt": try XCTUnwrap(pendingPayload["deliveryAttempts"]),
                "sentAt": try XCTUnwrap(pendingPayload["lastAttemptAt"])
            ]
        ]
        manifest["emissions"] = emissions
        try JSONSerialization.data(withJSONObject: manifest).write(to: url)

        let relaunched = PendingEmissionStore(repository: repository)
        await relaunched.activate(boxID: boxID)
        XCTAssertEqual(
            relaunched.pending.map(\.state),
            [.pending(deliveryAttempts: 1, lastAttemptAt: sentAt)]
        )
        XCTAssertEqual(relaunched.deliveries.map(\.id), [emission.id])

        await relaunched.markDeliveryAttempt(id: emission.id, at: Date(timeIntervalSince1970: 1_600))
        XCTAssertEqual(
            relaunched.pending.first?.state,
            .pending(deliveryAttempts: 2, lastAttemptAt: Date(timeIntervalSince1970: 1_600))
        )
    }

    @MainActor
    func testMarkDeliveryAttemptIncrementsPendingAndLeavesRejectedAlone() async throws {
        let boxID = UUID()
        let store = PendingEmissionStore(repository: ComposerDraftRepository(rootURL: rootURL))
        await store.activate(boxID: boxID)
        var draft = ComposerDraft.empty
        ComposerDraftReducer.reduce(&draft, .setText("hello"))
        let emission = try await store.enqueue(
            draft: draft,
            text: "hello",
            origin: .typed,
            diarized: false,
            boxID: boxID
        )
        XCTAssertEqual(store.pending.first?.state, .pending(deliveryAttempts: 0, lastAttemptAt: nil))

        await store.markDeliveryAttempt(id: emission.id, at: Date(timeIntervalSince1970: 30))
        XCTAssertEqual(
            store.pending.first?.state,
            .pending(deliveryAttempts: 1, lastAttemptAt: Date(timeIntervalSince1970: 30))
        )
        await store.markDeliveryAttempt(id: emission.id, at: Date(timeIntervalSince1970: 31))
        XCTAssertEqual(
            store.pending.first?.state,
            .pending(deliveryAttempts: 2, lastAttemptAt: Date(timeIntervalSince1970: 31))
        )

        await store.handleReceipt(NativeEmissionReceipt(
            emissionID: emission.id,
            disposition: .rejected,
            reason: "offline"
        ))
        await store.markDeliveryAttempt(id: emission.id, at: Date(timeIntervalSince1970: 32))
        XCTAssertEqual(store.pending.first?.state, .rejected(reason: "offline"))

        await store.retry(id: emission.id)
        XCTAssertEqual(store.pending.first?.state, .pending(deliveryAttempts: 0, lastAttemptAt: nil))
    }

    func testRedeliveryBackoffLengthensWithAttemptsAndNeverCaps() {
        XCTAssertEqual(EmissionRedeliveryPolicy.retryDelay(afterDeliveryAttempts: 1), 10)
        XCTAssertEqual(EmissionRedeliveryPolicy.retryDelay(afterDeliveryAttempts: 2), 30)
        XCTAssertEqual(EmissionRedeliveryPolicy.retryDelay(afterDeliveryAttempts: 3), 60)
        XCTAssertEqual(EmissionRedeliveryPolicy.retryDelay(afterDeliveryAttempts: 4), 120)
        XCTAssertEqual(EmissionRedeliveryPolicy.retryDelay(afterDeliveryAttempts: 99), 120)
        // Never delivered: the ordinary delivery path handles it, unthrottled.
        XCTAssertEqual(EmissionRedeliveryPolicy.retryDelay(afterDeliveryAttempts: 0), 0)
    }

    func testRedeliveryWaitsOutTheBackoffThenFiresAtEachThreshold() {
        let sent = Date(timeIntervalSince1970: 1_000)
        XCTAssertFalse(EmissionRedeliveryPolicy.shouldRedeliver(
            deliveryAttempts: 1,
            lastAttemptAt: sent,
            now: sent.addingTimeInterval(9)
        ))
        XCTAssertTrue(EmissionRedeliveryPolicy.shouldRedeliver(
            deliveryAttempts: 1,
            lastAttemptAt: sent,
            now: sent.addingTimeInterval(10)
        ))
        XCTAssertFalse(EmissionRedeliveryPolicy.shouldRedeliver(
            deliveryAttempts: 2,
            lastAttemptAt: sent,
            now: sent.addingTimeInterval(29)
        ))
        XCTAssertTrue(EmissionRedeliveryPolicy.shouldRedeliver(
            deliveryAttempts: 2,
            lastAttemptAt: sent,
            now: sent.addingTimeInterval(30)
        ))
        XCTAssertFalse(EmissionRedeliveryPolicy.shouldRedeliver(
            deliveryAttempts: 7,
            lastAttemptAt: sent,
            now: sent.addingTimeInterval(119)
        ))
        XCTAssertTrue(EmissionRedeliveryPolicy.shouldRedeliver(
            deliveryAttempts: 7,
            lastAttemptAt: sent,
            now: sent.addingTimeInterval(120)
        ))
    }

    func testRedeliveryIgnoresUndeliveredAndRejectedAndBackwardsClocks() {
        let sent = Date(timeIntervalSince1970: 1_000)
        XCTAssertFalse(EmissionRedeliveryPolicy.shouldRedeliver(
            state: .pending(deliveryAttempts: 0, lastAttemptAt: nil),
            now: sent.addingTimeInterval(10_000)
        ))
        XCTAssertFalse(EmissionRedeliveryPolicy.shouldRedeliver(
            state: .rejected(reason: "offline"),
            now: sent.addingTimeInterval(10_000)
        ))
        XCTAssertFalse(EmissionRedeliveryPolicy.shouldRedeliver(
            deliveryAttempts: 1,
            lastAttemptAt: sent,
            now: sent.addingTimeInterval(-600)
        ))
    }

    func testEmissionStuckSinceBeforeASleepRedeliversImmediatelyOnWake() {
        let attemptedBeforeSleep = Date(timeIntervalSince1970: 1_000)
        let wake = attemptedBeforeSleep.addingTimeInterval(8 * 60 * 60)
        XCTAssertTrue(EmissionRedeliveryPolicy.shouldRedeliver(
            state: .pending(deliveryAttempts: 5, lastAttemptAt: attemptedBeforeSleep),
            now: wake
        ))
        XCTAssertTrue(EmissionRedeliveryPolicy.isLongPending(
            createdAt: attemptedBeforeSleep,
            now: wake
        ))
    }

    func testLongPendingAgeAppliesOnlyToPendingEmissions() {
        let created = Date(timeIntervalSince1970: 1_000)
        XCTAssertFalse(EmissionRedeliveryPolicy.isLongPending(
            createdAt: created,
            now: created.addingTimeInterval(29)
        ))
        XCTAssertTrue(EmissionRedeliveryPolicy.isLongPending(
            createdAt: created,
            now: created.addingTimeInterval(30)
        ))

        var emission = PendingEmission(
            id: UUID(),
            boxID: UUID(),
            draft: .empty,
            text: "hello",
            origin: .typed,
            diarized: false,
            state: .pending(deliveryAttempts: 1, lastAttemptAt: created),
            createdAt: created
        )
        XCTAssertTrue(EmissionRedeliveryPolicy.isLongPending(
            emission,
            now: created.addingTimeInterval(120)
        ))
        emission.state = .rejected(reason: "offline")
        XCTAssertFalse(EmissionRedeliveryPolicy.isLongPending(
            emission,
            now: created.addingTimeInterval(120)
        ))
    }
}

private func XCTAssertThrowsErrorAsync(
    _ expression: () async throws -> Void,
    file: StaticString = #filePath,
    line: UInt = #line
) async {
    do {
        try await expression()
        XCTFail("Expected expression to throw", file: file, line: line)
    } catch {
        // Expected.
    }
}
