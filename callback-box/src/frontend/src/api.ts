/**
 * API client for the Callback Box backend.
 */

/**
 * Get the API base URL for the current box, derived from the URL's first path segment.
 * e.g., /test1/chat → /test1/api
 */
export function getApiBase(): string {
  const firstSegment = window.location.pathname.split("/")[1] || "";
  return `/${firstSegment}/api`;
}

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
  return fetchJson<StatusResponse>(`${getApiBase()}/status`);
}

export async function getInbox(): Promise<ListResponse> {
  return fetchJson<ListResponse>(`${getApiBase()}/inbox`);
}

export async function getCommands(): Promise<ListResponse> {
  return fetchJson<ListResponse>(`${getApiBase()}/commands`);
}

export async function getQuestions(): Promise<ListResponse> {
  return fetchJson<ListResponse>(`${getApiBase()}/questions`);
}

export async function getCard(path: string): Promise<CardResponse> {
  return fetchJson<CardResponse>(`${getApiBase()}/card/${path}`);
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
  return fetchJson<CardResponse>(`${getApiBase()}/card/${cardPath}`, {
    method: "PATCH",
    body: JSON.stringify({ ops }),
  });
}

export async function getLog(count = 10): Promise<LogResponse> {
  return fetchJson<LogResponse>(`${getApiBase()}/log?count=${count}`);
}

export async function getContext(): Promise<ContextResponse> {
  return fetchJson<ContextResponse>(`${getApiBase()}/context`);
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
  return fetchJson<NewsStatusResponse>(`${getApiBase()}/news-status`);
}

// --- Browse API ---

export interface BrowseCardInfo {
  relativePath: string;
  name: string;
  type: string;
  tagName: string;
  status?: string;
}

export interface BrowseResponse {
  path: string;
  dirs: string[];
  cards: BrowseCardInfo[];
}

export async function getBrowse(dirPath = ""): Promise<BrowseResponse> {
  return fetchJson<BrowseResponse>(`${getApiBase()}/browse/${dirPath}`);
}

