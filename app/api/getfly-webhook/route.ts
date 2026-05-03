/**
 * /api/getfly-webhook
 *
 * Nhận webhook từ Getfly CRM khi có sự kiện phát sinh.
 * Dùng để kích hoạt phân bổ lead SAU KHI Getfly xác nhận đã lưu.
 *
 * Sự kiện xử lý:
 *  - customer.created   → khách hàng mới được tạo (từ bất kỳ nguồn nào)
 *  - opportunity.created → cơ hội mới trong chiến dịch
 *
 * Getfly webhook chỉ gửi account_id / opportunity_id.
 * App sẽ gọi lại Getfly API để lấy đầy đủ thông tin (tên, SĐT, nguồn).
 *
 * Cách cấu hình trong Getfly:
 *   CRM → Cài đặt → Webhook → Thêm mới
 *   URL:    https://{your-domain}/api/getfly-webhook
 *   Events: customer.created, opportunity.created
 *   Secret: giá trị GETFLY_WEBHOOK_SECRET trong .env.local
 */

import { NextRequest, NextResponse } from "next/server";
import { distributeAfterCreate } from "@/lib/distributor-flow";

const GETFLY_BASE_URL = process.env.GETFLY_BASE_URL ?? "";
const GETFLY_API_KEY  = process.env.GETFLY_API_KEY  ?? "";
const WEBHOOK_SECRET  = process.env.GETFLY_WEBHOOK_SECRET ?? "";

// ── Verify secret key ─────────────────────────────────────────────────────────

function verifySecret(body: Record<string, unknown>): boolean {
  if (!WEBHOOK_SECRET) return true; // không cấu hình → bỏ qua verify
  return body.secret_key === WEBHOOK_SECRET;
}

// ── Fetch account details từ Getfly API ───────────────────────────────────────

interface GetflyAccount {
  account_name?: string;
  phone_office?:  string;
  description?:   string;
  account_source_details?: Array<{ id: number; label: string }>;
}

async function fetchAccount(accountId: number): Promise<GetflyAccount | null> {
  if (!GETFLY_BASE_URL || !GETFLY_API_KEY) return null;
  try {
    const url =
      `${GETFLY_BASE_URL}/api/v6.1/account/${accountId}` +
      `?fields=account_name,phone_office,description,account_source_details`;
    const res = await fetch(url, { headers: { "X-API-KEY": GETFLY_API_KEY } });
    if (!res.ok) return null;
    const data = await res.json() as { data?: GetflyAccount };
    return data.data ?? null;
  } catch (err) {
    console.warn("[getfly-webhook] Không lấy được account:", err instanceof Error ? err.message : err);
    return null;
  }
}

// Trích xuất tên trang/dự án từ account_source label
// Ví dụ: "Fanpage - Spring Ville - Ads" → "Spring Ville"
//         "Website - springville.city"   → "springville.city"
function extractSourceHint(sources: Array<{ label: string }> | undefined): string {
  if (!sources?.length) return "";
  const label = sources[0].label ?? "";
  // Lấy phần giữa "Fanpage - " / "Website - " và " - Ads" (nếu có)
  const match = label.match(/^(?:Fanpage|Website)\s*[-–]\s*(.+?)(?:\s*[-–]\s*Ads)?$/i);
  return match ? match[1].trim() : label;
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;

  // Hỗ trợ cả JSON lẫn application/x-www-form-urlencoded
  const contentType = req.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("application/json")) {
      body = await req.json() as Record<string, unknown>;
    } else {
      // urlencoded: event=customer.created&secret_key=...&data[account_id]=123
      const text = await req.text();
      const params = new URLSearchParams(text);
      body = {};
      for (const [k, v] of params.entries()) body[k] = v;
      // Ghép data[account_id] → body.data.account_id
      const data: Record<string, string> = {};
      for (const [k, v] of params.entries()) {
        const m = k.match(/^data\[(.+)\]$/);
        if (m) data[m[1]] = v;
      }
      if (Object.keys(data).length) body.data = data;
    }
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  // Verify secret
  if (!verifySecret(body)) {
    console.warn("[getfly-webhook] Secret không khớp");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const event  = (body.event as string) ?? "";
  const data   = (body.data as Record<string, unknown>) ?? {};
  const domain = (body.domain as string) ?? "";

  console.log(`[getfly-webhook] event=${event} domain=${domain} data=${JSON.stringify(data)}`);

  // ── customer.created ──────────────────────────────────────────────────────
  if (event === "customer.created") {
    const accountId = Number(data.account_id ?? data.id ?? 0);
    if (!accountId) {
      return NextResponse.json({ ok: true, note: "no account_id" });
    }

    // Fetch chi tiết account từ Getfly
    const account = await fetchAccount(accountId);
    if (!account) {
      console.warn(`[getfly-webhook] Không lấy được account #${accountId}`);
      return NextResponse.json({ ok: true, note: "account not found" });
    }

    const name    = account.account_name ?? "";
    const phone   = account.phone_office  ?? "";
    const summary = account.description   ?? "";
    const sourceHint = extractSourceHint(account.account_source_details);

    console.log(`[getfly-webhook] customer.created → name="${name}" phone=${phone} source="${sourceHint}"`);

    if (phone) {
      distributeAfterCreate({
        name:    name || phone,
        phone,
        summary: summary.slice(0, 200),
        pageUrl: sourceHint, // dùng để matchProject nếu chứa domain
      }).catch((e) => console.warn("[getfly-webhook] Lỗi phân bổ:", e));
    }
  }

  // ── opportunity.created ───────────────────────────────────────────────────
  if (event === "opportunity.created") {
    // Opportunity thường kèm account_id
    const accountId = Number(data.account_id ?? 0);
    if (accountId) {
      const account = await fetchAccount(accountId);
      if (account?.phone_office) {
        const sourceHint = extractSourceHint(account.account_source_details);
        distributeAfterCreate({
          name:    account.account_name || account.phone_office,
          phone:   account.phone_office,
          summary: (account.description ?? "").slice(0, 200),
          pageUrl: sourceHint,
        }).catch((e) => console.warn("[getfly-webhook] Lỗi phân bổ opportunity:", e));
      }
    }
  }

  return NextResponse.json({ ok: true });
}

// GET: health check / verify
export async function GET() {
  return NextResponse.json({ status: "getfly-webhook ready" });
}
