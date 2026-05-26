import { DropboxClient } from "callback-dropbox/client";
import { getCredentials } from "./storage";

export async function createDropboxClient(): Promise<DropboxClient | null> {
  const creds = await getCredentials();
  if (!creds) return null;

  return new DropboxClient({
    url: creds.workerUrl,
    apiKey: creds.apiKey,
    channelKey: creds.channelKey,
  });
}
