/**
 * The Browser page's question bar and its two routes
 * (docs/plans/shared-browser-ask.subplan.md).
 *
 * `GET /browser/_box/question` lists what the agent is waiting for, and
 * `POST /browser/_box/answer` sends the person's answer to the chat that asked,
 * as a message from that person. Both sit behind the person gate, so an agent
 * cannot answer itself and another site cannot post an answer. `_box` cannot
 * meet a dashboard path: the dashboard's are `/_next`, `/api`, and its pages.
 */

import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { sendBrowserCommand } from "../../../../core/browser/command-socket.js";
import type { BrowserHostHandle, EnsureBrowserHostInput } from "../../../../core/browser/host/start.js";
import { ANSWER_BODY, answerMessage, claimBrowserQuestion, readBrowserQuestions, restoreBrowserQuestion } from "../../../../core/browser/question.js";
import { resolveBoxIdentity } from "../../../box-identity.js";
import { getChatRuntime } from "../../../chat-runtime.js";
import { resolveMobileSender } from "../../chat/register.js";
import { readCapped } from "./dashboard-post.js";
import { QUESTION_BAR_HTML } from "./question-bar.js";

const ANSWER_CAP_BYTES = 8 * 1024;

export interface BrowserQuestionRoutesContext {
  readonly boxRoot: string;
  readonly ensureHost: (input: EnsureBrowserHostInput) => Promise<BrowserHostHandle>;
}

/** The dashboard page with the question bar, which shows itself when a question waits. */
export function withQuestionBar(html: string): string {
  const head = /<head\b[^>]*>/i.exec(html);
  if (head === null) return QUESTION_BAR_HTML + html;
  const end = head.index + head[0].length;
  return html.slice(0, end) + QUESTION_BAR_HTML + html.slice(end);
}

/**
 * Reopen the page a waiting question is about, when the browser idled out and
 * came back on a blank page. Any other page is left alone: it is one the person
 * or the agent chose. The check on the page may start again; that is the site's.
 * Answers a notice for the page when the reopen failed.
 */
export async function reopenAskedPage(host: BrowserHostHandle): Promise<string | null> {
  const pageUrl = readBrowserQuestions(host.paths.root).findLast((q) => q.pageUrl !== null)?.pageUrl;
  if (pageUrl === undefined || pageUrl === null) return null;
  const current = await sendBrowserCommand(host.paths.cliSocket, ["get", "url"]);
  if (current.exitCode !== 0 || current.stdout.trim() !== "about:blank") return null;
  const opened = await sendBrowserCommand(host.paths.cliSocket, ["open", pageUrl]);
  return opened.exitCode === 0 ? null : `Could not reopen ${pageUrl}: ${opened.stderr.trim() || `exit code ${String(opened.exitCode)}`}`;
}

function questionList(host: BrowserHostHandle): { id: string; text: string; pageUrl: string | null }[] {
  return readBrowserQuestions(host.paths.root).map((q) => ({ id: q.id, text: q.question, pageUrl: q.pageUrl }));
}

function failedSend(reply: FastifyReply, error: string): FastifyReply {
  return reply.status(502).send({ error: `The answer did not reach the chat: ${error}` });
}

export function registerBrowserQuestionRoutes(scope: FastifyInstance, ctx: BrowserQuestionRoutesContext): void {
  const { boxRoot, ensureHost } = ctx;

  scope.get("/browser/_box/question", async (_request, reply) => {
    const host = await ensureHost({ boxRoot });
    return reply.header("cache-control", "no-store").send({ questions: questionList(host) });
  });

  scope.post("/browser/_box/answer", async (request, reply) => {
    const raw = await readCapped(request.raw, ANSWER_CAP_BYTES);
    if (raw === null) return reply.status(413).send({ error: "The answer is too long" });
    let json: unknown;
    try {
      json = JSON.parse(raw.toString("utf8"));
    } catch (_e) {
      return reply.status(400).send({ error: "The answer is not JSON" });
    }
    const body = ANSWER_BODY.safeParse(json);
    if (!body.success) return reply.status(400).send({ error: z.prettifyError(body.error) });
    const runtime = getChatRuntime(boxRoot);
    if (runtime === undefined) return reply.status(503).send({ error: "Chat is not running on this box" });

    const host = await ensureHost({ boxRoot });
    const root = host.paths.root;
    const question = claimBrowserQuestion(root, body.data.id);
    if (question === null) {
      return reply.status(409).send({ error: "This question has changed or was already answered", questions: questionList(host) });
    }
    try {
      const resolved = await runtime.resolveSendTarget({
        sessionParam: question.sessionId,
        contextDir: undefined,
        requestSeedFeatures: undefined,
        exactSession: true,
      });
      if (!resolved.ok) {
        // 410 is a deleted or deleting chat; 404 an exact session that no longer resumes. Both are gone.
        if (resolved.status === 404 || resolved.code === "CHAT_SESSION_UNAVAILABLE") {
          return await reply.status(410).send({ error: "The chat that asked no longer exists, so this answer has nowhere to go" });
        }
        restoreBrowserQuestion(root, question);
        return await failedSend(reply, resolved.error);
      }
      const identity = await resolveBoxIdentity({ boxRoot, request, openAccess: scope.openAccess });
      const user = identity.email !== null
        ? { email: identity.email, name: identity.name ?? identity.email }
        : await resolveMobileSender(boxRoot, request.headers);
      const outcome = await runtime.sendUserMessage({
        target: resolved.target,
        message: answerMessage(body.data),
        messageId: question.id,
        user,
        channel: undefined,
      });
      if ("error" in outcome.body) {
        restoreBrowserQuestion(root, question);
        return await failedSend(reply, outcome.body.error);
      }
      return await reply.status(200).send({ ok: true });
    } catch (e) {
      restoreBrowserQuestion(root, question);
      return failedSend(reply, e instanceof Error ? e.message : String(e));
    }
  });
}
