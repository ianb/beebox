/**
 * API client for the Callback Box backend.
 */

const API_BASE = "/api";

export interface StatusResponse {
  boxRoot: string;
  boxVersion: string;
  created: string;
  git: {
    staged: string[];
    modified: string[];
    untracked: string[];
    clean: boolean;
  };
  counts: {
    inbox: number;
    commands: number;
    questions: number;
    pendingQuestions: number;
  };
}

export interface CardInfo {
  path: string;
  relativePath: string;
  name: string;
  type: string;
  tagName: string;
  status?: string;
  prompt?: string;
  options?: string[];
}

export interface ListResponse {
  items: CardInfo[];
}

export interface CardResponse {
  path: string;
  tagName: string;
  status?: string;
  version: string;
  xml: string;
}

export interface LogEntry {
  hash: string;
  date: string;
  subject: string;
  body?: string;
  trailers?: Record<string, string>;
}

export interface LogResponse {
  entries: LogEntry[];
}

export interface ContextResponse {
  summary: string;
  pendingQuestions: Array<{
    path: string;
    prompt: string;
    options?: string[];
  }>;
  inboxCount: number;
  commandCount: number;
}

export interface CommandResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface CommandInfo {
  name: string;
  description: string;
  args: Array<{
    name: string;
    description: string;
    required: boolean;
    type: string;
  }>;
}

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || error.message || "Request failed");
  }

  return response.json();
}

export async function getStatus(): Promise<StatusResponse> {
  return fetchJson<StatusResponse>(`${API_BASE}/status`);
}

export async function getInbox(): Promise<ListResponse> {
  return fetchJson<ListResponse>(`${API_BASE}/inbox`);
}

export async function getCommands(): Promise<ListResponse> {
  return fetchJson<ListResponse>(`${API_BASE}/commands`);
}

export async function getQuestions(): Promise<ListResponse> {
  return fetchJson<ListResponse>(`${API_BASE}/questions`);
}

export async function getCard(path: string): Promise<CardResponse> {
  return fetchJson<CardResponse>(`${API_BASE}/card/${path}`);
}

export async function getLog(count = 10): Promise<LogResponse> {
  return fetchJson<LogResponse>(`${API_BASE}/log?count=${count}`);
}

export async function getContext(): Promise<ContextResponse> {
  return fetchJson<ContextResponse>(`${API_BASE}/context`);
}

export async function triggerWakeup(dryRun = false): Promise<{
  success: boolean;
  message: string;
  actions: string[];
}> {
  return fetchJson(`${API_BASE}/actions/wakeup`, {
    method: "POST",
    body: JSON.stringify({ dryRun }),
  });
}

export async function answerQuestion(
  questionPath: string,
  answer: string,
  selectedId?: string
): Promise<{ success: boolean; message: string; path: string }> {
  return fetchJson(`${API_BASE}/actions/answer`, {
    method: "POST",
    body: JSON.stringify({ questionPath, answer, selectedId }),
  });
}

export async function createCard(
  path: string,
  template: string,
  options?: {
    content?: string;
    prompt?: string;
    memo?: string;
    options?: string[];
  }
): Promise<{ success: boolean; path: string }> {
  return fetchJson(`${API_BASE}/actions/create`, {
    method: "POST",
    body: JSON.stringify({ path, template, ...options }),
  });
}

export async function createVoiceMemo(
  audioBlob: Blob
): Promise<{ success: boolean; path: string; audioPath: string }> {
  const formData = new FormData();
  formData.append("file", audioBlob, "recording.webm");

  const response = await fetch(`${API_BASE}/actions/create-voice-memo`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || error.message || "Request failed");
  }

  return response.json();
}

/**
 * Upload a file to temp storage and return the path.
 */
export async function uploadFile(
  blob: Blob,
  filename?: string
): Promise<{ success: boolean; path: string; mimetype: string; size: number }> {
  const formData = new FormData();
  formData.append("file", blob, filename ?? "upload");

  const response = await fetch(`${API_BASE}/upload`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || error.message || "Upload failed");
  }

  return response.json();
}

/**
 * Execute a command with streaming output.
 * @param command Command name
 * @param args Command arguments
 * @param onOutput Callback for streaming output lines
 * @returns Promise resolving to the command result
 */
export async function executeCommand(
  command: string,
  args: Record<string, unknown>,
  onOutput?: (text: string) => void
): Promise<CommandResult> {
  const response = await fetch(`${API_BASE}/commands/execute`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ command, args }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || "Command execution failed");
  }

  // Parse SSE stream
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("No response body");
  }

  const decoder = new TextDecoder();
  let result: CommandResult = { success: false, error: "No result received" };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const text = decoder.decode(value);
    const lines = text.split("\n");

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = JSON.parse(line.slice(6));
        if (data.type === "output" && data.text) {
          onOutput?.(data.text);
        } else if (data.type === "result") {
          result = {
            success: data.success,
            data: data.data,
            error: data.error,
          };
        }
      }
    }
  }

  return result;
}

/**
 * Execute a command synchronously (non-streaming).
 */
export async function executeCommandSync(
  command: string,
  args: Record<string, unknown>
): Promise<{ success: boolean; data?: unknown; error?: string; output: string[] }> {
  return fetchJson(`${API_BASE}/commands/execute-sync`, {
    method: "POST",
    body: JSON.stringify({ command, args }),
  });
}

/**
 * List available commands.
 */
export async function listCommands(): Promise<{ commands: CommandInfo[] }> {
  return fetchJson(`${API_BASE}/commands/list`);
}

/**
 * Get details for a specific command.
 */
export async function getCommandInfo(name: string): Promise<CommandInfo> {
  return fetchJson(`${API_BASE}/commands/${name}`);
}
