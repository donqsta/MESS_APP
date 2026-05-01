/**
 * In-memory store cho leads từ uhchat.net.
 * Dùng process object (singleton thực sự trong Node.js) để chia sẻ state
 * giữa các module — tương tự webhook-store.ts.
 */

import fs from "fs";
import path from "path";
import type { UhchatLead } from "@/lib/uhchat";

// ── Persist seenIds ra file để sống sót qua server restart ───────────────────

const SEEN_FILE = path.join(process.cwd(), "data", "uhchat-seen.json");

function loadSeenFromFile(): Set<string> {
  try {
    if (!fs.existsSync(SEEN_FILE)) return new Set();
    const arr = JSON.parse(fs.readFileSync(SEEN_FILE, "utf-8")) as string[];
    return new Set(arr);
  } catch {
    return new Set();
  }
}

function saveSeenToFile(ids: Set<string>): void {
  try {
    // Giữ tối đa 5000 session ID gần nhất tránh file phình to
    const arr = [...ids].slice(-5000);
    fs.writeFileSync(SEEN_FILE, JSON.stringify(arr), "utf-8");
  } catch (e) {
    console.error("[uhchat-store] Không thể ghi seen file:", e);
  }
}

// ── State storage trên process object ────────────────────────────────────────

const _STORE_KEY = "__uhchat_store__";
const _SEEN_KEY = "__uhchat_seen_ids__";
const _SSE_KEY = "__uhchat_sse_subs__";

type SseHandler = (lead: UhchatLead) => void;

function getLeads(): UhchatLead[] {
  const p = process as unknown as Record<string, unknown>;
  if (!p[_STORE_KEY]) p[_STORE_KEY] = [];
  return p[_STORE_KEY] as UhchatLead[];
}

function getSeenIds(): Set<string> {
  const p = process as unknown as Record<string, unknown>;
  if (!p[_SEEN_KEY]) {
    // Lần đầu truy cập → load từ file (sau server restart)
    p[_SEEN_KEY] = loadSeenFromFile();
    console.log(`[uhchat-store] Loaded ${(p[_SEEN_KEY] as Set<string>).size} seen IDs từ file`);
  }
  return p[_SEEN_KEY] as Set<string>;
}

function getSseSubs(): Set<SseHandler> {
  const p = process as unknown as Record<string, unknown>;
  if (!p[_SSE_KEY]) p[_SSE_KEY] = new Set<SseHandler>();
  return p[_SSE_KEY] as Set<SseHandler>;
}

// ── Giới hạn số leads giữ trong bộ nhớ ───────────────────────────────────────

const MAX_LEADS = 500;

// ── Public API ────────────────────────────────────────────────────────────────

/** Thêm lead mới vào store và thông báo tất cả SSE subscribers */
export function addLead(lead: UhchatLead): void {
  const leads = getLeads();
  const seen = getSeenIds();

  if (seen.has(lead.sessionId)) return; // đã xử lý
  seen.add(lead.sessionId);
  saveSeenToFile(seen); // persist qua restart

  leads.unshift(lead); // mới nhất lên đầu
  if (leads.length > MAX_LEADS) leads.splice(MAX_LEADS);

  // Thông báo SSE
  for (const handler of getSseSubs()) {
    try {
      handler(lead);
    } catch {
      // handler lỗi → bỏ qua
    }
  }

  console.log(`[uhchat-store] Lead mới: sessionId=${lead.sessionId} phone=${lead.phone ?? "(không có SĐT)"}`);
}

/** Lấy tất cả leads đã lưu (mới nhất đầu tiên) */
export function getStoredLeads(): UhchatLead[] {
  return getLeads();
}

/** Set cờ đã đồng bộ Getfly cho một sessionId */
export function markGetflySynced(sessionId: string): void {
  const leads = getLeads();
  const lead = leads.find((l) => l.sessionId === sessionId);
  if (lead) lead.getflysynced = true;
}

/** Set cờ đã đồng bộ Getfly theo số điện thoại (backup) */
export function markGetflySyncedByPhone(phone: string): void {
  const leads = getLeads();
  for (const lead of leads) {
    if (lead.phone === phone) lead.getflysynced = true;
  }
}

/** Lấy lead theo sessionId (để kiểm tra fingerprint) */
export function getStoredLeadById(sessionId: string): UhchatLead | undefined {
  return getLeads().find((l) => l.sessionId === sessionId);
}

/** Cập nhật messages + lastMsgPreview cho lead đã tồn tại */
export function updateLeadMessages(
  sessionId: string,
  messages: UhchatLead["messages"],
  patch: Partial<UhchatLead>,
): void {
  const lead = getLeads().find((l) => l.sessionId === sessionId);
  if (!lead) return;
  lead.messages = messages;
  if (patch.lastMsgPreview !== undefined) lead.lastMsgPreview = patch.lastMsgPreview;
  if (patch.phone && !lead.phone) lead.phone = patch.phone;
  if (patch.phones?.length) lead.phones = patch.phones;
  if (patch.currentPage) lead.currentPage = patch.currentPage;
  if (patch.referrer) lead.referrer = patch.referrer;
}

/** Trả về leads có SĐT nhưng chưa sync Getfly (để backfill khi bật toggle) */
export function getUnsynedLeadsWithPhone(): UhchatLead[] {
  return getLeads().filter((l) => l.phone && !l.getflysynced);
}

/** Trả về tập hợp sessionId đã xử lý (dùng để bỏ qua khi scrape) */
export function getSeenSessionIds(): Set<string> {
  return getSeenIds();
}

/** Đăng ký nhận sự kiện lead mới qua SSE */
export function subscribeUhchatLeads(handler: SseHandler): () => void {
  const subs = getSseSubs();
  subs.add(handler);
  console.log(`[uhchat-store] SSE đăng ký. Tổng subscriber: ${subs.size}`);
  return () => {
    subs.delete(handler);
    console.log(`[uhchat-store] SSE hủy. Tổng subscriber: ${subs.size}`);
  };
}

/** Xóa toàn bộ store (dùng để test) */
export function clearStore(): void {
  const p = process as unknown as Record<string, unknown>;
  p[_STORE_KEY] = [];
  p[_SEEN_KEY] = new Set<string>();
}
