import { NextRequest, NextResponse } from "next/server";
import { publish, AdReferral } from "@/lib/webhook-store";
import { addLog } from "@/lib/webhook-log";
import { recordAdLead, getAdLeadBySender } from "@/lib/ad-store";
import { extractPhoneNumbers, createGetflyLead } from "@/lib/getfly";
import { getPageFromEnv } from "@/lib/pages";
import { handleBotMessage } from "@/lib/ai-bot/botHandler";
import { getConversationIdBySender, getConversation } from "@/lib/ai-bot/botMemory";
import { getSenderProfile } from "@/lib/facebook";
import { startProactiveChecker } from "@/lib/ai-bot/proactiveChecker";
import { addLeadUserMessage, getLeadUserMessages } from "@/lib/lead-context-store";

// Khởi động proactive checker một lần duy nhất (singleton qua process object)
startProactiveChecker();

// GET: Meta verification handshake
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  addLog({
    timestamp: Date.now(),
    method: "GET",
    query: req.url.split("?")[1] ?? "",
    body: { mode, token_match: token === process.env.WEBHOOK_VERIFY_TOKEN, challenge },
  });

  if (mode === "subscribe" && token === process.env.WEBHOOK_VERIFY_TOKEN) {
    console.log("[Webhook] Verified successfully");
    return new NextResponse(challenge, { status: 200 });
  }

  console.warn("[Webhook] Verification failed");
  return new NextResponse("Forbidden", { status: 403 });
}

// POST: Receive messaging events from Meta
export async function POST(req: NextRequest) {
  const body = await req.json();

  addLog({ timestamp: Date.now(), method: "POST", query: "", body });

  if (body.object !== "page") {
    return NextResponse.json({ status: "ignored" });
  }

  for (const entry of body.entry ?? []) {
    const pageId: string = entry.id;

    for (const event of entry.messaging ?? []) {
      // Bỏ qua echo (tin page tự gửi)
      if (event.message?.is_echo) continue;

      const senderId: string = event.sender?.id;
      const timestamp: number = event.timestamp ?? Date.now();

      // Parse referral từ quảng cáo (Click-to-Messenger)
      // Referral có thể nằm trong event.referral HOẶC event.message.referral
      const rawReferral = event.referral ?? event.message?.referral;
      let referral: AdReferral | undefined;

      if (rawReferral) {
        referral = {
          source: rawReferral.source ?? "UNKNOWN",
          type: rawReferral.type ?? "UNKNOWN",
          ref: rawReferral.ref,
          ad_id: rawReferral.ad_id,
          adset_id: rawReferral.ads_context_data?.adset_id,
          campaign_id: rawReferral.ads_context_data?.campaign_id,
          ad_title: rawReferral.ads_context_data?.ad_title,
          photo_url: rawReferral.ads_context_data?.photo_url,
          video_url: rawReferral.ads_context_data?.video_url,
          post_id: rawReferral.ads_context_data?.post_id,
        };
        console.log("[Webhook] Ad referral detected:", referral);
      }

      // Tin nhắn thông thường
      if (event.message) {
        const text: string = event.message?.text ?? "";
        const mid: string = event.message?.mid ?? "";
        // conversationId từ webhook (nếu có) — fallback sang chuỗi tổng hợp
        const conversationId: string =
          event.message?.conversation_id ??
          `${pageId}_${senderId}`;

        publish({ pageId, senderId, text, mid, timestamp, referral });
        addLeadUserMessage(pageId, senderId, text, timestamp);

        // Nếu từ quảng cáo → ghi vào ad-store
        if (referral?.source === "ADS") {
          recordAdLead({ senderId, pageId, referral, firstMessageText: text, timestamp });
        }

        // Phát hiện SĐT → tạo lead trên Getfly CRM
        const phones = await extractPhoneNumbers(text);
        const page = getPageFromEnv(pageId);

        if (phones.length > 0) {
          // Tìm thêm dữ liệu ads referral từ store (kể cả tin nhắn trước đó)
          const existingAdLead = getAdLeadBySender(senderId);
          const activeReferral = referral ?? existingAdLead?.referral;

          // Fetch tên thật của người gửi (ưu tiên từ botMemory nếu bot đã lấy trước đó)
          const resolveAndCreate = async () => {
            // 1. Thử lấy từ botMemory (bot handler đã fetch profile khi nhắn tin đầu)
            const resolvedConvId = getConversationIdBySender(pageId, senderId);
            let displayName = resolvedConvId
              ? (getConversation(resolvedConvId)?.profile.displayName ?? "")
              : "";

            // 2. Fallback: gọi Facebook API trực tiếp
            if (!displayName && page?.accessToken) {
              const fbProfile = await getSenderProfile(senderId, page.accessToken);
              displayName = fbProfile.name;
            }

            // 3. Fallback cuối: để trống (Getfly sẽ hiển thị số điện thoại)
            if (!displayName) {
              console.warn(`[Getfly] Không lấy được tên — senderId=${senderId}`);
            }

            const result = await createGetflyLead({
              accountName: displayName,
              phone: phones[0],
              pageName: page?.name ?? `Page ${pageId}`,
              pageId,
              senderId,
              messageText: text,
              chatHistory: getLeadUserMessages(pageId, senderId),
              referral: activeReferral,
              pageToken: page?.accessToken,
            });

            if (result.success) {
              console.log(`[Getfly] Lead created — name="${displayName}" phone=${phones[0]} accountId=${result.accountId}`);
            } else if (result.duplicate) {
              console.log(`[Getfly] Lead đã tồn tại (SĐT trùng) — phone=${phones[0]}`);
            } else {
              console.warn(`[Getfly] Tạo lead thất bại — ${result.error}`);
            }
          };

          resolveAndCreate().catch((e) => console.error("[Getfly] Unhandled error:", e));
        }

        // AI Bot — fire-and-forget, concurrency được quản lý trong handleBotMessage
        // Tra cứu conversationId thực từ senderId mapping (đăng ký khi UI mở conversation)
        if (text && page?.accessToken) {
          const resolvedConvId = getConversationIdBySender(pageId, senderId) ?? conversationId;
          handleBotMessage({
            pageId,
            senderId,
            conversationId: resolvedConvId,
            text,
            pageToken: page.accessToken,
            pageName: page.name,
          });
        }
      }

      // Postback (nút bấm trong Messenger)
      if (event.postback) {
        const text = event.postback.title ?? event.postback.payload ?? "";
        const mid = `postback-${timestamp}`;
        publish({ pageId, senderId, text, mid, timestamp, referral });
      }
    }
  }

  return NextResponse.json({ status: "ok" });
}
