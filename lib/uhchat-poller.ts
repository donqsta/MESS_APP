/**
 * Server-side UChat poller — chạy độc lập, không phụ thuộc vào browser.
 * Singleton qua process object (giống proactiveChecker).
 * Khởi động một lần từ app/api/uhchat/sync/route.ts khi app boot.
 */

import fs from "fs";
import path from "path";
import { fetchAllNewChats, getStatsVisitors } from "@/lib/uhchat";
import {
  addLead,
  getSeenSessionIds,
  markGetflySynced,
  isGetflySynced,
  markPhoneSynced,
  isPhoneSynced,
  getStoredLeadById,
  updateLeadMessages,
  getUnsynedLeadsWithPhone,
} from "@/lib/uhchat-store";
import { createGetflyLead } from "@/lib/getfly";

const POLL_INTERVAL_MS = parseInt(process.env.UHCHAT_POLL_INTERVAL_MS ?? "30000", 10);
const _POLLER_KEY = "__uhchat_poller_started__";
const GFLY_SYNCED_FILE = path.join(process.cwd(), "data", "uhchat-getfly-synced.json");

export function startUhchatPoller(): void {
  const p = process as unknown as Record<string, unknown>;
  if (p[_POLLER_KEY]) return;
  p[_POLLER_KEY] = true;
  console.log(`[uhchat-poller] Server-side polling bắt đầu — interval: ${POLL_INTERVAL_MS / 1000}s`);

  // Chạy ngay lần đầu sau 5s (cho app boot xong)
  setTimeout(() => runPoll(true).catch(console.error), 5000);

  setInterval(() => runPoll(false).catch(console.error), POLL_INTERVAL_MS);
}

/**
 * Lần đầu sau deploy mà file synced không tồn tại → seed mode.
 * Lấy tất cả lead hiện tại, mark "đã synced" mà KHÔNG sync Getfly.
 * Mục đích: tránh sync hàng loạt lead cũ khi data/ bị wipe (như webhook chỉ xử lý event mới).
 */
async function runPoll(isFirstPoll: boolean): Promise<void> {
  // Nếu là lần đầu chạy + synced file chưa tồn tại → SEED MODE
  const isFreshDeploy = isFirstPoll && !fs.existsSync(GFLY_SYNCED_FILE);
  if (isFreshDeploy) {
    await seedInitialState();
    return;
  }

  const syncToGetfly = process.env.UHCHAT_SYNC_TO_GETFLY === "true";
  const seenIds = getSeenSessionIds();

  let newLeads;
  try {
    newLeads = await fetchAllNewChats(seenIds, getStoredLeadById, updateLeadMessages);
  } catch (err) {
    console.error("[uhchat-poller] Lỗi kéo data:", err instanceof Error ? err.message : err);
    return;
  }

  const statsLeads = await getStatsVisitors(seenIds).catch((err) => {
    console.warn("[uhchat-poller] Lỗi kéo thống kê:", err instanceof Error ? err.message : err);
    return [] as typeof newLeads;
  });

  const allNewLeads = [...newLeads, ...statsLeads];
  let syncCount = 0;

  for (const lead of allNewLeads) {
    await processLead(lead, syncToGetfly, (n) => { syncCount += n; });
  }

  // Backfill: leads có SĐT nhưng chưa sync Getfly
  if (syncToGetfly) {
    const processedIds = new Set(allNewLeads.map((l) => l.sessionId));
    const unsynced = getUnsynedLeadsWithPhone().filter((l) => !processedIds.has(l.sessionId));
    if (unsynced.length > 0) {
      console.log(`[uhchat-poller] Backfill ${unsynced.length} leads chưa sync Getfly`);
      for (const lead of unsynced) {
        await processLead(lead, syncToGetfly, (n) => { syncCount += n; });
      }
    }
  }

  if (allNewLeads.length > 0 || syncCount > 0) {
    console.log(`[uhchat-poller] Kết quả: newLeads=${allNewLeads.length} getflySynced=${syncCount}`);
  }
}

/**
 * Seed mode: gọi 1 lần khi fresh deploy (data/ trống).
 * Fetch tất cả lead đang có trên uhchat → mark "đã synced" mà không gửi Getfly.
 * Sau lần này, chỉ lead MỚI xuất hiện sau seed mới được sync.
 */
