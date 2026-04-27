import {
  isBotEnabled,
  setBotEnabled,
  ensureConversation,
  addMessage,
  getHistory,
  getCustomerContext,
  getConversation,
  updateProfile,
} from "./botMemory";
import { chat } from "./geminiClient";
import { buildSystemPrompt } from "./systemPrompt";
import { sendMessage, getSenderProfile } from "@/lib/facebook";
import { detectGender, genderToAddress } from "./genderDetector";
import { batchMessage, enqueueForConversation, withGeminiSlot } from "./concurrency";

const TYPING_DELAY_MS = 1200;

export interface BotMessageParams {
  pageId: string;
  senderId: string;
  conversationId: string;
  text: string;
  pageToken: string;
  pageName: string;
  displayName?: string;
}

/**
 * Entry point từ webhook — áp dụng 3 lớp bảo vệ concurrency:
 *
 * Layer 1 — MessageBatcher  : gom các tin nhắn liên tiếp trong 800ms thành 1 lần xử lý
 * Layer 2 — ConversationQueue: serialise, tránh race condition history per conversation
 * Layer 3 — Semaphore       : giới hạn số Gemini call đồng thời toàn hệ thống
 */
export function handleBotMessage(params: BotMessageParams): void {
  const { conversationId, text } = params;

  if (!isBotEnabled(conversationId)) {
    console.log(`[Bot] Disabled — convId=${conversationId}, bỏ qua tin: "${text.slice(0, 40)}"`);
    return;
  }
  if (!text.trim()) return;

  // Layer 1: batch rapid messages
  batchMessage(conversationId, text, (combinedText) => {
    // Layer 2: serialize per conversation
    enqueueForConversation(conversationId, () =>
      processMessage({ ...params, text: combinedText })
    ).catch((e) => console.error("[Bot] Queue error:", e));
  });
}

/**
 * Xử lý thực sự sau khi đã gom tin + lấy được slot trong queue.
 * Layer 3 (semaphore) bao quanh call Gemini.
 */
async function processMessage(params: BotMessageParams): Promise<void> {
  const { pageId, senderId, conversationId, text, pageToken, displayName } = params;

  // Đảm bảo conversation được khởi tạo
  const conv = ensureConversation(conversationId, pageId, senderId, displayName ?? "");

  // Lần đầu nhắn tin → fetch profile + detect giới tính trước khi trả lời
  if (conv.profile.totalMessages === 0 && conv.profile.gender === "unknown") {
    await detectAndStoreGender(conversationId, senderId, pageToken, conv.profile.displayName).catch(
      (e) => console.error("[Bot] gender detect error:", e)
    );
  }

  // Lưu tin nhắn user (có thể là text đã gom từ nhiều tin)
  addMessage(conversationId, "user", text);

  const history = getHistory(conversationId);
  const systemPrompt = buildSystemPrompt(pageId);
  const customerContext = getCustomerContext(conversationId);

  // Layer 3: giới hạn concurrent Gemini calls
  let reply: string;
  try {
    reply = await withGeminiSlot(() => chat(history, systemPrompt, customerContext));
  } catch (err) {
    console.error("[Bot] Gemini error:", err);
    return;
  }

  // Lưu phản hồi của bot vào lịch sử
  addMessage(conversationId, "model", reply);

  // Tách theo [BREAK] và gửi từng bubble
  const bubbles = reply
    .split(/\[BREAK\]/gi)
    .map((s) => s.trim())
    .filter(Boolean);

  for (let i = 0; i < bubbles.length; i++) {
    if (i > 0) await sleep(TYPING_DELAY_MS);
    try {
      await sendMessage(pageId, pageToken, senderId, bubbles[i]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      // #551: khách block page / tài khoản không khả dụng → tắt bot, không thử nữa
      if (msg.includes("551")) {
        console.warn(`[Bot] #551 — Khách không nhận được tin (block/unavailable). Tắt bot cho convId=${conversationId}`);
        setBotEnabled(conversationId, false);
        return;
      }

      console.error(`[Bot] Lỗi gửi bubble ${i + 1}:`, msg);
      break;
    }
  }

  console.log(`[Bot] convId=${conversationId} — ${bubbles.length} bubble(s)`);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch Facebook profile (name + avatar) và detect giới tính,
 * sau đó cập nhật vào botMemory.
 */
async function detectAndStoreGender(
  conversationId: string,
  senderId: string,
  pageToken: string,
  currentDisplayName: string
): Promise<void> {
  const profile = await getSenderProfile(senderId, pageToken);

  const name = profile.name || currentDisplayName;
  if (!name) return;

  const gender = await detectGender(name, profile.pictureUrl);
  const { preferredCall, selfRef } = genderToAddress(gender);

  updateProfile(conversationId, {
    displayName: name,
    gender,
    // Chỉ set nếu chưa có (tránh ghi đè khi khách đã tự xưng trong tin nhắn)
    ...(getConversation(conversationId)?.profile.preferredCall
      ? {}
      : { preferredCall, selfRef }),
  });

  console.log(
    `[GenderDetect] convId=${conversationId} name="${name}" → ${gender} (gọi: "${preferredCall}")`
  );
}
