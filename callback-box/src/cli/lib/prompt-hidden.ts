/**
 * Shared no-echo secret prompt for CLI commands (`cb auth`, `cb pub setup`):
 * raw-mode keystroke capture rather than readline's undocumented output-muting
 * private API. Handles Enter, Ctrl-C, and backspace; every other keystroke is
 * appended verbatim. A secret never goes on argv (shell history / process
 * list) — prompting is the only interactive path.
 */

class NoTtyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoTtyError";
  }
}

class PromptCancelledError extends Error {
  constructor() {
    super("Secret entry cancelled.");
    this.name = "PromptCancelledError";
  }
}

/** Prompt for a secret without echoing. Rejects {@link NoTtyError} (with `noTtyMessage`) off a TTY. */
export function promptHidden({ label, noTtyMessage }: { label: string; noTtyMessage: string }): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      reject(new NoTtyError(noTtyMessage));
      return;
    }
    process.stdout.write(label);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let input = "";

    const cleanup = (): void => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
    };
    const CTRL_C_CHARCODE = 3;
    const BACKSPACE_CHARCODE = 127;
    const onData = (chunk: string): void => {
      for (const char of chunk) {
        const code = char.codePointAt(0);
        if (char === "\n" || char === "\r") {
          cleanup();
          process.stdout.write("\n");
          resolve(input);
          return;
        }
        if (code === CTRL_C_CHARCODE) {
          cleanup();
          process.stdout.write("\n");
          reject(new PromptCancelledError());
          return;
        }
        if (code === BACKSPACE_CHARCODE || char === "\b") {
          input = input.slice(0, -1);
          continue;
        }
        input += char;
      }
    };
    stdin.on("data", onData);
  });
}
