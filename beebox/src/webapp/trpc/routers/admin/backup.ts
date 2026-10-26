/** Owner-only setup and local status for encrypted Restic backups. */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { backupAttemptStatus } from "../../../../core/box-backup/attempt.js";
import { createManagedBackupPasswordFile } from "../../../../core/box-backup/admin-config.js";
import { MissingBackupConfigError, readBackupConfig, updateBackupSchedule } from "../../../../core/box-backup/config.js";
import { configureBackup } from "../../../../core/box-backup/run/backup.js";
import { getBackupStatus, NotAGitBoxError } from "../../../../core/box/backup-status.js";
import { onUnitHost } from "../../../../lib/unit-host.js";
import { authenticatedOwnerProcedure, ownerProcedure } from "../../procedures.js";

const retentionSchema = z.object({
  daily: z.number().int().positive().max(365),
  weekly: z.number().int().positive().max(104),
  monthly: z.number().int().positive().max(120),
}).strict();

const scheduleSchema = z.enum(["daily", "off"]);
const recoveryPasswordSchema = z.string().min(1).max(4096).refine(
  (value) => value === value.trim() && !/[\n\r]/.test(value),
  "Recovery password must be one line with no leading or trailing whitespace.",
);

export const backupAdminProcedures = {
  /** Git/annex backup posture for the existing Admin Backup section. */
  backupStatus: ownerProcedure.query(async ({ ctx }) => {
    try {
      return { repo: await getBackupStatus(ctx.boxRoot) };
    } catch (error) {
      if (error instanceof NotAGitBoxError) return { repo: null };
      throw error;
    }
  }),

  /** Reads machine-owned state only; never contacts the Restic repository. */
  encryptedBackupStatus: authenticatedOwnerProcedure.query(async ({ ctx }) => {
    let config;
    try {
      config = await readBackupConfig({ boxRoot: ctx.boxRoot });
    } catch (error) {
      if (error instanceof MissingBackupConfigError) {
        return {
          boxRoot: ctx.boxRoot,
          boxSlug: ctx.boxSlug,
          installKind: backupInstallKind(),
          configured: false,
          repository: null,
          retention: null,
          schedule: "daily" as const,
          newestVerified: null,
          lastAttempt: null,
          maintenance: null,
        };
      }
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Encrypted backup configuration is unreadable." });
    }
    const attempt = await backupAttemptStatus({ boxRoot: ctx.boxRoot });
    return {
      boxRoot: ctx.boxRoot,
      boxSlug: ctx.boxSlug,
      installKind: backupInstallKind(),
      configured: true,
      repository: redactRepositoryCredentials(config.repository),
      retention: config.retention,
      schedule: config.schedule,
      newestVerified: attempt.newestVerified,
      lastAttempt: attempt.lastAttempt,
      maintenance: attempt.maintenance,
    };
  }),

  configureEncryptedBackup: authenticatedOwnerProcedure
    .input(z.object({
      repository: z.string().trim().min(1).max(2048),
      password: recoveryPasswordSchema,
      retention: retentionSchema.optional(),
    }).strict())
    .mutation(async ({ input, ctx }) => {
      try {
        try {
          await readBackupConfig({ boxRoot: ctx.boxRoot });
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Encrypted backups are already configured. Use the host CLI to change the repository." });
        } catch (error) {
          if (!(error instanceof MissingBackupConfigError)) throw error;
        }
        if (/[a-z][\d+.a-z-]*:\/\/[^/@]+@/i.test(input.repository)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Put repository credentials in the host's credential store instead of the repository address." });
        }
        const managed = await createManagedBackupPasswordFile({ boxRoot: ctx.boxRoot, password: input.password });
        try {
          const configured = await configureBackup({
            boxRoot: ctx.boxRoot,
            repository: input.repository,
            passwordFile: managed.passwordFile,
            timeoutMs: 120_000,
            ...(input.retention === undefined ? {} : { retention: input.retention }),
          });
          return { success: true as const, configured: true as const, schedule: configured.schedule };
        } catch (_error) {
          try { await managed.cleanup(); }
          catch (_cleanupError) {
            throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Setup failed and cleanup of its temporary recovery file could not be confirmed." });
          }
          throw new TRPCError({ code: "BAD_REQUEST", message: "Could not configure encrypted backups. Check the repository and recovery password." });
        }
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Encrypted backup configuration is unreadable." });
      }
    }),

  updateEncryptedBackupSchedule: authenticatedOwnerProcedure
    .input(z.object({ schedule: scheduleSchema }).strict())
    .mutation(async ({ input, ctx }) => {
      try {
        const config = await updateBackupSchedule({ boxRoot: ctx.boxRoot, schedule: input.schedule });
        return { success: true as const, schedule: config.schedule };
      } catch (_error) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Encrypted backups must be configured before changing the schedule." });
      }
    }),
};

function redactRepositoryCredentials(repository: string): string {
  return repository.replace(/([a-z][\d+.a-z-]*:\/\/)[^/@]*@/gi, "$1***@");
}

function backupInstallKind(): "unit-host" | "mac-app" | "docker" | "local" {
  if (onUnitHost()) return "unit-host";
  if (process.env.BBX_INSTALL_KIND === "mac-app") return "mac-app";
  if (process.env.BBX_INSTALL_KIND === "docker") return "docker";
  return "local";
}
