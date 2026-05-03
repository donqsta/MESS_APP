/**
 * zalo-phone-extractor.ts
 *
 * Trích xuất số điện thoại Việt Nam từ tin nhắn dạng tự do.
 * Nhân viên có thể nhắn: "0902 512 123", "090.251.2123", "0 9 0 2 5 1 2 1 2 3", ...
 *
 * Quy trình:
 *  1. Regex: gộp toàn bộ chữ số từ chuỗi → kiểm tra hợp lệ
 *  2. Gemini AI fallback: nếu regex không bắt được (text dài, định dạng lạ)
 */

import { GoogleGenerativeAI } from "@google/generative-ai";

const VALID_PHONE = /^0(?:3[2-9]|5[2689]|7[06-9]|8[0-9]|9[0-9])\d{7}$/;

let geminiClient: GoogleGenerativeAI | null = null;
function getGemini() {
  if (!process.env.GOOGLE_AI_API_KEY) return null;
  if (!geminiClient) geminiClient = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY);
  return geminiClient;
}

// ── Regex extraction ──────────────────────────────────────────────────────────

/**
 * Tìm số điện thoại bằng cách ghép tất cả chữ số liên quan trong chuỗi.
 * Hỗ trợ: "0902 512 123", "090.251.2123", "0 9 0 2 5 1 2 1 2 3", "+84902512123"
 */
function extractByRegex(text: string): string | null {
  // Thử ghép toàn bộ chữ số trong text (bỏ mọi khoảng cách/dấu phân cách)
  const allDigits = text.replace(/[^\d+]/g, "");

  // Normalize +84 → 0
  let normalized = allDigits;
  if (normalized.startsWith("+84")) normalized = "0" + normalized.slice(3);
  else if (normalized.startsWith("84") && normalized.length === 11) normalized = "0" + normalized.slice(2);

  if (VALID_PHONE.test(normalized)) return normalized;

  // Thử tìm pattern phone trong text (có thể có text xung quanh)
  // Pattern: chuỗi chữ số xen kẽ dấu phân cách phổ biến
  const phonePattern = /(?:\+?84|0)\s*[3-9](?:\s*\d){8}/g;
  const matches = text.match(phonePattern);
  if (matches) {
    for (const m of matches) {
      const digits = m.replace(/\D/g, "");
      let norm = digits;
      if (norm.startsWith("84") && norm.length === 11) norm = "0" + norm.slice(2);
      if (VALID_PHONE.test(norm)) return norm;
    }
  }

  return null;
}

// ── AI extraction ──────────────────────────────────────────────────────────────

async function extractByAI(text: string): Promise<string | null> {
  const gemini = getGemini();
  if (!gemini) return null;

  try {
    const model = gemini.getGenerativeModel({
      model: "gemini-3.1-pro-preview",
      generationConfig: { responseMimeType: "application/json", temperature: 0 },
    });

    const prompt =
      `Trích xuất số điện thoại Việt Nam từ tin nhắn sau.\n` +
      `Người dùng có thể viết theo nhiều cách: cách khoảng, dấu chấm, gạch ngang, tách từng số, hoặc lẫn với text.\n` +
      `Ví dụ hợp lệ: "0902 512 123", "090.251.2123", "0 9 0 2 5 1 2 1 2 3", "sdt tôi là 0912345678"\n` +
      `Số hợp lệ: 10 chữ số, bắt đầu 03x/05x/07x/08x/09x.\n` +
      `Trả về JSON: {"phone":"0xxxxxxxxx"} hoặc {"phone":null} nếu không có.\n\n` +
      `Tin nhắn: "${text}"`;

    const result = await model.generateContent(prompt);
    const raw = result.response.text().trim();
    const parsed = JSON.parse(raw) as { phone: string | null };
    const phone = parsed.phone;
    if (phone && VALID_PHONE.test(phone)) return phone;
    return null;
  } catch {
    return null;
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Trích xuất số điện thoại từ tin nhắn tự do.
 * Trả về số đã chuẩn hóa 10 chữ số, hoặc null nếu không tìm thấy.
 */
export async function extractPhoneFromMessage(text: string): Promise<string | null> {
  // 1. Thử regex nhanh
  const fromRegex = extractByRegex(text);
  if (fromRegex) return fromRegex;

  // 2. Chỉ gọi AI nếu text có vẻ chứa số (tránh tốn token)
  const digitCount = (text.match(/\d/g) ?? []).length;
  if (digitCount < 9) return null; // Quá ít chữ số → chắc không có SĐT

  console.log(`[phone-extractor] Regex không bắt được, thử AI: "${text.slice(0, 60)}"`);
  const fromAI = await extractByAI(text);
  if (fromAI) console.log(`[phone-extractor] AI tìm được SĐT: ${fromAI}`);
  return fromAI;
}
