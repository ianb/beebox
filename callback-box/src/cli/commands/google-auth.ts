/**
 * cb google-auth — Set up or refresh Google OAuth2 credentials.
 *
 * Flow:
 * 1. Accept --client-id and --client-secret (or read from existing config)
 * 2. Start ephemeral local server on port 8976
 * 3. Open browser to Google's consent page
 * 4. Receive callback with auth code, exchange for tokens
 * 5. Save tokens to config/connectors/google.secret.json
 */

import { Command } from "commander";
import Fastify from "fastify";
import open from "open";
import { requireBoxRoot } from "../lib/paths.js";
import {
  loadGoogleSecret,
  saveGoogleSecret,
  createOAuth2Client,
  GOOGLE_SCOPES,
} from "../../connectors/google-auth.js";

export const googleAuthCommand = new Command("google-auth")
  .description("Set up Google OAuth2 credentials")
  .option("--client-id <id>", "Google OAuth2 client ID")
  .option("--client-secret <secret>", "Google OAuth2 client secret")
  .option("--reauth", "Force re-authorization even if tokens exist")
  .action(
    async (options: {
      clientId?: string;
      clientSecret?: string;
      reauth?: boolean;
    }) => {
      const boxRoot = await requireBoxRoot();

      // Load existing config or use provided values
      const existing = await loadGoogleSecret(boxRoot);
      const clientId = options.clientId || existing?.clientId;
      const clientSecret = options.clientSecret || existing?.clientSecret;

      if (!clientId || !clientSecret) {
        console.error(
          "Error: --client-id and --client-secret are required for first-time setup."
        );
        console.error(
          "Get these from Google Cloud Console → APIs & Services → Credentials."
        );
        process.exit(1);
      }

      // Check if already authorized
      if (existing?.refreshToken && !options.reauth) {
        console.log("Already authorized. Use --reauth to re-authorize.");
        return;
      }

      // Save client credentials immediately
      await saveGoogleSecret(boxRoot, { clientId, clientSecret });

      const oauth2Client = createOAuth2Client(clientId, clientSecret);

      const authUrl = oauth2Client.generateAuthUrl({
        access_type: "offline",
        scope: GOOGLE_SCOPES,
        prompt: "consent", // Always show consent to get refresh_token
      });

      const pageStyle = `
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                 display: flex; align-items: center; justify-content: center;
                 min-height: 100vh; background: #fafafa; color: #333; }
          .card { text-align: center; padding: 3rem; }
          .icon { font-size: 4rem; margin-bottom: 1rem; }
          h1 { font-size: 1.5rem; font-weight: 600; margin-bottom: 0.5rem; }
          p { color: #666; font-size: 0.95rem; }
        </style>`;

      const successPage = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Authorized</title>${pageStyle}</head>
        <body><div class="card">
          <div class="icon">\u2705</div>
          <h1>Authorization successful</h1>
          <p>You can close this tab and return to the terminal.</p>
        </div></body></html>`;

      const errorPage = (msg: string) =>
        `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Error</title>${pageStyle}</head>
        <body><div class="card">
          <div class="icon">\u274C</div>
          <h1>${msg}</h1>
          <p>Check the terminal for details.</p>
        </div></body></html>`;

      // Start ephemeral server to receive the callback
      const server = Fastify();

      const result = await new Promise<{ success: boolean; error?: string }>(
        (resolve) => {
          server.get(
            "/oauth/callback",
            async (request, reply) => {
              const { code, error } = request.query as {
                code?: string;
                error?: string;
              };

              if (error) {
                await reply.type("text/html").send(errorPage("Authorization denied"));
                resolve({ success: false, error: `Auth denied: ${error}` });
                return;
              }

              if (!code) {
                await reply.type("text/html").send(errorPage("No authorization code received"));
                resolve({ success: false, error: "No authorization code received" });
                return;
              }

              try {
                const { tokens } = await oauth2Client.getToken(code);

                const updates: Record<string, string> = {
                  clientId,
                  clientSecret,
                };
                if (tokens.refresh_token) {
                  updates.refreshToken = tokens.refresh_token;
                }
                if (tokens.access_token) {
                  updates.accessToken = tokens.access_token;
                }
                if (tokens.expiry_date) {
                  updates.tokenExpiry = new Date(
                    tokens.expiry_date
                  ).toISOString();
                }
                await saveGoogleSecret(boxRoot, updates);

                await reply.type("text/html").send(successPage);
                resolve({ success: true });
              } catch (err) {
                await reply.type("text/html").send(errorPage("Token exchange failed"));
                resolve({
                  success: false,
                  error: `Token exchange failed: ${(err as Error).message}`,
                });
              }
            }
          );

          server.listen({ port: 8976, host: "127.0.0.1" }).then(() => {
            console.log("Listening on http://localhost:8976/oauth/callback");
            console.log("Opening browser for Google authorization...\n");
            open(authUrl);
          });
        }
      );

      // Shut down the server
      await server.close();

      if (result.success) {
        console.log("\nGoogle OAuth2 credentials saved successfully.");
        console.log("Scopes authorized:");
        for (const scope of GOOGLE_SCOPES) {
          const shortName = scope.split("/").pop();
          console.log(`  - ${shortName}`);
        }
      } else {
        console.error(`\nAuthorization failed: ${result.error}`);
        process.exit(1);
      }
    }
  );
