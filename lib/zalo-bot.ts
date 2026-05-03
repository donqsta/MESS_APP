/**
 * Zalo Bot integration — gửi tin nhắn qua Zalo Bot API (bot.zapps.me)
 *
 * Luồng check online (có AI phân tích):
 *  1. pingEmployee(employee, summary) → gửi ping đến Zalo nhân viên
 *  2. waitForOnline(employee, 60000)  → chờ tối đa 60s
 *  3. handleZaloReply(zaloId, text)   → webhook gọi khi nhận reply
 *     → AI classifyEmployeeResponse(text) → ACCEPT / DECLINE / UNKNOWN
 *     → ACCEPT = online, DECLINE = skip sang người tiếp theo
 */

import { Employee } from "./lead-distributor";
import { classifyEmployeeResponse } from "./zalo-response-classifier";

const ZALO_BOT_TOKEN = process.env.ZALO_BOT_TOKEN ?? "";
const ZALO_BOT_SECRET = process.env.ZALO_BOT_SECRET ?? "";
// Bot Platform API: https://bot-api.zaloplatforms.com/bot{TOKEN}/{method}
// Token nhúng trong URL, không phải header

// ── Pending replies map ────────────────────────────────────────────────────────
// zaloId → { resolve(accepted), timer }
const pendingReplies = new Map<string, {
  resolve: (accepted: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
}>();

// ── Signature verification ─────────────────────────────────────────────────────
// Zalo Bot Platform: header X-Bot-Api-Secret-Token = plain text secret (không phải HMAC)

export function verifyZaloSignature(rawBody: string, signature: string): boolean {
  if (!ZALO_BOT_SECRET) return true;
  return signature === ZALO_BOT_SECRET;
}

// ── Send message ───────────────────────────────────────────────────────────────

export async function sendZaloMessage(zaloId: string, text: string): Promise<boolean> {
  if (!ZALO_BOT_TOKEN) {
    console.warn("[zalo-bot] Chưa cấu hình ZALO_BOT_TOKEN");
    return false;
  }

  try {
    // Zalo Bot Platform API: token nhúng trong URL path
    const url = `https://bot-api.zaloplatforms.com/bot${ZALO_BOT_TOKEN}/sendMessage`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: zaloId,
        text,
      }),
    });

    const data = await res.json() as { ok: boolean; description?: string };
    if (!data.ok) {
      console.warn(`[zalo-bot] Gửi tin thất bại (zaloId=${zaloId}):`, data.description);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[zalo-bot] Exception khi gửi tin:", err instanceof Error ? err.message : err);
    return false;
  }
}

// ── Ping employee ──────────────────────────────────────────────────────────────

/**
 * Gửi ping đến nhân viên, hướng dẫn trả lời "ok" để nhận hoặc "bận" để từ chối.
 */
export async function pingEmployee(employee: Employee, leadSummary: string): Promise<boolean> {
  const msg =
    `🔔 Lead mới cần tư vấn!\n` +
    `${leadSummary}\n\n` +
    `Trả lời:\n` +
    `✅ "ok" / "nhận" → nhận lead\n` +
    `❌ "bận" / "không" → chuyển người khác`;

  return sendZaloMessage(employee.zaloId, msg);
}

// ── Wait for online (AI-powered) ───────────────────────────────────────────────

/**
 * Chờ nhân viên trả lời và dùng AI phân tích ý định.
 * Returns true nếu nhân viên ACCEPT lead trong timeoutMs.
 * Returns false nếu DECLINE hoặc timeout.
 */
export function waitForOnline(employee: Employee, timeoutMs = 60000): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    if (!employee.zaloId) {
      resolve(false);
      return;
    }

    const timer = setTimeout(() => {
      pendingReplies.delete(employee.zaloId);
      console.log(`[zalo-bot] Timeout ${timeoutMs / 1000}s — ${employee.name} không trả lời`);
      resolve(false);
    }, timeoutMs);

    pendingReplies.set(employee.zaloId, { resolve, timer });
  });
}

// ── Handle reply from webhook ──────────────────────────────────────────────────

/**
 * Gọi từ webhook khi nhân viên trả lời.
 * Dùng AI phân tích nội dung → resolve ACCEPT/DECLINE.
 */
export async function handleZaloReply(zaloId: string, text: string): Promise<void> {
  const pending = pendingReplies.get(zaloId);
  if (!pending) return;

  clearTimeout(pending.timer);
  pendingReplies.delete(zaloId);

  // AI phân tích ý định
  const intent = await classifyEmployeeResponse(text);
  const accepted = intent !== "decline"; // ACCEPT hoặc UNKNOWN → coi là nhận

  console.log(`[zalo-bot] Reply từ ${zaloId}: "${text.slice(0, 40)}" → intent=${intent} accepted=${accepted}`);

  if (!accepted) {
    // Thông báo đã chuyển lead
    await sendZaloMessage(zaloId, "Đã ghi nhận, lead sẽ được chuyển sang người khác.");
  }

  pending.resolve(accepted);
}

// ── Notify assigned lead ───────────────────────────────────────────────────────

export async function notifyLeadAssigned(
  employee: Employee,
  leadDetails: { name: string; phone: string; projectName?: string; summary: string }
): Promise<void> {
  const msg =
    `✅ Lead đã được phân chia cho bạn!\n\n` +
    `👤 Khách: ${leadDetails.name}\n` +
    `📞 SĐT: ${leadDetails.phone}\n` +
    (leadDetails.projectName ? `🏢 Dự án: ${leadDetails.projectName}\n` : "") +
    `📝 ${leadDetails.summary}`;

  await sendZaloMessage(employee.zaloId, msg);
}
