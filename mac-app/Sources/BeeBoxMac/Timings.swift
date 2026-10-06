import Foundation

/// Past start and stop durations on this Mac, so the menu can say what to
/// expect. Kept in the state folder; the last few runs of each kind count.
enum TimedOperation: String, Codable, CaseIterable {
    /// A start that loads the image or creates the box.
    case firstStart
    case start
    case stop

    /// Used until this Mac has a measurement. Deliberately slow: the first
    /// measurements came from a fast machine, and a stop with a browser
    /// attached can take over 30 seconds.
    var defaultEstimate: TimeInterval {
        switch self {
        case .firstStart: 120
        case .start: 45
        case .stop: 40
        }
    }
}

struct Timings: Codable {
    private static let keep = 5
    private var runs: [TimedOperation: [TimeInterval]] = [:]

    static func load() -> Timings {
        guard let data = try? Data(contentsOf: Paths.timings),
              let timings = try? JSONDecoder().decode(Timings.self, from: data)
        else { return Timings() }
        return timings
    }

    /// The median of recent runs, or the default before any.
    func estimate(_ operation: TimedOperation) -> (seconds: TimeInterval, measured: Bool) {
        guard let recent = runs[operation], !recent.isEmpty else { return (operation.defaultEstimate, false) }
        let sorted = recent.sorted()
        return (sorted[sorted.count / 2], true)
    }

    /// The fastest and slowest recent runs. Stops are bimodal (well under a
    /// second idle, over 30 seconds with a client attached), so a single
    /// "usually" figure misleads.
    func range(_ operation: TimedOperation) -> ClosedRange<TimeInterval>? {
        guard let recent = runs[operation], let low = recent.min(), let high = recent.max() else { return nil }
        return low...high
    }

    mutating func record(_ operation: TimedOperation, seconds: TimeInterval) {
        runs[operation, default: []].append(seconds)
        runs[operation] = Array(runs[operation]!.suffix(Self.keep))
        do {
            try JSONEncoder().encode(self).write(to: Paths.timings, options: .atomic)
        } catch {
            NSLog("beebox: could not save timings: \(error)")
        }
    }
}

/// "0:07", "1:32".
func formatDuration(_ seconds: TimeInterval) -> String {
    let whole = Int(seconds.rounded())
    return String(format: "%d:%02d", whole / 60, whole % 60)
}
