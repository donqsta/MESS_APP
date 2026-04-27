/**
 * Bot Memory — Lưu lịch sử chat và profile khách hàng per conversation
 * Dùng process object để tránh mất dữ liệu khi Next.js hot-reload
 */

import { loadPersistedState, persistState, clearPersistedState } from "./botPersist";
import { getDefaultBotEnabled } from "./botSettings";

const MAX_HISTORY = 30;

export interface ChatMessage {
  role: "user" | "model";
  content: string;
}

export interface CustomerProfile {
  displayName: string;
  gender: "male" | "female" | "unknown";
  selfRef: string;           // cách khách tự xưng: tôi, mình, em, anh, chị...
  preferredCall: string;     // cách gọi khách: anh, chị, bạn...
  purchaseStage: "new" | "exploring" | "considering" | "decided" | "returning";
  knownNeeds: string[];      // ['mua_o', 'dau_tu', 'tang_lon', ...]
  notes: string;             // ghi chú tự do
  firstSeen: number;
  lastSeen: number;
  totalMessages: number;
  lastCustomerMsgAt: number;  // timestamp tin nhắn cuối của khách
  lastBotReplyAt: number;     // timestamp bot gửi tin gần nhất
  proactiveCount: number;     // số lần bot chủ động nhắn trong session này
}

export interface ConversationData {
  conversationId: string;
  pageId: string;
  senderId: string;
  profile: CustomerProfile;
  history: ChatMessage[];
}

// ── Persistent stores trên process object ──────────────────────────────────────
const proc = process as NodeJS.Process & {
  _botConversations?: Map<string, ConversationData>;
  _botEnabledState?: Map<string, boolean>;
  _botSenderToConv?: Map<string, string>; // "${pageId}:${senderId}" → conversationId
};

if (!proc._botConversations) proc._botConversations = new Map();
if (!proc._botEnabledState) proc._botEnabledState = new Map();
if (!proc._botSenderToConv) proc._botSenderToConv = new Map();

const conversations = proc._botConversations;
const enabledState = proc._botEnabledState;
const senderToConv = proc._botSenderToConv;

// Nạp trạng thái bật/tắt từ file khi lần đầu khởi động
loadPersistedState(enabledState);

// ── Bot enabled/disabled per conversation ─────────────────────────────────────

export function isBotEnabled(conversationId: string): boolean {
  // Nếu đã được set thủ công → dùng giá trị đó
  if (enabledState.has(conversationId)) {
    return enabledState.get(conversationId)!;
  }
  // Chưa set → dùng global default (mặc định = true)
  return getDefaultBotEnabled();
}

export function setBotEnabled(conversationId: string, enabled: boolean): void {
  enabledState.set(conversationId, enabled);
  persistState(enabledState);
}

export function toggleBot(conversationId: string): boolean {
  const current = isBotEnabled(conversationId);
  enabledState.set(conversationId, !current);
  persistState(enabledState);
  return !current;
}

/**
 * Đăng ký mapping senderId → conversationId để webhook có thể tra cứu.
 * Gọi khi UI mở một cuộc hội thoại (GET /api/bot/toggle?...).
 */
export function registerSenderMapping(pageId: string, senderId: string, conversationId: string): void {
  senderToConv.set(`${pageId}:${senderId}`, conversationId);
}

/**
 * Tra cứu conversationId từ senderId + pageId.
 * Dùng trong webhook khi bot cần tìm đúng conversation.
 */
export function getConversationIdBySender(pageId: string, senderId: string): string | undefined {
  return senderToConv.get(`${pageId}:${senderId}`);
}

// ── Conversation & history management ────────────────────────────────────────

function defaultProfile(displayName = ""): CustomerProfile {
  return {
    displayName,
    gender: "unknown",
    selfRef: "",
    preferredCall: "",
    purchaseStage: "new",
    knownNeeds: [],
    notes: "",
    firstSeen: Date.now(),
    lastSeen: Date.now(),
    totalMessages: 0,
    lastCustomerMsgAt: 0,
    lastBotReplyAt: 0,
    proactiveCount: 0,
  };
}

export function getConversation(conversationId: string): ConversationData | undefined {
  return conversations.get(conversationId);
}

export function ensureConversation(
  conversationId: string,
  pageId: string,
  senderId: string,
  displayName = ""
): ConversationData {
  if (!conversations.has(conversationId)) {
    conversations.set(conversationId, {
      conversationId,
      pageId,
      senderId,
      profile: defaultProfile(displayName),
      history: [],
    });
  }
  const conv = conversations.get(conversationId)!;
  if (displayName && !conv.profile.displayName) {
    conv.profile.displayName = displayName;
  }
  conv.profile.lastSeen = Date.now();
  return conv;
}

export function addMessage(
  conversationId: string,
  role: "user" | "model",
  content: string
): void {
  const conv = conversations.get(conversationId);
  if (!conv) return;

  conv.history.push({ role, content });

  if (role === "user") {
    conv.profile.totalMessages++;
    conv.profile.lastCustomerMsgAt = Date.now();
    detectSelfRef(conv, content);
  } else {
    conv.profile.lastBotReplyAt = Date.now();
  }

  // Giữ tối đa MAX_HISTORY tin nhắn
  if (conv.history.length > MAX_HISTORY) {
    conv.history.splice(0, conv.history.length - MAX_HISTORY);
  }
}

/** Tăng proactiveCount sau mỗi lần bot chủ động nhắn */
export function incrementProactiveCount(conversationId: string): void {
  const conv = conversations.get(conversationId);
  if (!conv) return;
  conv.profile.proactiveCount++;
  conv.profile.lastBotReplyAt = Date.now();
}

