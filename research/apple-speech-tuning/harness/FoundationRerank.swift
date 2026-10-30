// Second pass over SpeechTranscriber output with Apple's on-device Foundation
// Model. Two modes:
//   pick: for each phrase where the transcriber reported alternatives, the
//         model picks one (guided generation, so it cannot invent words).
//   edit: the model rewrites the transcript, fixing likely recognition
//         errors, with the alternatives shown as hints.
//
// Build: swiftc -O -parse-as-library -target arm64-apple-macos26.0 FoundationRerank.swift -o .build/foundation-rerank
// Run:   foundation-rerank pick|edit <st.alternatives.jsonl> <out.jsonl>

import Foundation
import FoundationModels

struct Input: Decodable {
    var id: String
    var text: String
    var alternatives: [[String]]?
    var elapsedSeconds: Double
    var error: String?
}

struct Output: Encodable {
    var id: String
    var config: String
    var text: String
    var elapsedSeconds: Double
    var rerankSeconds: Double
    var error: String?
}

@Generable
struct Picks {
    @Guide(description: "For each numbered uncertain spot, in order, the index (0-based) of the option that is most likely what the speaker said.")
    var choices: [Int]
}

@Generable
struct Corrected {
    @Guide(description: "The full corrected transcript, and nothing else.")
    var transcript: String
}

let instructions = """
You correct automatic speech recognition. The speaker is talking spontaneously, so keep \
their words, hesitations, and grammar; change only what the recognizer most likely misheard.
"""

func pickPrompt(_ alts: [[String]]) -> (String, [Int]) {
    var parts: [String] = []
    var uncertain: [Int] = []
    for (i, options) in alts.enumerated() {
        let distinct = Array(NSOrderedSet(array: options.map { $0.trimmingCharacters(in: .whitespaces) })) as? [String] ?? []
        if distinct.count > 1 {
            uncertain.append(i)
            let listed = distinct.enumerated().map { "\($0.offset)) \($0.element)" }.joined(separator: " | ")
            parts.append("[spot \(uncertain.count): \(listed)]")
        } else {
            parts.append(options.first ?? "")
        }
    }
    let prompt = """
    Transcript with \(uncertain.count) uncertain spots. Each spot lists the recognizer's options:

    \(parts.joined(separator: " "))

    For each spot, give the index of the option the speaker most likely said.
    """
    return (prompt, uncertain)
}

func editPrompt(_ input: Input) -> String {
    var hints: [String] = []
    for options in input.alternatives ?? [] {
        let distinct = Array(Set(options.map { $0.trimmingCharacters(in: .whitespaces) }))
        if distinct.count > 1 {
            hints.append(distinct.joined(separator: " / "))
        }
    }
    return """
    Transcript:
    \(input.text)

    The recognizer was unsure between these readings:
    \(hints.map { "- \($0)" }.joined(separator: "\n"))

    Make the smallest changes that fix clear recognition errors. Do not summarize, reorder, or remove hesitations.
    """
}

@main
struct Main {
    static func main() async {
        let args = Array(CommandLine.arguments.dropFirst())
        guard args.count == 3, let mode = ["pick", "edit"].first(where: { $0 == args[0] }) else {
            FileHandle.standardError.write("usage: foundation-rerank pick|edit <in.jsonl> <out.jsonl>\n".data(using: .utf8)!)
            exit(2)
        }
        guard case .available = SystemLanguageModel.default.availability else {
            FileHandle.standardError.write("Foundation Model unavailable: \(SystemLanguageModel.default.availability)\n".data(using: .utf8)!)
            exit(1)
        }
        let lines = (try? String(contentsOfFile: args[1], encoding: .utf8))?.split(separator: "\n") ?? []
        FileManager.default.createFile(atPath: args[2], contents: nil)
        let out = FileHandle(forWritingAtPath: args[2])!
        for (n, line) in lines.enumerated() {
            guard let input = try? JSONDecoder().decode(Input.self, from: Data(line.utf8)) else { continue }
            var record = Output(id: input.id, config: "st.alternatives+fm-\(mode)", text: input.text, elapsedSeconds: input.elapsedSeconds, rerankSeconds: 0)
            let start = Date()
            do {
                let session = LanguageModelSession(instructions: instructions)
                let options = GenerationOptions(sampling: .greedy)
                if mode == "pick" {
                    let alts = input.alternatives ?? []
                    let (prompt, uncertain) = pickPrompt(alts)
                    if uncertain.isEmpty == false {
                        let picks = try await session.respond(to: prompt, generating: Picks.self, options: options).content
                        var chosen = alts.map { $0.first ?? "" }
                        for (k, phrase) in uncertain.enumerated() {
                            let distinct = Array(NSOrderedSet(array: alts[phrase].map { $0.trimmingCharacters(in: .whitespaces) })) as? [String] ?? []
                            if k < picks.choices.count, picks.choices[k] >= 0, picks.choices[k] < distinct.count {
                                // Keep the original's leading space so phrases still join.
                                let lead = alts[phrase].first?.hasPrefix(" ") == true ? " " : ""
                                chosen[phrase] = lead + distinct[picks.choices[k]]
                            }
                        }
                        record.text = chosen.joined().trimmingCharacters(in: .whitespaces)
                    }
                } else {
                    // Guided generation keeps the reply to the transcript; a
                    // plain reply tends to echo the prompt around it.
                    record.text = try await session.respond(to: editPrompt(input), generating: Corrected.self, options: options).content.transcript
                }
            } catch {
                // Guardrail refusals and context overflows keep the original.
                record.error = nil
                record.text = input.text
                FileHandle.standardError.write("\(input.id): kept original (\(error))\n".data(using: .utf8)!)
            }
            record.rerankSeconds = Date().timeIntervalSince(start)
            record.elapsedSeconds += record.rerankSeconds
            out.write(try! JSONEncoder().encode(record))
            out.write("\n".data(using: .utf8)!)
            FileHandle.standardError.write("[\(n + 1)/\(lines.count)] \(input.id) \(String(format: "%.1f", record.rerankSeconds))s\n".data(using: .utf8)!)
        }
        try? out.close()
    }
}
