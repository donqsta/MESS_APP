/**
 * Server-side UChat poller — chạy độc lập, không phụ thuộc vào browser.
 * Singleton qua process object (giống proactiveChecker).
 * Khởi động một lần từ app/api/uhchat/sync/route.ts khi app boot.
 */

import { fetchAllNewChats, getStatsVisitors } from "@/lib/uhchat";
import {
  addLead,
  getSeenSessionIds,
  markGetflySynced,
  isGetflySynced,
  getStoredLeadById,
  updateLeadMessages,
  getUnsynedLeadsWithPhone,
} from "@/lib/uhchat-store";
import { createGetflyLead } from "@/lib/getfly";

const POLL_INTERVAL_MS = parseInt(process.env.UHCHAT_POLL_INTERVAL_MS ?? "30000", 10);
const _POLLER_KEY = "__uhchat_poller_started__";

export function startUhchatPoller(): void {
  const p = process as unknown as Record<string, unknown>;
  if (p[_POLLER_KEY]) return;
  p[_POLLER_KEY] = true;
  console.log(`[uhchat-poller] Server-side polling bắt đầu — interval: ${POLL_INTERVAL_MS / 1000}s`);

  // Chạy ngay lần đầu sau 5s (cho app boot xong)
  setTimeout(() => runPoll().catch(console.error), 5000);

  setInterval(() => runPoll().catch(console.error), POLL_INTERVAL_MS);
}

async function runPoll(): Promise<void> {
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

type Lead = Awaited<ReturnType<typeof fetchAllNewChats>>[number];

async function processLead(
  lead: Lead,
  syncToGetfly: boolean,
  onSynced: (count: number) => void,
): Promise<void> {
  addLead(lead);

  const allPhones = lead.phones?.length
    ? lead.phones
    : lead.phone ? [lead.phone] : [];

  if (!syncToGetfly || allPhones.length === 0) return;

  if (isGetflySynced(lead.sessionId)) {
    console.log(`[uhchat-poller] Bỏ qua (đã sync): sessionId=${lead.sessionId.slice(0, 8)}…`);
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
        console.log(`[uhchat-poller] Lead Getfly OK: phone=${phone} source=${lead.source ?? "chat"}`);
      } else if (result.duplicate) {
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
