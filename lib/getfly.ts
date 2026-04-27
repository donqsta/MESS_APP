import { GoogleGenerativeAI } from "@google/generative-ai";
import { AdReferral } from "@/lib/webhook-store";
import { getPostFirstComment } from "@/lib/facebook";

const GETFLY_BASE_URL = process.env.GETFLY_BASE_URL ?? "";
const GETFLY_API_KEY = process.env.GETFLY_API_KEY ?? "";

// ── Dự án quan tâm: ID trên Getfly CRM ──────────────────────────────────────
const PROJECT_ID = {
  VAN_PHUC: 1,
  PICITY_SKYZEN: 2,
  ARTISAN: 3,
  CELADON: 4,
  SPRINGVILLE: 5,
  MT_EASTMARK: 6,
  ELYSIAN: 7,
  THE_MEADOW: 8,
  PRIME_MASTER: 9,
  EATON_PARK: 10,
  CHUA_RO: 41,
} as const;

// Từ khóa → ID dự án (kiểm tra trong text tin nhắn hoặc tên ads)
const PROJECT_KEYWORDS: Array<{ patterns: RegExp; id: number }> = [
  { patterns: /v[aạ]n\s*ph[uú]c/i, id: PROJECT_ID.VAN_PHUC },
  { patterns: /picity|skyzen|sky\s*zen|sky\s*park/i, id: PROJECT_ID.PICITY_SKYZEN },
  { patterns: /artisan/i, id: PROJECT_ID.ARTISAN },
  { patterns: /celadon/i, id: PROJECT_ID.CELADON },
  { patterns: /spring\s*ville|springville/i, id: PROJECT_ID.SPRINGVILLE },
  { patterns: /eastmark|mt\s*eastmark/i, id: PROJECT_ID.MT_EASTMARK },
  { patterns: /elysian/i, id: PROJECT_ID.ELYSIAN },
  { patterns: /the\s*meadow|meadow/i, id: PROJECT_ID.THE_MEADOW },
  { patterns: /prime\s*master/i, id: PROJECT_ID.PRIME_MASTER },
  { patterns: /eaton\s*park|eaton/i, id: PROJECT_ID.EATON_PARK },
];

// Fallback theo Fanpage ID
const PAGE_DEFAULT_PROJECT: Record<string, number> = {
  "1691322607843700": PROJECT_ID.SPRINGVILLE,   // Spring Ville
  "280565692725266": PROJECT_ID.VAN_PHUC,        // Khu ĐT Vạn Phúc
  "646002805264466": PROJECT_ID.PRIME_MASTER,    // Prime Master
  "349848852373105": PROJECT_ID.PICITY_SKYZEN,   // Pi Group
  "1584010335165016": PROJECT_ID.CHUA_RO,        // Khải Hoàn Imperial
  "1807504546139538": PROJECT_ID.CHUA_RO,        // Gamuda Land VN (nhiều DA → cần phân tích)
  "245115559231275": PROJECT_ID.CHUA_RO,         // TNP Holdings
  "729397667519994": PROJECT_ID.CHUA_RO,         // TNP Vibes
};

// ── Bắt SĐT Việt Nam (hỗ trợ viết liền, cách khoảng, dấu chấm, gạch ngang) ──
// Ví dụ nhận diện được:
//   0909123456        → chuẩn
//   094 970 064 0     → cách khoảng từng nhóm
//   0909.123.456      → dấu chấm
//   094-970-0640      → gạch ngang
//   +84 909 123 456   → đầu số quốc tế
//   (094) 970-0640    → có ngoặc
const VALID_PHONE = /^0(?:3[2-9]|5[2689]|7[06-9]|8[0-9]|9[0-9])\d{7}$/;

// Regex rộng: bắt chuỗi bắt đầu 0/+84 + các chữ số xen kẽ dấu phân cách
const PHONE_RAW_REGEX = /(?:\+?84|0)\d(?:[\s.\-()]?\d){7,14}/g;

