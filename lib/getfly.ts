import { GoogleGenerativeAI } from "@google/generative-ai";
import { AdReferral } from "@/lib/webhook-store";
import { getPostFirstComment } from "@/lib/facebook";
import { matchProject, matchByKeyword, getProjectForPage } from "@/lib/projectMatcher";

const GETFLY_BASE_URL = process.env.GETFLY_BASE_URL ?? "";
const GETFLY_API_KEY = process.env.GETFLY_API_KEY ?? "";
const GETFLY_RELATION_ID_LEAD_MOI = Number(process.env.GETFLY_RELATION_ID_LEAD_MOI ?? "1");

// Fanpage fallback đọc từ data/projects.json (field pageIds) — không còn hardcode

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

/**
 * @deprecated Dùng matchProject() từ lib/projectMatcher.ts cho async + AI fallback.
 * Giữ lại để tương thích với code cũ (sync, keyword-only).
 */
export function matchProjectFromText(text: string): number | null {
  return matchByKeyword(text);
}

export async function detectProject(
  messageText: string,
  referral: AdReferral | undefined,
  pageId: string,
  pageToken?: string
): Promise<number[]> {
  // Ưu tiên 1: Từ khóa / AI trong tin nhắn
  const fromMsg = await matchProject(messageText);
  if (fromMsg) return [fromMsg];

  // Ưu tiên 2: Tên quảng cáo (ad_title) hoặc ref param
  if (referral) {
    const adText = [referral.ad_title, referral.ref].filter(Boolean).join(" ");
    const fromAd = await matchProject(adText);
    if (fromAd) return [fromAd];
  }

  // Ưu tiên 2.5: Đọc bình luận đầu tiên (comment gim) của bài đăng quảng cáo
  if (referral?.post_id && pageToken) {
    const firstComment = await getPostFirstComment(referral.post_id, pageToken);
    if (firstComment) {
      const fromComment = await matchProject(firstComment);
      if (fromComment) {
        console.log(`[Getfly] Phát hiện dự án từ comment bài đăng (post_id=${referral.post_id}): ${fromComment}`);
        return [fromComment];
      }
    }
  }

  // Ưu tiên 3: Fallback theo fanpage (đọc từ pageIds trong projects.json)
  return [getProjectForPage(pageId)];
}

// ── Xác định nguồn khách hàng ────────────────────────────────────────────────

/**
 * Xây dựng tên nguồn Getfly theo loại:
 * - Facebook Fanpage: "Fanpage - {pageName}" / "Fanpage - {pageName} - Ads"
 * - Website form:     "Website - {siteName}" / "Website - {siteName} - Ads"
 */
export function buildSourceName(pageName: string, referral: AdReferral | undefined, isWeb = false, pageUrl?: string): string {
  const hasAdReferral = referral?.source === "ADS" || !!referral?.ad_id;

  if (isWeb && pageUrl) {
    try {
      const parsed = new URL(pageUrl);
      const origin = parsed.origin + "/";
      const hasAdParam = hasAdReferral
        || !!parsed.searchParams.get("gclid")
        || !!parsed.searchParams.get("gad_source")
        || !!parsed.searchParams.get("gad_campaignid")
        || !!parsed.searchParams.get("fbclid")
        || !!parsed.searchParams.get("msclkid")
        || !!parsed.searchParams.get("utm_source");
      return hasAdParam ? `website ${origin} ads` : `website ${origin}`;
    } catch {
      // fallback bên dưới nếu URL không hợp lệ
    }
  }

  const prefix = isWeb ? "Website" : "Fanpage";
  return hasAdReferral ? `${prefix} - ${pageName} - Ads` : `${prefix} - ${pageName}`;
}

/**
 * Nguồn cho lead từ web form.
 * @deprecated Dùng buildSourceName(siteName, referral, true) thay thế.
 */
export function buildWebSourceName(siteName: string, hasAds: boolean): string {
  return hasAds ? `Website - ${siteName} - Ads` : `Website - ${siteName}`;
}

