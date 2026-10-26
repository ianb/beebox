/** Argument-array restic invocation; password material is read from a protected file. */
import { execa } from "execa";

export interface ResticOptions { repository: string; passwordFile: string; args: string[]; env?: NodeJS.ProcessEnv }
export interface ResticOutput { stdout: string; stderr: string }

export async function runRestic({ repository, passwordFile, args, env }: ResticOptions): Promise<ResticOutput> {
  try {
    const result = await execa("restic", ["--repo", repository, "--password-file", passwordFile, ...args], { ...(env === undefined ? {} : { env }), reject: false });
    if (result.exitCode !== 0) throw new ResticCommandError({ stage: args[0] ?? "command", exitCode: result.exitCode ?? 1, detail: result.stderr });
    return { stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    if (error instanceof ResticCommandError) throw error;
    throw new ResticUnavailableError(error);
  }
}

export class ResticCommandError extends Error {
  readonly stage: string;
  readonly exitCode: number;
  readonly detail: string;
  constructor({ stage, exitCode, detail }: { stage: string; exitCode: number; detail: string }) {
    super(`restic ${stage} failed (exit ${exitCode}): ${detail.trim()}`); this.name = "ResticCommandError";
    this.stage = stage; this.exitCode = exitCode; this.detail = detail;
  }
}
export class ResticUnavailableError extends Error {
  constructor(cause: unknown) { super("restic could not be started; install restic and ensure it is on PATH", { cause }); this.name = "ResticUnavailableError"; }
}
