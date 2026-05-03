import { NextRequest, NextResponse } from "next/server";
import { verifyZaloSignature, handleZaloReply, sendZaloMessage } from "@/lib/zalo-bot";
import {
  isPendingRegistration,
  startPendingRegistration,
  registerEmployee,
  getPhoneByZaloId,
} from "@/lib/zalo-employee-registry";
import { extractPhoneFromMessage } from "@/lib/zalo-phone-extractor";

/**
 * Zalo Bot webhook endpoint.
 *
 * Zalo gọi GET để verify URL (trả về challenge).
 * Zalo gọi POST khi có event từ người dùng (tin nhắn DM hoặc trong nhóm).
 *
 * Cấu hình trong Zalo Developer Console:
 *   Webhook URL: https://{your-domain}/api/zalo-webhook
 *   Events: user_send_text, group_message (nếu bot trong nhóm)
 *
 * ── Luồng đăng ký trong nhóm ─────────────────────────────────────────────────
 * Admin add bot vào nhóm Zalo của nhân viên.
 * Nhân viên gửi SĐT 10 số vào nhóm (hoặc DM bot).
 * Bot tự động:
 *   1. Nhận SĐT từ tin nhắn
 *   2. Tra cứu nhân viên Getfly theo SĐT (qua API)
 *   3. Lưu mapping displayName + zaloId + phone → employee
 *   4. Xác nhận thành công trong nhóm/DM
 */

// GET: Xác thực webhook URL với Zalo
export async function GET(req: NextRequest) {
  const challenge = req.nextUrl.searchParams.get("challenge");
  if (challenge) {
    return new NextResponse(challenge, { status: 200 });
  }
  return NextResponse.json({ status: "ok" });
}

