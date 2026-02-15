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
  /** Subdirectory within the parent dir (e.g., "news" for inbox/news/) */
  subdir?: string;
}

export interface ListResponse {
  items: CardInfo[];
}

/**
 * Element node structure from parsed XML.
 */
export interface ElementNode {
  tagName: string;
  attrs: Record<string, string>;
  text?: string;
  children?: ElementNode[];
}

export interface CardResponse {
  path: string;
  tagName: string;
  status?: string;
  version: string;
  xml: string;
  element?: ElementNode;
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

export type PatchOp =
  | { op: "set-attr"; path?: string; attr: string; value: string }
  | { op: "remove-attr"; path?: string; attr: string }
  | { op: "set-text"; path: string; value: string }
  | { op: "append-child"; path?: string; xml: string }
  | { op: "remove-child"; path: string; index: number };

export async function patchCard(
  cardPath: string,
  ops: PatchOp[]
): Promise<CardResponse> {
  return fetchJson<CardResponse>(`${API_BASE}/card/${cardPath}`, {
    method: "PATCH",
    body: JSON.stringify({ ops }),
  });
}

export async function getLog(count = 10): Promise<LogResponse> {
  return fetchJson<LogResponse>(`${API_BASE}/log?count=${count}`);
}

export async function getContext(): Promise<ContextResponse> {
  return fetchJson<ContextResponse>(`${API_BASE}/context`);
}

export interface NewsStatusResponse {
  /** Items in box/inbox/news/ awaiting triage */
  inbox: number;
  /** Items in box/pool/news/ ready for brief creation */
  pool: number;
  /** Items in store/archive/news/ that have been used */
  archive: number;
  /** Items in store/trash/news/ that were skipped */
  trash: number;
}

export async function getNewsStatus(): Promise<NewsStatusResponse> {
  return fetchJson<NewsStatusResponse>(`${API_BASE}/news-status`);
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

export interface AnswerQuestionParams {
  questionPath: string;
  answer: string;
  selectedId?: string;
}

export async function answerQuestion(
  params: AnswerQuestionParams
): Promise<{ success: boolean; message: string; path: string }> {
  const { questionPath, answer, selectedId } = params;
  return fetchJson(`${API_BASE}/actions/answer`, {
    method: "POST",
    body: JSON.stringify({ questionPath, answer, selectedId }),
  });
}

export interface CreateCardParams {
  path: string;
  template: string;
  content?: string;
  prompt?: string;
  memo?: string;
  options?: string[];
}

export async function createCard(
  params: CreateCardParams
): Promise<{ success: boolean; path: string }> {
  const { path, template, content, prompt, memo, options } = params;
  return fetchJson(`${API_BASE}/actions/create`, {
    method: "POST",
    body: JSON.stringify({ path, template, content, prompt, memo, options }),
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
 */
export interface ExecuteCommandParams {
  command: string;
  args: Record<string, unknown>;
  onOutput?: (text: string) => void;
}

export async function executeCommand(
  params: ExecuteCommandParams
): Promise<CommandResult> {
  const { command, args, onOutput } = params;
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

/**
 * Submit feedback on a news brief (text or voice).
 */
export interface SubmitBriefFeedbackParams {
  briefPath: string;
  targetId: string;
  comment?: string;
  audioBlob?: Blob;
}

export async function submitBriefFeedback(
  params: SubmitBriefFeedbackParams
): Promise<{ success: boolean; path: string; isVoice: boolean }> {
  const { briefPath, targetId, comment, audioBlob } = params;
  let audioData: string | undefined;
  let audioMimeType: string | undefined;

  if (audioBlob) {
    audioData = await blobToBase64(audioBlob);
    audioMimeType = audioBlob.type;
  }

  return fetchJson(`${API_BASE}/brief/feedback`, {
    method: "POST",
    body: JSON.stringify({
      briefPath,
      targetId,
      comment,
      audioData,
      audioMimeType,
    }),
  });
}

/**
 * Submit a query response on a news brief (text or voice).
 */
export interface SubmitQueryResponseParams {
  briefPath: string;
  queryId: string;
  response?: string;
  audioBlob?: Blob;
}

export async function submitQueryResponse(
  params: SubmitQueryResponseParams
): Promise<{ success: boolean; path: string; isVoice: boolean }> {
  const { briefPath, queryId, response, audioBlob } = params;
  let audioData: string | undefined;
  let audioMimeType: string | undefined;

  if (audioBlob) {
    audioData = await blobToBase64(audioBlob);
    audioMimeType = audioBlob.type;
  }

  return fetchJson(`${API_BASE}/brief/query-response`, {
    method: "POST",
    body: JSON.stringify({
      briefPath,
      queryId,
      response,
      audioData,
      audioMimeType,
    }),
  });
}

/**
 * Mark a brief as read.
 */
export async function markBriefRead(
  briefPath: string
): Promise<{ success: boolean; newPath: string }> {
  return fetchJson(`${API_BASE}/brief/mark-read`, {
    method: "POST",
    body: JSON.stringify({ briefPath }),
  });
}

/**
 * Guide reaction from news-guide.
 */
export interface GuideReaction {
  id: string;
  sentiment: "positive" | "negative" | "neutral";
  text: string;
}

/**
 * Get guide reactions for the reading completion UI.
 */
export async function getGuideReactions(): Promise<{ reactions: GuideReaction[] }> {
  return fetchJson(`${API_BASE}/news-guide/reactions`);
}

/**
 * Complete reading a brief with feedback.
 */
export interface CompleteReadingParams {
  briefPath: string;
  overallRating: "great" | "ok" | "meh";
  selectedReactions: Array<{ id: string; source: "guide" | "brief" }>;
  itemFeedback: Array<{ id: string; feedback: "thumbs-up" | "thumbs-down" }>;
}

export async function completeReading(
  params: CompleteReadingParams
): Promise<{ success: boolean; newPath: string }> {
  const { briefPath, overallRating, selectedReactions, itemFeedback } = params;
  return fetchJson(`${API_BASE}/brief/complete-reading`, {
    method: "POST",
    body: JSON.stringify({
      briefPath,
      overallRating,
      selectedReactions,
      itemFeedback,
    }),
  });
}

// --- Dropbox Pairing API ---

export interface DropboxStatus {
  paired: boolean;
  workerUrl?: string;
  channelId?: string;
}

export interface PairResult {
  code: string;
  expiresAt: string;
}

export async function getDropboxStatus(): Promise<DropboxStatus> {
  return fetchJson<DropboxStatus>(`${API_BASE}/dropbox/status`);
}

export async function createPairing(workerUrl: string): Promise<PairResult> {
  return fetchJson<PairResult>(`${API_BASE}/dropbox/pair`, {
    method: "POST",
    body: JSON.stringify({ workerUrl }),
  });
}

// --- History API ---

export interface HistoryCommit {
  hash: string;
  date: string;
  subject: string;
  body?: string;
  trailers?: Record<string, string | string[]>;
}

export interface HistoryResponse {
  commits: HistoryCommit[];
}

export interface DiffResponse {
  hash: string;
  diff: string;
}

export interface SessionContentBlock {
  type: "text" | "tool_use" | "tool_result";
  text?: string;
  toolName?: string;
  toolId?: string;
  inputSummary?: string;
  toolUseId?: string;
  resultSummary?: string;
}

export interface SessionEntry {
  uuid: string;
  type: "user" | "assistant";
  timestamp: string;
  content: SessionContentBlock[];
}

export interface SessionLogResponse {
  sessionId: string;
  found: boolean;
  entries: SessionEntry[];
  total: number;
  hasMore: boolean;
}

export async function getHistory(count = 50, offset = 0): Promise<HistoryResponse> {
  return fetchJson<HistoryResponse>(
    `${API_BASE}/history?count=${count}&offset=${offset}`
  );
}

export async function getCommitDiff(hash: string): Promise<DiffResponse> {
  return fetchJson<DiffResponse>(`${API_BASE}/history/diff/${hash}`);
}

export interface GetSessionLogParams {
  sessionId: string;
  offset?: number;
  limit?: number;
}

export async function getSessionLog(
  params: GetSessionLogParams
): Promise<SessionLogResponse> {
  const { sessionId, offset = 0, limit = 100 } = params;
  return fetchJson<SessionLogResponse>(
    `${API_BASE}/history/session/${sessionId}?offset=${offset}&limit=${limit}`
  );
}

/**
 * Convert a Blob to base64 string.
 */
async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = (reader.result as string).split(",")[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
