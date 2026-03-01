/**
 * Admin routes — owner-only endpoints for system management.
 *
 * GET  /api/admin/claude-status — check Claude Code auth status
 * POST /api/admin/claude-login  — start Claude Code login, return auth URL
 * POST /api/admin/claude-logout — log out Claude Code
 */

import { spawn, execFile } from "node:child_process";
import type { FastifyInstance } from "fastify";
import { isOwner } from "../auth.js";

export async function registerAdminRoutes(server: FastifyInstance) {
  // All admin routes require owner auth
  server.addHook("preHandler", async (request, reply) => {
    if (!isOwner(request)) {
      return reply.status(403).send({ error: "Owner access required" });
    }
  });

  server.get("/api/admin/claude-status", async () => {
    return new Promise<Record<string, unknown>>((resolve) => {
      execFile("claude", ["auth", "status"], { timeout: 10000 }, (err, stdout) => {
        // claude auth status exits 1 when not logged in, but still outputs JSON to stdout
        const output = stdout || "";
        try {
          const parsed = JSON.parse(output);
          resolve(parsed);
        } catch {
          const result = err
            ? { loggedIn: false, error: err.message }
            : { loggedIn: false, raw: output };
          resolve(result);
        }
      });
    });
  });

  // Track the active login process so we don't spawn multiple
  let activeLogin: { process: ReturnType<typeof spawn>; authUrl: string | null } | null = null;

  server.post("/api/admin/claude-login", async (_request, reply) => {
    if (activeLogin) {
      // Return existing URL if we have one
      if (activeLogin.authUrl) {
        return { authUrl: activeLogin.authUrl, status: "waiting" };
      }
      return { status: "starting" };
    }

    const ownerEmail = process.env.CB_OWNER_EMAIL;
    const args = ["auth", "login"];
    if (ownerEmail) {
      args.push("--email", ownerEmail);
    }

    const child = spawn("claude", args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, BROWSER: "echo" },
    });

    let authUrl: string | null = null;
    let output = "";

    activeLogin = { process: child, authUrl: null };

    child.stdout.on("data", (data: Buffer) => {
      output += data.toString();
      // Look for the OAuth URL in the output
      const urlMatch = output.match(/(https:\/\/claude\.ai\/oauth\/authorize\S+)/);
      if (urlMatch && !authUrl) {
        authUrl = urlMatch[1]!;
        activeLogin!.authUrl = authUrl;
      }
    });

    child.stderr.on("data", (data: Buffer) => {
      output += data.toString();
      const urlMatch = output.match(/(https:\/\/claude\.ai\/oauth\/authorize\S+)/);
      if (urlMatch && !authUrl) {
        authUrl = urlMatch[1]!;
        activeLogin!.authUrl = authUrl;
      }
    });

    child.on("close", () => {
      activeLogin = null;
    });

    // Wait up to 10 seconds for the URL to appear
    for (let i = 0; i < 20; i++) {
      if (authUrl) {
        return { authUrl, status: "waiting" };
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    // If we still don't have a URL, return what we have
    if (authUrl) {
      return { authUrl, status: "waiting" };
    }

    // Kill the process if it didn't produce a URL
    child.kill();
    activeLogin = null;
    return reply.status(500).send({ error: "Failed to get auth URL", output });
  });

  server.post("/api/admin/claude-logout", async () => {
    return new Promise<{ success: boolean; error?: string }>((resolve) => {
      execFile("claude", ["auth", "logout"], { timeout: 10000 }, (err) => {
        if (err) {
          resolve({ success: false, error: err.message });
        } else {
          resolve({ success: true });
        }
      });
    });
  });
}
