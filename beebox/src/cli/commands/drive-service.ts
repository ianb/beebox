/**
 * The Drive service every `bbx drive` subcommand needs, or a clean exit telling
 * the boxholder how to connect Google. Its own module so the subcommand files
 * can share it without importing each other.
 */

import { getGoogleAuth } from "../../connectors/google-auth.js";
import { createGoogleAuthService } from "../../services/google-auth.js";
import { createGoogleDriveService } from "../../services/google-drive.js";
import type { GoogleDriveService } from "../../services/google-drive.js";

export async function requireDriveService(boxRoot: string): Promise<GoogleDriveService> {
  const auth = await getGoogleAuth(boxRoot);
  if (!auth) {
    console.error("Google auth not configured. Run: bbx google-auth");
    process.exit(1);
  }
  const authService = createGoogleAuthService(auth, { boxRoot });
  return createGoogleDriveService(authService);
}