function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+84")) return "0" + digits.slice(3);
  if (digits.startsWith("84") && digits.length === 11) return "0" + digits.slice(2);
  return digits;
}

function extractByRegex(text: string): string[] {
  const seen = new Set<string>();
  const results: string[] = [];
  const matches = text.match(PHONE_RAW_REGEX) ?? [];
  for (const m of matches) {
    const normalized = normalizePhone(m);
    if (VALID_PHONE.test(normalized) && !seen.has(normalized)) {
      seen.add(normalized);
      results.push(normalized);
    }
  }
  return results;
}

// ── Gemini fallback: nhận diện SĐT khi regex không bắt được ─────────────────
let geminiClient: GoogleGenerativeAI | null = null;
function getGemini(): GoogleGenerativeAI | null {
  if (!process.env.GOOGLE_AI_API_KEY) return null;
  if (!geminiClient) geminiClient = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY);
  return geminiClient;
}

async function extractByAI(text: string): Promise<string[]> {
  const gemini = getGemini();
  if (!gemini) return [];

  try {
    const model = gemini.getGenerativeModel({
      model: "gemini-3.1-pro-preview",
      generationConfig: { responseMimeType: "application/json", temperature: 0 },
    });

    const prompt =
      `Trích xuất số điện thoại Việt Nam từ tin nhắn sau. ` +
      `Số hợp lệ gồm 10 chữ số, bắt đầu bằng 03x, 05x, 07x, 08x, 09x. ` +
      `Người dùng có thể viết cách khoảng, dấu chấm, gạch ngang hoặc tách từng chữ số. ` +
      `Trả về JSON array các số đã chuẩn hóa (10 chữ số, không khoảng trắng). Nếu không có trả về [].\n\n` +
      `Tin nhắn: "${text}"`;

    const result = await model.generateContent(prompt);
    const raw = result.response.text().trim();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return (parsed as unknown[])
      .map((p) => normalizePhone(String(p)))
      .filter((p) => VALID_PHONE.test(p));
  } catch (err) {
    console.warn("[AI Phone] Lỗi Gemini:", err instanceof Error ? err.message : err);
    return [];
  }
}

// ── Hàm chính: Regex trước, AI fallback nếu không tìm thấy ──────────────────
export async function extractPhoneNumbers(text: string): Promise<string[]> {
  const fromRegex = extractByRegex(text);
  if (fromRegex.length > 0) return fromRegex;

  // Chỉ gọi AI khi text trông có vẻ chứa số (tiết kiệm token)
  const hasDigits = /\d{3}/.test(text);
  if (!hasDigits) return [];

  console.log("[AI Phone] Regex không bắt được, thử Gemini cho:", text);
  const aiResult = await extractByAI(text);
  if (aiResult.length > 0) {
    console.log("[AI Phone] Gemini tìm thấy SĐT:", aiResult);
  } else {
    console.log("[AI Phone] Gemini không tìm thấy SĐT hợp lệ trong:", text);
  }
  return aiResult;
}

// ── Phát hiện dự án quan tâm ─────────────────────────────────────────────────
function matchProjectFromText(text: string): number | null {
  for (const { patterns, id } of PROJECT_KEYWORDS) {
    if (patterns.test(text)) return id;
  }
  return null;
}

