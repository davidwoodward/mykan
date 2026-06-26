import { getSupabase } from "@/lib/supabase-server";
import { mcpActorEmail } from "@/lib/auth";
import { handleTelegramCommand } from "@/lib/telegram";

/**
 * Telegram webhook. Telegram POSTs each chat update here; we verify it, gate it
 * to allowed chats, run the command against mykan, and reply. Keep it thin — the
 * command logic lives in lib/telegram.ts (which reuses the shared core funcs).
 *
 * Env:
 *   TELEGRAM_BOT_TOKEN        — bot token from @BotFather (to call sendMessage)
 *   TELEGRAM_WEBHOOK_SECRET   — secret_token set on setWebhook; echoed back by
 *                               Telegram in the X-Telegram-Bot-Api-Secret-Token
 *                               header so we can reject forged requests
 *   TELEGRAM_ALLOWED_CHAT_IDS — comma-separated numeric chat/user ids allowed to
 *                               drive the bot (a bot token alone is not a secret)
 */

// Telegram Bot API base. Overridable (TELEGRAM_API_BASE) so tests can point the
// outbound sendMessage at a local catcher; defaults to the real Telegram API.
const TG_API = process.env.TELEGRAM_API_BASE || "https://api.telegram.org";

function allowedChatIds(): string[] {
  return (process.env.TELEGRAM_ALLOWED_CHAT_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function sendMessage(chatId: number | string, text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  // Telegram caps messages at 4096 chars; leave headroom for the truncation note.
  const body =
    text.length > 4000 ? `${text.slice(0, 3960)}\n… (truncated)` : text;
  try {
    await fetch(`${TG_API}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: body,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
  } catch {
    // Best-effort: never let a Telegram delivery error fail the webhook.
  }
}

// Always 200 so Telegram doesn't retry; the bot reports problems in-chat.
function ok(): Response {
  return new Response("ok", { status: 200 });
}

export async function POST(req: Request): Promise<Response> {
  // 1. Verify the request really came from our Telegram webhook registration.
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (
    secret &&
    req.headers.get("x-telegram-bot-api-secret-token") !== secret
  ) {
    return new Response("forbidden", { status: 403 });
  }

  let update: unknown;
  try {
    update = await req.json();
  } catch {
    return ok();
  }

  const message =
    (update as { message?: TgMessage; edited_message?: TgMessage })?.message ??
    (update as { edited_message?: TgMessage })?.edited_message;
  const text = message?.text?.trim();
  const chatId = message?.chat?.id;
  if (!message || typeof text !== "string" || !text || chatId == null) {
    return ok();
  }

  // 2. Gate to allowed chats (match the chat id or the sender's user id).
  const allow = allowedChatIds();
  const fromId = message.from?.id;
  const permitted =
    allow.length > 0 &&
    (allow.includes(String(chatId)) ||
      (fromId != null && allow.includes(String(fromId))));
  if (!permitted) {
    await sendMessage(
      chatId,
      `🚫 Not authorized. Your chat id is <code>${chatId}</code> — add it to TELEGRAM_ALLOWED_CHAT_IDS.`,
    );
    return ok();
  }

  // 3. Run the command and reply.
  try {
    const reply = await handleTelegramCommand(
      getSupabase(),
      mcpActorEmail(),
      text,
    );
    await sendMessage(chatId, reply);
  } catch (e) {
    await sendMessage(
      chatId,
      `⚠️ ${e instanceof Error ? e.message : "Something went wrong."}`,
    );
  }
  return ok();
}

type TgMessage = {
  text?: string;
  chat?: { id: number };
  from?: { id: number };
};
