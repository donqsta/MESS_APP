import { GoogleGenerativeAI } from "@google/generative-ai";

export type Gender = "male" | "female" | "unknown";

// ── Heuristics tên Việt ────────────────────────────────────────────────────────

// Token xuất hiện trong tên → rất nhiều khả năng là nữ
const FEMALE_TOKENS = new Set([
  "thị", "lan", "hoa", "mai", "linh", "ngọc", "hương", "thu", "trang",
  "vy", "yến", "loan", "phương", "thúy", "giang", "chi", "nhi", "ly",
  "lý", "thảo", "trâm", "oanh", "nhung", "dung", "hằng", "hạnh",
  "nga", "ngân", "ngan", "như", "nhu", "thanh", "thoa", "xuan", "xuân",
  "huệ", "hue", "diễm", "diem", "vân", "van", "tuyết", "tuyet",
  "tiên", "tien", "sen", "trinh", "trinh", "lệ", "le", "kim", "yen",
  "quyên", "quyen", "nhàn", "nhan", "ni", "vi", "thy", "thi",
  "phụng", "phung", "cúc", "cuc", "đào", "dao", "bích", "bich",
]);

// Token xuất hiện trong tên → rất nhiều khả năng là nam
const MALE_TOKENS = new Set([
  "văn", "van", "đức", "duc", "hùng", "hung", "long", "minh", "tuấn",
  "tuan", "hải", "hai", "nam", "khoa", "dũng", "dung", "bình", "binh",
  "quang", "kiên", "kien", "tùng", "tung", "phúc", "phuc", "mạnh",
  "manh", "hậu", "hau", "khang", "khánh", "khanh", "thành", "thanh",
  "trung", "hiếu", "hieu", "vinh", "lâm", "lam", "đạt", "dat",
  "hoàng", "hoang", "thịnh", "thinh", "tiến", "tien", "quốc", "quoc",
  "hưng", "hung", "sơn", "son", "tài", "tai", "vũ", "vu", "bảo",
  "bao", "đăng", "dang", "hào", "hao", "trọng", "trong", "phát", "phat",
  "hữu", "huu", "cường", "cuong", "nhân", "nhan", "tâm", "tam",
]);

/**
 * Phát hiện giới tính từ tên hiển thị bằng heuristics.
 * Trả về điểm số: dương → nam, âm → nữ, 0 → không rõ.
 */
function scoreByName(displayName: string): number {
  const normalized = displayName
    .toLowerCase()
    .normalize("NFC")
    .replace(/[^a-zàáâãèéêìíòóôõùúýăđơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ ]/g, "");

  const tokens = normalized.split(/\s+/).filter(Boolean);
  let score = 0;

  for (const token of tokens) {
    if (MALE_TOKENS.has(token)) score += 1;
    if (FEMALE_TOKENS.has(token)) score -= 1;
  }

  return score;
}

// ── Gemini vision: phán đoán từ tên + ảnh đại diện ────────────────────────────

let geminiClient: GoogleGenerativeAI | null = null;

function getGemini(): GoogleGenerativeAI | null {
  if (geminiClient) return geminiClient;
  const key = process.env.GOOGLE_AI_API_KEY;
  if (!key) return null;
  geminiClient = new GoogleGenerativeAI(key);
  return geminiClient;
}

/**
 * Dùng Gemini để phán đoán giới tính từ tên (+ ảnh đại diện nếu có).
 * Chỉ gọi khi heuristics không chắc chắn.
 */
async function detectByGemini(
  name: string,
  pictureUrl: string | null
): Promise<Gender> {
  const gemini = getGemini();
  if (!gemini) return "unknown";

  try {
    const model = gemini.getGenerativeModel({ model: "gemini-3.1-pro-preview" });

    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];

    // Thêm ảnh đại diện nếu có
    if (pictureUrl) {
      try {
        const imgRes = await fetch(pictureUrl, { signal: AbortSignal.timeout(5000) });
        if (imgRes.ok) {
          const mimeType = imgRes.headers.get("content-type") ?? "image/jpeg";
          const buffer = await imgRes.arrayBuffer();
          const base64 = Buffer.from(buffer).toString("base64");
          parts.push({ inlineData: { mimeType: mimeType.split(";")[0], data: base64 } });
        }
      } catch {
        // Nếu không fetch được ảnh thì bỏ qua, vẫn dùng tên
      }
    }

    parts.push({
      text: `Tên hiển thị Facebook: "${name}"\n\nDựa vào tên${pictureUrl ? " và ảnh đại diện" : ""} này, người dùng là nam hay nữ?\n\nTrả lời CHỈ một từ: "nam" hoặc "nu" hoặc "khong_ro". Không giải thích.`,
    });

    const result = await model.generateContent(parts);
    const answer = result.response.text().trim().toLowerCase();

    if (answer.includes("nu") || answer.includes("nữ") || answer === "nu") return "female";
    if (answer.includes("nam") || answer === "nam") return "male";
    return "unknown";
  } catch (err) {
    console.error("[GenderDetect] Gemini error:", err);
    return "unknown";
  }
}

/**
 * Phát hiện giới tính từ tên + ảnh đại diện Facebook.
 * Ưu tiên heuristics (nhanh), fallback sang Gemini nếu không chắc.
 */
export async function detectGender(
  name: string,
  pictureUrl: string | null
): Promise<Gender> {
  if (!name) return "unknown";

  const score = scoreByName(name);

  // Heuristics đủ tự tin → trả về ngay
  if (score >= 2) return "male";
  if (score <= -2) return "female";

  // Không chắc → nhờ Gemini
  console.log(`[GenderDetect] Heuristics không chắc (score=${score}) cho "${name}" → hỏi Gemini`);
  return detectByGemini(name, pictureUrl);
}

/** Chuyển Gender → cách gọi và xưng hô */
export function genderToAddress(gender: Gender): {
  preferredCall: string;
  selfRef: string;
} {
  if (gender === "male") return { preferredCall: "anh", selfRef: "anh" };
  if (gender === "female") return { preferredCall: "chị", selfRef: "chị" };
  return { preferredCall: "anh/chị", selfRef: "" };
}
