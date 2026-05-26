/**
 * Direct Telegram Bot API send — no grammy dependency.
 * Used by the chat session pool to send responses immediately.
 */

import ky from "ky";

export interface TelegramSendResult {
  messageId: number;
}

/**
 * Send a text message via the Telegram Bot API.
 */
export async function sendTelegramMessage(opts: {
  botToken: string;
  chatId: string | number;
  text: string;
}): Promise<TelegramSendResult> {
  const { botToken, chatId, text } = opts;

  const data = await ky
    .post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      json: { chat_id: chatId, text },
      retry: 2,
    })
    .json<{ ok: boolean; result: { message_id: number } }>();

  return { messageId: data.result.message_id };
}

/**
 * Send a "typing..." indicator. Expires after ~5s.
 */
export async function sendTypingIndicator(opts: {
  botToken: string;
  chatId: string | number;
}): Promise<void> {
  await ky.post(`https://api.telegram.org/bot${opts.botToken}/sendChatAction`, {
    json: { chat_id: opts.chatId, action: "typing" },
    retry: 0,
  });
}

/**
 * Start a repeating typing indicator. Returns a stop function.
 * Re-sends every 4s (Telegram's indicator expires after ~5s).
 */
export function startTypingIndicator(opts: {
  botToken: string;
  chatId: string | number;
}): () => void {
  // Send immediately
  sendTypingIndicator(opts).catch((err) => {
    console.error(`[telegram-send] Typing indicator failed: ${err}`);
  });

  const interval = setInterval(() => {
    sendTypingIndicator(opts).catch((err) => {
      console.error(`[telegram-send] Typing indicator failed: ${err}`);
    });
  }, 4000);

  return () => clearInterval(interval);
}
