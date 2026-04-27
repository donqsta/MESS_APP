/**
 * Concurrency utilities cho AI Bot — giải quyết 3 vấn đề khi nhiều khách nhắn cùng lúc:
 *
 * 1. ConversationQueue  — serialise: mỗi conversation xử lý tuần tự, không race condition
 * 2. Semaphore          — global throttle: giới hạn số Gemini call chạy đồng thời
 * 3. MessageBatcher     — debounce: gom tin nhắn liên tiếp trong window 800ms thành 1 call
 *
 * Tất cả singleton qua process object → sống qua Next.js hot-reload.
 */

// ── Helpers ───────────────────────────────────────────────────────────────────

type AnyFn = () => Promise<unknown>;

// ── 1. ConversationQueue — one-at-a-time per conversation ─────────────────────

interface ConvQueueStore {
  _botConvQueues: Map<string, Promise<void>>;
}

function getConvQueues(): Map<string, Promise<void>> {
  const p = process as NodeJS.Process & Partial<ConvQueueStore>;
  if (!p._botConvQueues) p._botConvQueues = new Map();
  return p._botConvQueues;
}

/**
 * Đảm bảo mỗi conversation chỉ xử lý 1 Gemini request tại một thời điểm.
 * Tin nhắn kế tiếp tự động queue sau tin trước hoàn thành.
 */
export function enqueueForConversation(
  conversationId: string,
  task: () => Promise<void>
): Promise<void> {
  const queues = getConvQueues();
  const current = queues.get(conversationId) ?? Promise.resolve();
  const next = current.then(
    () => task(),
    () => task() // chạy dù task trước lỗi
  );
  // Lưu promise (đã eat lỗi) để chain tiếp
  queues.set(conversationId, next.catch(() => {}));
  return next;
}

// ── 2. Semaphore — global concurrent Gemini call limit ────────────────────────

interface SemaphoreState {
  available: number;
  limit: number;
  waiters: Array<() => void>;
}

interface SemStore {
  _botSemState: SemaphoreState;
}

function getSemState(): SemaphoreState {
  const p = process as NodeJS.Process & Partial<SemStore>;
  if (!p._botSemState) {
    const limit = Math.max(1, parseInt(process.env.GEMINI_CONCURRENCY ?? "5", 10));
    p._botSemState = { available: limit, limit, waiters: [] };
    console.log(`[Concurrency] Gemini semaphore: max ${limit} concurrent calls`);
  }
  return p._botSemState;
}

function semAcquire(): Promise<() => void> {
  const s = getSemState();
  if (s.available > 0) {
    s.available--;
    return Promise.resolve(semRelease);
  }
  return new Promise<() => void>((resolve) => {
    s.waiters.push(() => {
      s.available--;
      resolve(semRelease);
    });
  });
}

function semRelease(): void {
  const s = getSemState();
  s.available++;
  const next = s.waiters.shift();
  if (next) next();
}

/**
 * Chạy task trong slot của semaphore.
 * Nếu đã đầy, task đợi trong queue cho đến khi có slot trống.
 */
export async function withGeminiSlot<T>(task: () => Promise<T>): Promise<T> {
  const release = await semAcquire();
  try {
    return await task();
  } finally {
    release();
  }
}

export function getGeminiStats(): { active: number; queued: number; limit: number } {
  const s = getSemState();
  return {
    active: s.limit - s.available,
    queued: s.waiters.length,
    limit: s.limit,
  };
}

// ── 3. MessageBatcher — debounce rapid messages per conversation ──────────────

interface BatchEntry {
  texts: string[];
  timer: ReturnType<typeof setTimeout>;
  callback: (combined: string) => void;
}

interface BatchStore {
  _botBatchMap: Map<string, BatchEntry>;
}

function getBatchMap(): Map<string, BatchEntry> {
  const p = process as NodeJS.Process & Partial<BatchStore>;
  if (!p._botBatchMap) p._botBatchMap = new Map();
  return p._botBatchMap;
}

const BATCH_DELAY_MS = Math.max(
  0,
  parseInt(process.env.BOT_BATCH_DELAY_MS ?? "800", 10)
);

/**
 * Gom các tin nhắn liên tiếp trong cùng BATCH_DELAY_MS vào 1 lần xử lý.
 * callback sẽ chỉ được gọi 1 lần với toàn bộ text gom lại.
 *
 * Nếu BATCH_DELAY_MS = 0, flush ngay lập tức (disable batching).
 */
export function batchMessage(
  conversationId: string,
  text: string,
  callback: (combined: string) => void
): void {
  if (BATCH_DELAY_MS === 0) {
    callback(text);
    return;
  }

  const map = getBatchMap();
  const existing = map.get(conversationId);

  if (existing) {
    clearTimeout(existing.timer);
    existing.texts.push(text);
    existing.callback = callback;
    existing.timer = setTimeout(() => flushBatch(conversationId), BATCH_DELAY_MS);
  } else {
    const timer = setTimeout(() => flushBatch(conversationId), BATCH_DELAY_MS);
    map.set(conversationId, { texts: [text], timer, callback });
  }
}

function flushBatch(conversationId: string): void {
  const map = getBatchMap();
  const entry = map.get(conversationId);
  if (!entry) return;
  map.delete(conversationId);

  const combined = entry.texts.join("\n");
  if (entry.texts.length > 1) {
    console.log(
      `[Concurrency] Batched ${entry.texts.length} tin → convId=${conversationId}`
    );
  }
  entry.callback(combined);
}

// ── Expose for monitoring ─────────────────────────────────────────────────────

export function getConcurrencyStats() {
  const gem = getGeminiStats();
  const convQueues = getConvQueues();
  const batchMap = getBatchMap();
  return {
    gemini: gem,
    activeConversationQueues: convQueues.size,
    pendingBatches: batchMap.size,
  };
}

// ── No-op export to silence unused import warnings ───────────────────────────
export type { AnyFn };