export async function triggerWakeup(dryRun = false): Promise<{
  success: boolean;
  message: string;
  actions: string[];
}> {
  return fetchJson(`${getApiBase()}/actions/wakeup`, {
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
  return fetchJson(`${getApiBase()}/actions/answer`, {
    method: "POST",
    body: JSON.stringify({ questionPath, answer, selectedId }),
  });
}

export interface CreateCardParams {
  path: string;
  template: string;
  args?: Record<string, unknown>;
}

export async function createCard(
  params: CreateCardParams
): Promise<{ success: boolean; path: string }> {
  const { path, template, args } = params;
  return fetchJson(`${getApiBase()}/actions/create`, {
    method: "POST",
    body: JSON.stringify({ path, template, args }),
  });
}

export async function createVoiceMemo(
  audioBlob: Blob
): Promise<{ success: boolean; path: string; audioPath: string }> {
  const formData = new FormData();
  formData.append("file", audioBlob, "recording.webm");

  const response = await fetch(`${getApiBase()}/actions/create-voice-memo`, {
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

  const response = await fetch(`${getApiBase()}/upload`, {
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
  const response = await fetch(`${getApiBase()}/commands/execute`, {
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
  return fetchJson(`${getApiBase()}/commands/execute-sync`, {
    method: "POST",
    body: JSON.stringify({ command, args }),
  });
}

/**
 * List available commands.
 */
export async function listCommands(): Promise<{ commands: CommandInfo[] }> {
  return fetchJson(`${getApiBase()}/commands/list`);
}

/**
 * Get details for a specific command.
 */
export async function getCommandInfo(name: string): Promise<CommandInfo> {
  return fetchJson(`${getApiBase()}/commands/${name}`);
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

  return fetchJson(`${getApiBase()}/brief/feedback`, {
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

  return fetchJson(`${getApiBase()}/brief/query-response`, {
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
  return fetchJson(`${getApiBase()}/brief/mark-read`, {
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
  return fetchJson(`${getApiBase()}/news-guide/reactions`);
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
  return fetchJson(`${getApiBase()}/brief/complete-reading`, {
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
  return fetchJson<DropboxStatus>(`${getApiBase()}/dropbox/status`);
}

export async function createPairing(workerUrl: string): Promise<PairResult> {
  return fetchJson<PairResult>(`${getApiBase()}/dropbox/pair`, {
    method: "POST",
    body: JSON.stringify({ workerUrl }),
  });
}

// --- Calendar Config API ---

export interface AvailableCalendar {
  id: string;
  summary: string;
  description?: string;
  primary?: boolean;
  accessRole: string;
  backgroundColor?: string;
  syncing: boolean;
  resolvedId?: string;
}

export interface CalendarConfig {
  calendars?: string[];
  syncDaysBack?: number;
  syncDaysForward?: number;
}

export async function getAvailableCalendars(): Promise<AvailableCalendar[]> {
  return fetchJson<AvailableCalendar[]>(`${getApiBase()}/calendar/available`);
}

export async function getCalendarConfig(): Promise<CalendarConfig> {
  return fetchJson<CalendarConfig>(`${getApiBase()}/calendar/config`);
}

export async function putCalendarConfig(
  config: CalendarConfig
): Promise<{ success: boolean }> {
  return fetchJson(`${getApiBase()}/calendar/config`, {
    method: "PUT",
    body: JSON.stringify(config),
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
  type: "text" | "tool_use" | "tool_result" | "thinking";
  text?: string;
  toolName?: string;
  toolId?: string;
  input?: Record<string, unknown>;
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
    `${getApiBase()}/history?count=${count}&offset=${offset}`
  );
}

export async function getCommitDiff(hash: string): Promise<DiffResponse> {
  return fetchJson<DiffResponse>(`${getApiBase()}/history/diff/${hash}`);
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
    `${getApiBase()}/history/session/${sessionId}?offset=${offset}&limit=${limit}`
  );
}

// --- Schedule Info API ---

export interface ScheduleInfo {
  name: string;
  description: string | undefined;
  schedule: string;
  scheduleType: "cron" | "at" | "rrule" | "wakeup-only";
  enabled: boolean;
  onWakeup: boolean;
  notBefore: string | undefined;
  runs: string;
  lastRun: string | null;
  lastResult: "success" | "failure" | null;
  lastError: string | null;
  runCount: number;
  once: boolean;
  budget?: { limitMs: number; windowMs: number; usedMs: number };
  running?: { startedAt: string; triggeredBy: string };
}

export interface SchedulesResponse {
  schedules: ScheduleInfo[];
}

export async function getSchedules(): Promise<SchedulesResponse> {
  return fetchJson<SchedulesResponse>(`${getApiBase()}/schedules`);
}

// --- Scheduler Log API ---

export interface SchedulerScriptEntry {
  name: string;
  status: "ran" | "skipped" | "error";
  command?: string;
  durationMs?: number;
  error?: string;
}

export interface SchedulerLogEntry {
  ts: string;
  event: string;
  box?: string;
  result?: {
    ran: number;
    skipped: number;
    errors: number;
    scripts: SchedulerScriptEntry[];
  };
  error?: string;
}

export interface SchedulerLogResponse {
  entries: SchedulerLogEntry[];
}

export async function getSchedulerLog(options?: {
  limit?: number;
  event?: string;
  status?: string;
}): Promise<SchedulerLogResponse> {
  const params = new URLSearchParams();
  if (options?.limit) params.set("limit", String(options.limit));
  if (options?.event) params.set("event", options.event);
  if (options?.status) params.set("status", options.status);
  const qs = params.toString();
  return fetchJson<SchedulerLogResponse>(
    `${getApiBase()}/scheduler/log${qs ? `?${qs}` : ""}`,
  );
}

// --- Chat API ---

export interface ChatStatusResponse {
  sessionId: string | null;
  running: boolean;
  busy: boolean;
}

export interface ChatHistoryResponse {
  sessionId: string | null;
  entries: SessionEntry[];
}

export async function getChatStatus(): Promise<ChatStatusResponse> {
  return fetchJson<ChatStatusResponse>(`${getApiBase()}/chat/status`);
}

export async function getChatHistory(): Promise<ChatHistoryResponse> {
  return fetchJson<ChatHistoryResponse>(`${getApiBase()}/chat/history`);
}

export async function interruptChat(): Promise<{ ok: boolean }> {
  return fetchJson(`${getApiBase()}/chat/interrupt`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function resetChatSession(): Promise<{ ok: boolean }> {
  return fetchJson(`${getApiBase()}/chat/reset`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

/**
 * Send a chat message and stream the response via SSE.
 * Calls onMessage for each streamed JSON message from Claude.
 * Returns when the turn is complete.
 */
export async function sendChatMessage(params: {
  message: string;
  onMessage: (msg: Record<string, unknown>) => void;
}): Promise<void> {
  const { message, onMessage } = params;
  const response = await fetch(`${getApiBase()}/chat/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ error: response.statusText }));
    throw new Error(error.error || "Chat send failed");
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        try {
          const data = JSON.parse(line.slice(6));
          onMessage(data);
        } catch {
          // Skip unparseable lines
        }
      }
    }
  }

  // Process remaining buffer
  if (buffer.startsWith("data: ")) {
    try {
      const data = JSON.parse(buffer.slice(6));
      onMessage(data);
    } catch {
      // Skip
    }
  }
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