async function seedInitialState(): Promise<void> {
  console.log("[uhchat-poller] FRESH DEPLOY phát hiện — chạy SEED MODE (không sync Getfly)");
  const seenIds = getSeenSessionIds();

  const newLeads = await fetchAllNewChats(seenIds, getStoredLeadById, updateLeadMessages).catch((err) => {
    console.error("[uhchat-poller] Seed: lỗi fetchAllNewChats:", err instanceof Error ? err.message : err);
    return [];
  });
  const statsLeads = await getStatsVisitors(seenIds).catch((err) => {
    console.warn("[uhchat-poller] Seed: lỗi getStatsVisitors:", err instanceof Error ? err.message : err);
    return [] as typeof newLeads;
  });

  const all = [...newLeads, ...statsLeads];
  let totalPhones = 0;
  for (const lead of all) {
    addLead(lead);
    markGetflySynced(lead.sessionId);
    // Mark từng SĐT của session để dedup theo phone-level về sau
    const phones = lead.phones?.length ? lead.phones : (lead.phone ? [lead.phone] : []);
    for (const phone of phones) {
      markPhoneSynced(lead.sessionId, phone);
      totalPhones++;
    }
  }
  console.log(`[uhchat-poller] SEED hoàn tất: ${all.length} leads + ${totalPhones} SĐT (${newLeads.length} chat + ${statsLeads.length} stats) đã đánh dấu synced. KHÔNG gửi sang Getfly.`);
}

type Lead = Awaited<ReturnType<typeof fetchAllNewChats>>[number];

async function processLead(
  lead: Lead,
  syncToGetfly: boolean,
  onSynced: (count: number) => void,
): Promise<void> {
  addLead(lead);

  const allPhonesRaw = lead.phones?.length
    ? lead.phones
    : lead.phone ? [lead.phone] : [];

  if (!syncToGetfly || allPhonesRaw.length === 0) return;

  // Dedup theo từng SĐT — cho phép cùng session sync nhiều SĐT khác nhau
  const allPhones = allPhonesRaw.filter((p) => {
    if (isPhoneSynced(lead.sessionId, p)) {
      console.log(`[uhchat-poller] Bỏ qua SĐT đã sync: sessionId=${lead.sessionId.slice(0, 8)}… phone=${p}`);
      return false;
    }
    return true;
  });

  if (allPhones.length === 0) {
    // Tất cả SĐT trong session này đã sync rồi
    if (!isGetflySynced(lead.sessionId)) markGetflySynced(lead.sessionId);
    return;
  }

  const siteName = (() => {
    try { return new URL(lead.currentPage ?? "").hostname.replace(/^www\./, ""); }
    catch { return "Website"; }
  })();

  const visitorMessages = lead.messages.filter((m) => m.from === "visitor").map((m) => m.text);
  const lastVisitorMsg = visitorMessages[visitorMessages.length - 1] ?? "";
  const messageText = lastVisitorMsg || (lead.source === "stats" ? "Truy cập website" : "");

  const visitedPages = lead.visitedPages ?? (lead.currentPage ? [lead.currentPage] : []);
  const prevPages = visitedPages.slice(0, -1);
  const pageNote = prevPages.length > 0
    ? `[Khách đã xem qua: ${prevPages.map((u) => {
        try { return new URL(u).hostname + new URL(u).pathname; } catch { return u; }
      }).join(", ")}]`
    : null;

  const isStats = lead.source === "stats";
  const staticDescription = isStats
    ? `Khách truy cập trang: ${(() => { try { const u = new URL(lead.currentPage ?? ""); return u.origin; } catch { return siteName; } })()}`
    : undefined;

  const fullConversation = lead.messages
    .filter((msg) => msg.text.trim())
    .map((msg) => `${msg.from === "visitor" ? "Khách" : "Tư vấn"}: ${msg.text}`);

  const chatHistory = isStats ? undefined : [
    ...(pageNote ? [pageNote] : []),
    ...fullConversation,
  ];

  let allSynced = true;
  for (const phone of allPhones) {
    try {
      const result = await createGetflyLead({
        accountName: lead.visitorName ?? "",
        phone,
        pageName: siteName,
        pageId: "web_uhchat",
        senderId: phone,
        messageText,
        chatHistory,
        pageUrl: lead.currentPage,
        description: staticDescription,
      });

      if (result.success) {
        onSynced(1);
        markPhoneSynced(lead.sessionId, phone);
        console.log(`[uhchat-poller] Lead Getfly OK: phone=${phone} source=${lead.source ?? "chat"}`);
      } else if (result.duplicate) {
        // SĐT đã có ở Getfly từ nguồn khác — vẫn coi như sync xong cặp này
        markPhoneSynced(lead.sessionId, phone);
        console.log(`[uhchat-poller] Lead trùng SĐT: phone=${phone}`);
      } else {
        console.warn(`[uhchat-poller] Getfly lỗi (phone=${phone}): ${result.error}`);
        allSynced = false;
      }
    } catch (err) {
      console.error(`[uhchat-poller] Exception (phone=${phone}):`, err instanceof Error ? err.message : err);
      allSynced = false;
    }
  }

  if (allSynced) markGetflySynced(lead.sessionId);
}
