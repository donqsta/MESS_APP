/**
 * zalo-response-classifier.ts
 *
 * Phân tích tin nhắn trả lời của nhân viên để xác định:
 *  - ACCEPT  → nhân viên xác nhận nhận lead ("ok", "nhận", "có", "được"...)
 *  - DECLINE → nhân viên từ chối / bận ("bận", "không nhận", "đang họp"...)
 *  - UNKNOWN → không rõ, mặc định coi là ACCEPT để tránh bỏ lỡ lead
 *
 * Quy trình:
 *  1. Keyword match nhanh (không tốn token)
 *  2. Nếu không rõ → Gemini AI phân tích (fallback)
 */

import { GoogleGenerativeAI } from "@google/generative-ai";

export type ResponseIntent = "accept" | "decline" | "unknown";

// ── Keyword rules ─────────────────────────────────────────────────────────────

const ACCEPT_KEYWORDS = [
  "ok", "oke", "okay", "được", "dc", "đc", "có", "co", "nhận", "nhan",
  "sẵn sàng", "san sang", "vâng", "vang", "dạ", "da", "rồi", "roi",
  "đồng ý", "dong y", "xác nhận", "xac nhan", "ready", "yes", "👍", "✅",
];

const DECLINE_KEYWORDS = [
  "bận", "ban", "không", "khong", "ko", "k", "không nhận", "khong nhan",
  "đang họp", "dang hop", "họp", "hop", "offline", "vắng", "vang mat",
  "không thể", "khong the", "sorry", "xin lỗi", "không được", "busy",
  "đang bận", "dang ban", "ra ngoài", "ra ngoai",
];

function matchKeywords(text: string, keywords: string[]): boolean {
  const normalized = text.toLowerCase().trim()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")  // bỏ dấu
    .replace(/\s+/g, " ");
  return keywords.some((kw) => {
    const kwNorm = kw.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    // Match toàn từ hoặc bắt đầu/kết thúc câu
    return normalized === kwNorm
      || normalized.startsWith(kwNorm + " ")
      || normalized.endsWith(" " + kwNorm)
      || normalized.includes(" " + kwNorm + " ");
  });
}

// ── Gemini AI fallback ────────────────────────────────────────────────────────

let geminiClient: GoogleGenerativeAI | null = null;

async function classifyWithAI(text: string): Promise<ResponseIntent> {
  if (!process.env.GOOGLE_AI_API_KEY) return "unknown";
  if (!geminiClient) geminiClient = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY);

  try {
    const model = geminiClient.getGenerativeModel({
      model: "gemini-3.1-pro-preview",
      generationConfig: { responseMimeType: "application/json", temperature: 0 },
    });

    const prompt =
      `Bạn là hệ thống phân tích phản hồi nhân viên BĐS khi nhận thông báo lead mới qua Zalo.\n` +
      `Tin nhắn: "${text}"\n\n` +
      `Phân loại ý định:\n` +
      `- "accept": nhân viên sẵn sàng nhận lead (xác nhận, ok, sẵn sàng, đồng ý...)\n` +
      `- "decline": nhân viên từ chối hoặc đang bận (bận, không nhận, đang họp, offline...)\n` +
      `- "unknown": không rõ ý định\n\n` +
      `Trả về JSON: {"intent":"accept"|"decline"|"unknown","reason":"lý do ngắn"}`;

    const result = await model.generateContent(prompt);
    const raw = result.response.text().trim();
    const parsed = JSON.parse(raw) as { intent: ResponseIntent };
    return parsed.intent ?? "unknown";
  } catch {
    return "unknown";
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Phân tích tin nhắn nhân viên → ACCEPT / DECLINE / UNKNOWN.
 * UNKNOWN được coi là ACCEPT để không bỏ lỡ lead.
 */
export async function classifyEmployeeResponse(text: string): Promise<ResponseIntent> {
  const t = text.trim();
  if (!t) return "unknown";

  // Keyword match nhanh
  if (matchKeywords(t, ACCEPT_KEYWORDS)) return "accept";
  if (matchKeywords(t, DECLINE_KEYWORDS)) return "decline";

  // Tin nhắn rất ngắn (1-2 ký tự) → coi là accept (ví dụ: "k" = ko hoặc ok?)
  // → để AI phân tích thêm
  if (t.length <= 20) {
    const aiResult = await classifyWithAI(t);
    console.log(`[zalo-classifier] AI "${t}" → ${aiResult}`);
    return aiResult;
  }

  // Tin nhắn dài không khớp keyword → coi là accept (nhân viên phản hồi = online)
  return "accept";
}