// ── Tạo khách hàng mới trên Getfly CRM ──────────────────────────────────────
export interface GetflyLeadInput {
  accountName: string;         // Tên Facebook hoặc tên khách từ form
  phone: string;               // SĐT bắt được
  pageName: string;            // Tên Fanpage hoặc tên website
  pageId: string;              // ID Fanpage; bắt đầu "web" nếu từ web form
  senderId: string;            // Facebook PSID hoặc phone (web form)
  messageText: string;         // Tin nhắn / mô tả chứa SĐT
  chatHistory?: string[];      // Lịch sử chat gần nhất để AI đọc nhu cầu
  referral?: AdReferral;       // Dữ liệu quảng cáo (nếu có)
  pageToken?: string;          // Page access token — dùng để đọc comment bài đăng
  pageUrl?: string;            // URL trang web (web form) — dùng detect dự án từ domain
  description?: string;        // Ghi chú cố định — bỏ qua AI khi được truyền
}

export interface GetflyLeadResult {
  success: boolean;
  accountId?: number;
  accountCode?: string;
  error?: string;
  duplicate?: boolean;
}

function maskPhone(phone: string): string {
  if (phone.length < 7) return phone;
  return `${phone.slice(0, 3)}****${phone.slice(-3)}`;
}


interface LeadNeedSummary {
  productName?: string;
  area?: string;
  budget?: string;
  note?: string;
}

function buildNeedSummaryText(summary: LeadNeedSummary | null): string {
  if (!summary) return "";

  const parts: string[] = [];
  if (summary.productName) parts.push(`Khách quan tâm ${summary.productName}`);
  if (summary.area) parts.push(`diện tích ${summary.area}`);
  if (summary.budget) parts.push(`mức giá/ngân sách ${summary.budget}`);
  if (summary.note) parts.push(summary.note);

  if (parts.length === 0) return "";
  return parts.join(". ").replace(/\.\s*$/g, "") + ".";
}

