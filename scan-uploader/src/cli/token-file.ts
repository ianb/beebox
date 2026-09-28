/**
 * Writes the scan-upload bearer token to disk: parent directory 0700, file
 * 0600. Called only after the config write has already succeeded
 * (`configure.ts`). For a brand-new target this ordering means a crash
 * between the two writes leaves the recoverable gap state "config points at
 * a token file that doesn't exist yet". Reconfiguring an EXISTING target
 * instead overwrites an already-present token file, so the same crash there
 * leaves the previous token in place rather than a missing one — a milder
 * gap (the old credential still works unless it was separately revoked).
 */

import { writeFileAtomic } from "./atomic-write.js";

export const TOKEN_DIR_MODE = 0o700;
export const TOKEN_FILE_MODE = 0o600;

export async function writeTokenFile(tokenPath: string, token: string): Promise<void> {
  await writeFileAtomic(tokenPath, {
    contents: `${token}\n`,
    mode: TOKEN_FILE_MODE,
    dirMode: TOKEN_DIR_MODE,
  });
}
