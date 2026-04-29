import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { fetchAllNewChats, getStatsVisitors, invalidateSession } from "@/lib/uhchat";
import {
  addLead,
  getSeenSessionIds,
  markGetflySynced,
  getStoredLeadById,
  updateLeadMessages,
} from "@/lib/uhchat-store";
import { createGetflyLead } from "@/lib/getfly";

/**
 * POST /api/uhchat/sync
 * Kéo tất cả cuộc chat mới từ uhchat.net, lưu vào store.
 * Chỉ tạo Getfly lead khi client gửi syncToGetfly = true.
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const forceRelogin = body?.forceRelogin === true;
  const syncToGetfly = body?.syncToGetfly === true;

  if (forceRelogin) invalidateSession();

  const seenIds = getSeenSessionIds();

  let newLeads;
  try {
    newLeads = await fetchAllNewChats(seenIds, getStoredLeadById, updateLeadMessages);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[uhchat/sync] Lỗi kéo data:", msg);
    return NextResponse.json({ error: msg, newLeads: 0 }, { status: 500 });
  }

  // Kéo thêm visitor từ trang Thống kê
  const statsLeads = await getStatsVisitors(seenIds).catch((err) => {
    console.warn("[uhchat/sync] Lỗi kéo thống kê:", err instanceof Error ? err.message : err);
    return [] as typeof newLeads;
  });

  const allNewLeads = [...newLeads, ...statsLeads];
  let getflySyncCount = 0;

  const processLead = async (lead: (typeof newLeads)[number]) => {
    addLead(lead);

    if (!syncToGetfly || !lead.phone) return;

    const siteName = (() => {
      try {
        return new URL(lead.currentPage ?? "").hostname.replace(/^www\./, "");
      } catch {
        return "Website";
      }
    })();

    const visitorMessages = lead.messages
      .filter((m) => m.from === "visitor")
      .map((m) => m.text);

    const lastVisitorMsg = visitorMessages[visitorMessages.length - 1] ?? "";
    const messageText = lastVisitorMsg || (lead.source === "stats" ? "Truy cập website" : "");

    // Hành trình xem trang
    const visitedPages = lead.visitedPages ?? (lead.currentPage ? [lead.currentPage] : []);
    const prevPages = visitedPages.slice(0, -1);
    const pageNote = prevPages.length > 0
      ? `[Khách đã xem qua: ${prevPages.map((u) => {
          try { return new URL(u).hostname + new URL(u).pathname; } catch { return u; }
        }).join(", ")}]`
      : null;

    // Toàn bộ hội thoại (có nhãn Khách/Tư vấn) để AI phân tích nhu cầu
    const fullConversation = lead.messages
      .filter((msg) => msg.text.trim())
      .map((msg) => `${msg.from === "visitor" ? "Khách" : "Tư vấn"}: ${msg.text}`);

    // Stats lead: không có hội thoại → dùng description cố định, bỏ qua AI
    const isStats = lead.source === "stats";
    const staticDescription = isStats
      ? `Khách truy cập trang: ${lead.currentPage ?? siteName}`
      : undefined;

    const chatHistory = isStats ? undefined : [
      ...(pageNote ? [pageNote] : []),
      ...fullConversation,
    ];

    try {
      const result = await createGetflyLead({
        accountName: lead.visitorName ?? "",
        phone: lead.phone,
        pageName: siteName,
        pageId: `web_uhchat`,
        senderId: lead.phone,
        messageText,
        chatHistory,
        pageUrl: lead.currentPage,
        description: staticDescription,
      });

      if (result.success) {
        markGetflySynced(lead.sessionId);
        getflySyncCount++;
        console.log(`[uhchat/sync] Lead Getfly OK: phone=${lead.phone} source=${lead.source ?? "chat"}`);
      } else if (result.duplicate) {
        markGetflySynced(lead.sessionId);
        console.log(`[uhchat/sync] Lead trùng SĐT: phone=${lead.phone}`);
      } else {
        console.warn(`[uhchat/sync] Getfly lỗi: ${result.error}`);
      }
    } catch (err) {
      console.error("[uhchat/sync] Getfly exception:", err instanceof Error ? err.message : err);
    }
  };

  for (const lead of allNewLeads) {
    await processLead(lead);
  }

  return NextResponse.json({
    newLeads: newLeads.length,
    newStats: statsLeads.length,
    getflySynced: getflySyncCount,
    syncToGetfly,
    timestamp: new Date().toISOString(),
  });
}