async function summarizeLeadNeeds(input: GetflyLeadInput): Promise<LeadNeedSummary | null> {
  const gemini = getGemini();
  if (!gemini) return null;

  const mergedHistory = [...(input.chatHistory ?? []), input.messageText]
    .map((s) => s.trim())
    .filter(Boolean);

  // Chống lặp tin nhắn giống nhau (thường xảy ra khi message hiện tại đã có trong history)
  const seen = new Set<string>();
  const dedupedHistory = mergedHistory.filter((msg) => {
    const key = msg.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const rawHistory = dedupedHistory.slice(-15);
  if (rawHistory.length === 0) return null;

  const historyText = rawHistory.map((m, idx) => `${idx + 1}. ${m}`).join("\n");

  const prompt =
    `Bạn là trợ lý CRM BĐS. Trích xuất nhu cầu khách từ đoạn chat sau.\n` +
    `Mục tiêu lấy 3 thông tin chính nếu có đề cập:\n` +
    `- productName: tên dự án/sản phẩm (vd: căn hộ 2PN, shophouse, Springville...)\n` +
    `- area: diện tích (vd: 65m2, 5x20, khoảng 70-80m2...)\n` +
    `- budget: mức giá/ngân sách (vd: 3 tỷ, tầm 40tr/m2...)\n` +
    `- note: ghi chú ngắn 1 câu về câu hỏi/ưu tiên của khách (vd: hỏi ở đâu, cách sân bay bao xa, pháp lý, tiến độ...)\n\n` +
    `QUAN TRỌNG:\n` +
    `- Không đưa số điện thoại vào productName/area/budget/note.\n` +
    `- Không lặp lại cùng một thông tin nhiều lần.\n` +
    `- Nếu khách hỏi về vị trí, khoảng cách, tiện ích thì ưu tiên đưa vào note rõ ràng.\n\n` +
    `Nếu không thấy thông tin thì để chuỗi rỗng "".\n` +
    `Trả về JSON duy nhất theo schema:\n` +
    `{"productName":"","area":"","budget":"","note":""}\n\n` +
    `ĐOẠN CHAT:\n${historyText}`;

  try {
    const model = gemini.getGenerativeModel({
      model: "gemini-3.1-pro-preview",
      generationConfig: { responseMimeType: "application/json", temperature: 0 },
    });

    const result = await model.generateContent(prompt);
    const raw = result.response.text().trim();
    const parsed = JSON.parse(raw) as Partial<LeadNeedSummary>;

    return {
      productName: String(parsed.productName ?? "").trim(),
      area: String(parsed.area ?? "").trim(),
      budget: String(parsed.budget ?? "").trim(),
      note: String(parsed.note ?? "").trim(),
    };
  } catch (err) {
    console.warn("[Getfly] AI phân tích nhu cầu lỗi:", err instanceof Error ? err.message : err);
    return null;
  }
}

export async function createGetflyLead(input: GetflyLeadInput): Promise<GetflyLeadResult> {
  if (!GETFLY_BASE_URL || !GETFLY_API_KEY) {
    console.warn("[Getfly] Chưa cấu hình GETFLY_BASE_URL hoặc GETFLY_API_KEY");
    return { success: false, error: "Chưa cấu hình Getfly" };
  }

  const isWebSource = input.pageId.startsWith("web");

  // Detect dự án:
  //   Web form  → ưu tiên từ pageUrl (domain + AI), sau đó messageText
  //   Facebook  → từ messageText / referral / fanpage
  let projectIds: number[];
  if (isWebSource && input.pageUrl) {
    const fromUrl = await matchProject(input.pageUrl);
    if (fromUrl) {
      projectIds = [fromUrl];
    } else {
      projectIds = await detectProject(input.messageText, input.referral, input.pageId, input.pageToken);
    }
  } else {
    projectIds = await detectProject(input.messageText, input.referral, input.pageId, input.pageToken);
  }

  // Tên nguồn:
  //   Web form  → "website {url}" / "website {url} ads"
  //   Facebook  → "Fanpage - {pageName}" / "Fanpage - {pageName} - Ads"
  const sourceName = buildSourceName(input.pageName, input.referral, isWebSource, isWebSource ? input.pageUrl : undefined);

  let description: string;
  if (input.description) {
    description = input.description;
  } else {
    const needSummary = await summarizeLeadNeeds(input);
    const needSummaryText = buildNeedSummaryText(needSummary);
    description = needSummaryText || `Khách để lại SĐT ${input.phone} để được tư vấn thêm.`;
  }

  const payload: Record<string, unknown> = {
    account_name: input.accountName,
    phone_office: input.phone,
    relation_id: GETFLY_RELATION_ID_LEAD_MOI,
    account_source_names: [sourceName],   // tên nguồn — Getfly tự tạo nếu chưa có
    account_type_names: ["KH tiềm năng"],
    description,
    custom_fields: {
      du_an_quan_tam: projectIds,
      facebook_link: isWebSource
        ? (input.pageUrl || "")
        : `facebook.com/profile/${input.senderId}`,
    },
  };

  const doFetch = (body: Record<string, unknown>) =>
    fetch(`${GETFLY_BASE_URL}/api/v6.1/account`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-KEY": GETFLY_API_KEY },
      body: JSON.stringify(body),
    });

  const isSourceConflict = (errors: Record<string, unknown>) =>
    !!(errors?.source_code || errors?.source_name);

  try {
    console.log("[Getfly] Tạo lead:", { phone: input.phone, project: projectIds, source: sourceName });

    let res = await doFetch(payload);
    let data = await res.json();

    // Getfly báo nguồn đã tồn tại → retry không kèm account_source_names
    if (!res.ok && isSourceConflict(data?.errors ?? {})) {
      console.warn("[Getfly] Nguồn đã tồn tại, retry không kèm source name...");
      const payloadNoSource = { ...payload };
      delete payloadNoSource.account_source_names;
      res = await doFetch(payloadNoSource);
      data = await res.json();
    }

    if (!res.ok || data.error) {
      const msg: string = data.message ?? data.error ?? "Lỗi không xác định";

      // Kiểm tra trùng lặp SĐT
      const isDuplicate = msg.toLowerCase().includes("trùng") || msg.toLowerCase().includes("duplicate") || res.status === 422;

      console.warn("[Getfly] Tạo lead thất bại:", msg);
      console.warn("[Getfly] Chi tiết lỗi:", {
        status: res.status,
        statusText: res.statusText,
        response: data,
        payloadPreview: {
          account_name: input.accountName || "(trống)",
          phone_office: maskPhone(input.phone),
          relation_id: GETFLY_RELATION_ID_LEAD_MOI,
          account_source_names: [sourceName],
          projectIds,
          hasReferral: !!input.referral,
          ad_title: input.referral?.ad_title ?? "",
          pageName: input.pageName,
          senderId: input.senderId,
        },
      });
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
