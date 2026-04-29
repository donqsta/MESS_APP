/**
 * Lưu lịch sử tin nhắn user để phục vụ tạo lead Getfly.
 * Tách riêng khỏi botMemory để vẫn hoạt động khi bot bị tắt.
 */

interface UserMsgItem {
  text: string;
  timestamp: number;
}

const MAX_MSG_PER_USER = 20;
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 giờ

const proc = process as NodeJS.Process & {
  _leadUserMessages?: Map<string, UserMsgItem[]>;
};

if (!proc._leadUserMessages) {
  proc._leadUserMessages = new Map();
}

const store = proc._leadUserMessages;

function keyOf(pageId: string, senderId: string): string {
  return `${pageId}:${senderId}`;
}

export function addLeadUserMessage(
  pageId: string,
  senderId: string,
  text: string,
  timestamp = Date.now()
): void {
  const cleaned = text.trim();
  if (!cleaned) return;

  const key = keyOf(pageId, senderId);
  const current = store.get(key) ?? [];
  const next = [...current, { text: cleaned, timestamp }]
    .filter((m) => timestamp - m.timestamp <= MAX_AGE_MS)
    .slice(-MAX_MSG_PER_USER);

  store.set(key, next);
}

export function getLeadUserMessages(pageId: string, senderId: string): string[] {
  const now = Date.now();
  const key = keyOf(pageId, senderId);
  const current = (store.get(key) ?? []).filter((m) => now - m.timestamp <= MAX_AGE_MS);
  store.set(key, current);
  return current.map((m) => m.text);
}