export async function detectProject(
  messageText: string,
  referral: AdReferral | undefined,
  pageId: string,
  pageToken?: string
): Promise<number[]> {
  // Ưu tiên 1: Từ khóa trong tin nhắn
  const fromMsg = matchProjectFromText(messageText);
  if (fromMsg) return [fromMsg];

  // Ưu tiên 2: Tên quảng cáo (ad_title) hoặc ref param
  if (referral) {
    const adText = [referral.ad_title, referral.ref].filter(Boolean).join(" ");
    const fromAd = matchProjectFromText(adText);
    if (fromAd) return [fromAd];
  }

  // Ưu tiên 2.5: Đọc bình luận đầu tiên (comment gim) của bài đăng quảng cáo
  if (referral?.post_id && pageToken) {
    const firstComment = await getPostFirstComment(referral.post_id, pageToken);
    if (firstComment) {
      const fromComment = matchProjectFromText(firstComment);
      if (fromComment) {
        console.log(`[Getfly] Phát hiện dự án từ comment bài đăng (post_id=${referral.post_id}): ${fromComment}`);
        return [fromComment];
      }
    }
  }

  // Ưu tiên 3: Fallback theo fanpage
  const fallback = PAGE_DEFAULT_PROJECT[pageId] ?? PROJECT_ID.CHUA_RO;
  return [fallback];
}

// ── Xác định nguồn khách hàng ────────────────────────────────────────────────
export function buildSourceName(pageName: string, referral: AdReferral | undefined): string {
  const hasAd = referral?.source === "ADS" || !!referral?.ad_id;
  return hasAd ? `${pageName} - Facebook ads` : pageName;
}

// ── Tạo khách hàng mới trên Getfly CRM ──────────────────────────────────────
export interface GetflyLeadInput {
  accountName: string;         // Tên Facebook
  phone: string;               // SĐT bắt được
  pageName: string;            // Tên Fanpage
  pageId: string;              // ID Fanpage
  senderId: string;            // Facebook Page-Scoped User ID
  messageText: string;         // Tin nhắn chứa SĐT
  referral?: AdReferral;       // Dữ liệu quảng cáo (nếu có)
  pageToken?: string;          // Page access token — dùng để đọc comment bài đăng
}

export interface GetflyLeadResult {
  success: boolean;
  accountId?: number;
  accountCode?: string;
  error?: string;
  duplicate?: boolean;
}

export async function createGetflyLead(input: GetflyLeadInput): Promise<GetflyLeadResult> {
  if (!GETFLY_BASE_URL || !GETFLY_API_KEY) {
    console.warn("[Getfly] Chưa cấu hình GETFLY_BASE_URL hoặc GETFLY_API_KEY");
    return { success: false, error: "Chưa cấu hình Getfly" };
  }

  const projectIds = await detectProject(input.messageText, input.referral, input.pageId, input.pageToken);
  const sourceName = buildSourceName(input.pageName, input.referral);

  const description = [
    `[Messenger] Tin nhắn: "${input.messageText}"`,
    input.referral?.ad_title ? `Quảng cáo: ${input.referral.ad_title}` : "",
    `Fanpage: ${input.pageName}`,
  ]
    .filter(Boolean)
    .join(" | ");

  const payload: Record<string, unknown> = {
    account_name: input.accountName,
    phone_office: input.phone,
    account_source_names: [sourceName],
    account_type_names: ["KH tiềm năng"],
    description,
    custom_fields: {
      du_an_quan_tam: projectIds,
      facebook_link: `facebook.com/profile/${input.senderId}`,
    },
  };

  try {
    console.log("[Getfly] Tạo lead:", { phone: input.phone, project: projectIds, source: sourceName });

    const res = await fetch(`${GETFLY_BASE_URL}/api/v6.1/account`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": GETFLY_API_KEY,
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    if (!res.ok || data.error) {
      const msg: string = data.message ?? data.error ?? "Lỗi không xác định";

      // Kiểm tra trùng lặp SĐT
      const isDuplicate = msg.toLowerCase().includes("trùng") || msg.toLowerCase().includes("duplicate") || res.status === 422;

      console.warn("[Getfly] Tạo lead thất bại:", msg);
      return { success: false, error: msg, duplicate: isDuplicate };
    }

    console.log("[Getfly] Lead tạo thành công:", data.data);
    return {
      success: true,
      accountId: data.data?.account_id,
      accountCode: data.data?.account_code,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Lỗi kết nối Getfly";
    console.error("[Getfly] Exception:", msg);
    return { success: false, error: msg };
  }
}
