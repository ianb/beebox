/** Filesystem classification for Browse; never guesses from an extension. */
import * as fs from "node:fs/promises";
import { TRPCError } from "@trpc/server";
import { resolveBoxNamespacePathOnDisk } from "../../../lib/box-namespace-resolve.js";
import { errnoCode } from "../../../lib/error-guards.js";

export async function getFileKind(boxRoot: string, inputPath: string): Promise<{ kind: "directory" | "file" | "missing" }> {
  if (inputPath === "" || inputPath === "/") return { kind: "directory" };
  const ns = await resolveBoxNamespacePathOnDisk({ boxRoot, rawPath: inputPath, mode: "read" });
  if (!ns.ok) throw new TRPCError({ code: "BAD_REQUEST", message: ns.reason === "display-form" ? ns.message : "Path is outside the box namespace" });
  try {
    const stat = await fs.stat(ns.resolved);
    if (stat.isDirectory()) return { kind: "directory" };
    if (stat.isFile()) return { kind: "file" };
    throw new TRPCError({ code: "BAD_REQUEST", message: "Path is not a file or directory" });
  } catch (error) {
    if (errnoCode(error) === "ENOENT" || errnoCode(error) === "ENOTDIR") return { kind: "missing" };
    throw error;
  }
}