/**
 * Lấy tất cả conversations đang bật bot, khách đã im lặng sau khi bot reply,
 * và thời gian im lặng >= minWaitMs.
 */
export function getRecentSilentConversations(minWaitMs = 2 * 60 * 1000): Array<{
  conversationId: string;
  pageId: string;
  senderId: string;
  history: ChatMessage[];
  profile: CustomerProfile;
  minutesSilent: number;
}> {
  const now = Date.now();
  const maxAge = 30 * 60 * 1000; // 30 phút — sau đó dừng hẳn proactive

  const result = [];
  for (const [convId, conv] of conversations.entries()) {
    if (!isBotEnabled(convId)) continue;

    const { lastBotReplyAt, lastCustomerMsgAt } = conv.profile;
    if (!lastBotReplyAt) continue;                        // bot chưa từng reply
    if (lastCustomerMsgAt > lastBotReplyAt) continue;    // khách đã reply sau bot → không cần follow-up
    if (now - lastBotReplyAt > maxAge) continue;         // quá 24h → bỏ qua
    if (now - lastBotReplyAt < minWaitMs) continue;      // chưa đủ thời gian chờ

    result.push({
      conversationId: convId,
      pageId: conv.pageId,
      senderId: conv.senderId,
      history: conv.history,
      profile: conv.profile,
      minutesSilent: Math.floor((now - lastBotReplyAt) / 60000),
    });
  }
  return result;
}

export function getHistory(conversationId: string): ChatMessage[] {
  return conversations.get(conversationId)?.history ?? [];
}

export function getProfile(conversationId: string): CustomerProfile | undefined {
  return conversations.get(conversationId)?.profile;
}

export function updateProfile(
  conversationId: string,
  updates: Partial<CustomerProfile>
): void {
  const conv = conversations.get(conversationId);
  if (!conv) return;
  Object.assign(conv.profile, updates);
}

// ── Heuristics: phát hiện cách xưng hô của khách ─────────────────────────────

function detectSelfRef(conv: ConversationData, text: string) {
  const lower = text.toLowerCase();

  // Khách xưng "anh" → gọi lại là "anh"
  if (/\banh\b/.test(lower)) {
    conv.profile.selfRef = "anh";
    conv.profile.gender = "male";
    conv.profile.preferredCall = "anh";
    return;
  }
  // Khách xưng "chị" → gọi lại là "chị"
  if (/\bchị\b/.test(lower)) {
    conv.profile.selfRef = "chị";
    conv.profile.gender = "female";
    conv.profile.preferredCall = "chị";
    return;
  }
  // Khách xưng "em" → gọi lại "anh/chị" cho đến khi biết giới tính
  if (/\bem\b/.test(lower) && !conv.profile.selfRef) {
    conv.profile.selfRef = "em";
    if (!conv.profile.preferredCall) conv.profile.preferredCall = "anh/chị";
  }
  // Khách xưng "mình" hay "tôi" → chưa rõ giới tính
  if (/\bmình\b/.test(lower) && !conv.profile.selfRef) {
    conv.profile.selfRef = "mình";
    if (!conv.profile.preferredCall) conv.profile.preferredCall = "anh/chị";
  }
  if (/\btôi\b/.test(lower) && !conv.profile.selfRef) {
    conv.profile.selfRef = "tôi";
    if (!conv.profile.preferredCall) conv.profile.preferredCall = "anh/chị";
  }
}

/**
 * Xóa toàn bộ lịch sử chat và profile (giữ nguyên trạng thái bật/tắt).
 * Dùng khi cần test lại từ đầu mà không muốn bật lại từng conversation.
 */
export function resetConversationMemory(conversationId?: string): void {
  if (conversationId) {
    conversations.delete(conversationId);
    console.log(`[BotMemory] Cleared conversation: ${conversationId}`);
  } else {
    conversations.clear();
    senderToConv.clear();
    console.log("[BotMemory] All conversation memory cleared");
  }
}

/**
 * Reset toàn bộ: lịch sử + trạng thái bật/tắt + file persist.
 */
export function resetAllMemory(): void {
  conversations.clear();
  enabledState.clear();
  senderToConv.clear();
  clearPersistedState();
  console.log("[BotMemory] Full reset — all memory and persisted state cleared");
}

// ── Customer context cho system prompt ───────────────────────────────────────

export function getCustomerContext(conversationId: string): string {
  const conv = conversations.get(conversationId);
  if (!conv) return "";

  const p = conv.profile;
  const isNew = p.totalMessages <= 1;
  const call = p.preferredCall || "anh/chị";

  const lines = [
    `Tên khách: ${p.displayName || "Chưa biết"}`,
    `Cách gọi khách: "${call}" — Bot luôn xưng "em" với khách`,
    `Khách tự xưng: ${p.selfRef || "chưa rõ"}`,
    `Giới tính: ${p.gender === "male" ? "Nam" : p.gender === "female" ? "Nữ" : "Chưa rõ"}`,
    `Lần đầu chat: ${isNew ? "Có — khách mới" : "Không — đã từng chat"}`,
    `Giai đoạn mua: ${p.purchaseStage}`,
    p.knownNeeds.length > 0 ? `Nhu cầu đã biết: ${p.knownNeeds.join(", ")}` : "",
    p.notes ? `Ghi chú: ${p.notes}` : "",
  ].filter(Boolean);

  return `## THÔNG TIN KHÁCH HÀNG\n${lines.join("\n")}\n\n**LƯU Ý XƯNG HÔ:** Luôn xưng "em", gọi khách là "${call}". Không dùng "mình", "bạn", "tôi".`;
}