// POST: Nhận events từ Zalo Bot
export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    // Zalo Bot Platform: plain text secret trong header X-Bot-Api-Secret-Token
    const signature = req.headers.get("x-bot-api-secret-token") ?? "";

    if (!verifyZaloSignature(rawBody, signature)) {
      console.warn("[zalo-webhook] Chữ ký không hợp lệ");
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    // Payload thực tế bọc trong { ok: true, result: { event_name, message } }
    const body = JSON.parse(rawBody) as { ok?: boolean; result?: ZaloEvent } | ZaloEvent;
    const event: ZaloEvent = ("result" in body && body.result) ? body.result : body as ZaloEvent;

    // Cấu trúc thực tế của Zalo Bot event:
    // event.message.from.id / display_name  ← sender
    // event.message.text                    ← nội dung
    // event.message.chat.chat_type          ← "GROUP" | "PRIVATE"
    // event.message.chat.id                 ← groupId hoặc userId
    const msg = event.message;
    const senderId = msg?.from?.id ?? "";
    const senderName = msg?.from?.display_name ?? "";
    const text = (msg?.text ?? "").trim();
    const isGroupMsg = msg?.chat?.chat_type === "GROUP";
    const groupId = isGroupMsg ? (msg?.chat?.id ?? "") : "";

    console.log(
      `[zalo-webhook] type=${event.event_name} from=${senderId}(${senderName}) ` +
      `group=${isGroupMsg ? groupId : "DM"} text="${text.slice(0, 50)}"`
    );

    if (event.event_name === "message.text.received" && senderId && !msg?.from?.is_bot) {
      // ── Resolve pending online-check pings (DM only) ─────────────────────
      if (!isGroupMsg) {
        await handleZaloReply(senderId, text);
      }

      // ── Luồng đăng ký (DM hoặc nhóm) ────────────────────────────────────
      // AI-powered phone extraction: "0902 512 1 2 3", "090.251.2123", v.v.
      const phone = await extractPhoneFromMessage(text);

      if (phone) {
        await handlePhoneRegistration(senderId, senderName, phone, isGroupMsg, groupId);
      } else if (!isGroupMsg) {
        // DM, không phải SĐT — kiểm tra pending registration
        const lowerText = text.toLowerCase().replace(/\s+/g, "");
        if (lowerText === "dangky" || lowerText === "đăngký" || lowerText === "register") {
          startPendingRegistration(senderId);
          await sendZaloMessage(
            senderId,
            "Xin chào! Gửi số điện thoại của bạn để đăng ký nhận thông báo lead.\n(Có thể nhắn nhiều định dạng: 0909123456, 0909 123 456, 09.091.23456...)"
          );
        } else if (isPendingRegistration(senderId)) {
          await sendZaloMessage(senderId, "Không nhận diện được số điện thoại hợp lệ. Vui lòng gửi lại SĐT 10 chữ số (vd: 0909123456).");
        } else if (!getPhoneByZaloId(senderId) && text.length < 50) {
          await sendZaloMessage(
            senderId,
            `Xin chào ${senderName || ""}! Gõ "dangky" hoặc gửi SĐT của bạn để nhận thông báo lead.`
          );
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[zalo-webhook] Lỗi:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// ── Phone registration handler ─────────────────────────────────────────────────

async function handlePhoneRegistration(
  zaloId: string,
  displayName: string,
  phone: string,
  isGroup: boolean,
  groupId: string
): Promise<void> {
  // Tra cứu nhân viên Getfly theo SĐT
  const getflyEmp = await findGetflyEmployeeByPhone(phone);

  if (getflyEmp) {
    // Tìm thấy → đăng ký mapping
    registerEmployee(phone, zaloId);

    const confirmMsg =
      `✅ Đăng ký thành công!\n` +
      `👤 ${getflyEmp.contact_name} (Getfly #${getflyEmp.user_id})\n` +
      `📞 ${phone}\n` +
      `Bạn sẽ nhận thông báo lead qua Zalo này.`;

    if (isGroup && groupId) {
      await sendZaloGroupMessage(groupId, `@${displayName} ${confirmMsg}`);
    } else {
      await sendZaloMessage(zaloId, confirmMsg);
    }
    console.log(`[zalo-webhook] Đăng ký thành công: ${displayName} → phone=${phone} getfly=${getflyEmp.contact_name}`);
  } else {
    // Không tìm thấy trong Getfly — hiển thị SĐT đã nhận diện để NV biết
    const notFoundMsg =
      `⚠️ Số điện thoại ${phone} không khớp với bất kỳ nhân viên nào trong Getfly.\n` +
      `Nếu sai số, hãy gửi lại SĐT đúng.\n` +
      `Nếu đúng, liên hệ quản lý để kiểm tra SĐT đăng ký trong Getfly.`;

    if (isGroup && groupId) {
      await sendZaloGroupMessage(groupId, `@${displayName} ${notFoundMsg}`);
    } else {
      await sendZaloMessage(zaloId, notFoundMsg);
    }
    console.log(`[zalo-webhook] Không tìm thấy Getfly employee: phone=${phone} name=${displayName}`);
  }
}

// ── Getfly employee lookup by phone ───────────────────────────────────────────

interface GetflyUserMin {
  user_id: number;
  contact_name: string;
  contact_mobile: string;
}

async function findGetflyEmployeeByPhone(phone: string): Promise<GetflyUserMin | null> {
  const baseUrl = process.env.GETFLY_BASE_URL;
  const apiKey = process.env.GETFLY_API_KEY;
  if (!baseUrl || !apiKey) return null;

  try {
    // Normalize phone để search: bỏ dấu +84 prefix
    const searchPhone = phone.startsWith("0") ? phone : "0" + phone.slice(-9);
    const url = `${baseUrl}/api/v6.1/users?fields=user_id,contact_name,contact_mobile&filtering[contact_mobile:contains]=${encodeURIComponent(searchPhone)}&limit=5`;
    const res = await fetch(url, { headers: { "X-API-KEY": apiKey } });
    if (!res.ok) return null;

    const data = await res.json() as { data?: GetflyUserMin[] };
    const users = data.data ?? [];

    // Tìm match chính xác
    const normalizeP = (p: string) => p.replace(/\D/g, "").replace(/^84/, "0");
    const exact = users.find((u) => normalizeP(u.contact_mobile) === normalizeP(phone));
    return exact ?? users[0] ?? null;
  } catch (err) {
    console.warn("[zalo-webhook] Không tra được Getfly:", err instanceof Error ? err.message : err);
    return null;
  }
}

// ── Send group message ─────────────────────────────────────────────────────────

async function sendZaloGroupMessage(groupId: string, text: string): Promise<void> {
  const token = process.env.ZALO_BOT_TOKEN;
  if (!token) return;

  try {
    // Zalo Bot Platform: group cũng dùng chat_id = groupId
    const url = `https://bot-api.zaloplatforms.com/bot${token}/sendMessage`;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: groupId, text }),
    });
  } catch (err) {
    console.warn("[zalo-webhook] Gửi tin nhóm thất bại:", err instanceof Error ? err.message : err);
  }
}

// ── Zalo event types ───────────────────────────────────────────────────────────

interface ZaloEvent {
  event_name: string;
  message?: {
    date?: number;
    message_id?: string;
    text?: string;
    from?: {
      id: string;
      is_bot?: boolean;
      display_name?: string;
    };
    chat?: {
      chat_type?: "GROUP" | "PRIVATE";
      id?: string;
    };
  };
}
