/** Every way the conversion driver refuses, one class per failure. */

export class DriverError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "DriverError";
  }
}

export class ToolLaunchError extends DriverError {
  public constructor(command: { cmd: string; args: readonly string[]; cause: string }) {
    super(`could not run ${command.cmd} ${command.args.slice(0, 3).join(" ")}: ${command.cause}`);
    this.name = "ToolLaunchError";
  }
}

export class ToolOutputError extends DriverError {
  /** `what` names the tool and where it ran, e.g. "eslint from beebox". */
  public constructor(failure: { what: readonly string[]; output: string }) {
    super(`${failure.what.join(" ")} printed no result it can read: ${failure.output.slice(-800)}`);
    this.name = "ToolOutputError";
  }
}

const USAGE = "usage: doctest-convert prepare <dir> | verify|check|revert <dir|file>... | slots | dispatch <dir|file>... --model luna|haiku | progress";

/** The command line is wrong; the CLI prints the usage line after it. */
export class UsageError extends DriverError {
  public constructor(problem: string) {
    super(`${problem}\n${USAGE}`);
    this.name = "UsageError";
  }
}

export class PrepareArgsError extends UsageError {
  public constructor() {
    super("prepare takes one directory");
    this.name = "PrepareArgsError";
  }
}

export class VerifyArgsError extends UsageError {
  public constructor() {
    super("verify takes directories or files");
    this.name = "VerifyArgsError";
  }
}

export class NothingConvertedError extends UsageError {
  public constructor(paths: readonly string[]) {
    super(`no converted file under ${paths.join(" ")}`);
    this.name = "NothingConvertedError";
  }
}

export class UnknownCommandError extends UsageError {
  public constructor(command: string | undefined) {
    super(`unknown command ${command ?? "(none)"}`);
    this.name = "UnknownCommandError";
  }
}

export class StateFileError extends DriverError {
  public constructor(file: string, detail: string) {
    super(`${file}: ${detail}`);
    this.name = "StateFileError";
  }
}

export class NoTestRootError extends DriverError {
  public constructor(file: string) {
    super(`${file}: no test root in bin/test-roots.ts contains it`);
    this.name = "NoTestRootError";
  }
}

export class SlotBusyError extends DriverError {
  public constructor(dir: string) {
    super(`every slot in ${dir} is in use or missing; run \`slots\` to create them, or remove a stale slot-N.lock`);
    this.name = "SlotBusyError";
  }
}

export class NothingToDispatchError extends DriverError {
  public constructor(paths: readonly string[]) {
    super(`nothing to dispatch: no converted, unverified file under ${paths.join(" ")}`);
    this.name = "NothingToDispatchError";
  }
}

export class ModelArgError extends UsageError {
  public constructor(model: string | undefined) {
    super(`--model must be luna or haiku, not ${model ?? "(none)"}`);
    this.name = "ModelArgError";
  }
}

export class LockTimeoutError extends DriverError {
  public constructor(path: string) {
    super(`gave up waiting for ${path}; if no driver is running, remove it`);
    this.name = "LockTimeoutError";
  }
}

export class BatchInUseError extends DriverError {
  public constructor(files: readonly string[]) {
    super(`another dispatch holds these files: ${files.join(" ")}`);
    this.name = "BatchInUseError";
  }
}
