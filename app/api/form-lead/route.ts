import { NextRequest, NextResponse } from "next/server";
import { createGetflyLead } from "@/lib/getfly";

// ── CORS headers cho phép cross-origin từ website WordPress ──────────────────
const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

interface FormLeadBody {
  name?:        string;
  phone?:       string;
  email?:       string;
  description?: string;
  pageUrl?:     string;   // window.location.href của trang website
  siteName?:    string;   // data-site attribute trên script tag
  hasAds?:      boolean;  // true nếu có UTM params
  utm?: {
    utm_source?:   string;
    utm_medium?:   string;
    utm_campaign?: string;
    utm_content?:  string;
    utm_term?:     string;
  };
}

export async function POST(req: NextRequest) {
  let body: FormLeadBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: CORS });
  }

  // Debug: log toàn bộ payload nhận được
  console.log("[FormLead] Received body:", JSON.stringify(body));

  const phone = body.phone?.trim();
  if (!phone) {
    console.warn("[FormLead] Rejected: missing phone. Body keys:", Object.keys(body));
    return NextResponse.json({ error: "phone is required" }, { status: 400, headers: CORS });
  }

  const siteName  = body.siteName?.trim() || "Website";
  const pageUrl   = body.pageUrl  || "";
  const hasAds    = !!body.hasAds;
  const name      = body.name?.trim() || "";
  const email     = body.email?.trim() || "";
  const description = body.description?.trim() || "";

  console.log("[FormLead] Processing:", { phone, name, siteName, pageUrl, hasAds });

  // Tạo lead trên Getfly — project detect từ pageUrl (domain) bên trong createGetflyLead
  const result = await createGetflyLead({
    accountName:  name || "",
    phone,
    pageName:     siteName,         // tên web (buildSourceName sẽ thêm "Website - " prefix)
    pageId:       "web",            // prefix "web" → isWebSource = true
    senderId:     phone,
    messageText:  description || `Khách đăng ký từ ${siteName}`,
    pageUrl,                        // dùng detect dự án theo domain
    referral:     hasAds
      ? {
          source:  "ADS",
          type:    "OPEN_THREAD",
          ad_id:   body.utm?.utm_campaign || undefined,
          ad_title: body.utm?.utm_source
            ? `${body.utm.utm_source} / ${body.utm.utm_campaign || ""}`
            : undefined,
        }
      : undefined,
  });

  // Log UTM nếu có
  if (body.utm?.utm_source) {
    console.log(`[FormLead] UTM: source=${body.utm.utm_source} medium=${body.utm.utm_medium} campaign=${body.utm.utm_campaign}`);
  }

  if (result.success) {
    console.log(`[FormLead] Lead created — site="${siteName}" phone=${phone}`);
    return NextResponse.json({ success: true, accountId: result.accountId }, { headers: CORS });
  }

  if (result.duplicate) {
    console.log(`[FormLead] Duplicate — phone=${phone}`);
    return NextResponse.json({ success: false, duplicate: true }, { status: 409, headers: CORS });
  }

  console.warn(`[FormLead] Failed — ${result.error}`);
  return NextResponse.json({ success: false, error: result.error }, { status: 500, headers: CORS });
}
