import { GoogleGenerativeAI } from "@google/generative-ai";
import type { ChatMessage } from "./botMemory";

export type ProactiveDecision =
  | { decision: "send"; reasoning: string; message: string }
  | { decision: "wait"; reasoning: string }
  | { decision: "stop"; reasoning: string };

let geminiClient: GoogleGenerativeAI | null = null;

function getGemini(): GoogleGenerativeAI | null {
  if (geminiClient) return geminiClient;
  const key = process.env.GOOGLE_AI_API_KEY;
  if (!key) return null;
  geminiClient = new GoogleGenerativeAI(key);
  return geminiClient;
}

/**
 * Dùng Gemini phân tích hội thoại và quyết định có nên chủ động nhắn thêm không.
 * Trả về JSON: { decision, reasoning, message? }
 */
export async function analyzeFollowUp(
  history: ChatMessage[],
  context: {
    displayName: string;
    preferredCall: string;
    pageName: string;
    minutesSilent: number;
    proactiveCount: number;
  }
): Promise<ProactiveDecision> {
  const gemini = getGemini();
  if (!gemini) return { decision: "wait", reasoning: "Không có API key" };

  // Lấy 10 tin nhắn gần nhất để giữ context ngắn gọn
  const recentHistory = history.slice(-10);
  const historyText = recentHistory
    .map((m) => `[${m.role === "user" ? "Khách" : "Bot"}]: ${m.content}`)
    .join("\n");

  const instruction = `Bạn đang phân tích một hội thoại tư vấn bất động sản trên Facebook Messenger.

THÔNG TIN:
- Tên khách: ${context.displayName || "Không rõ"}
- Cách gọi: ${context.preferredCall || "anh/chị"}
- Tên fanpage: ${context.pageName}
- Khách đã im lặng: ${context.minutesSilent} phút kể từ tin nhắn cuối của bot
- Bot đã chủ động nhắn trước đó: ${context.proactiveCount} lần trong session này

LỊCH SỬ HỘI THOẠI GẦN NHẤT:
${historyText}

NHIỆM VỤ:
Phân tích và đưa ra một trong 3 quyết định:
- "send": Nên nhắn thêm 1 tin (kèm nội dung cụ thể phù hợp văn phong chuyên viên BĐS)
- "wait": Khách có vẻ đang suy nghĩ/bận, chờ thêm, không làm phiền
- "stop": Hội thoại đã kết thúc tự nhiên hoặc bot đã ping 2+ lần không phản hồi

QUY TẮC:
- TÍN HIỆU NÊN GỬI (send): Khách hỏi nhiều, chia sẻ thông tin cá nhân, hứng thú nhưng bị gián đoạn đột ngột
- TÍN HIỆU NÊN DỪNG (wait): Khách nói "để suy nghĩ", "biết rồi", trả lời ngắn, lạnh dần
- TÍN HIỆU KẾT THÚC (stop): Khách cảm ơn và tắt, hội thoại đã xong, hoặc đã chủ động ping 2+ lần mà không ai phản hồi
- Nếu im lặng < 5 phút → thường nên "wait"
- Nếu proactiveCount >= 2 và khách vẫn không reply → nên "stop"
- Tin nhắn follow-up phải tự nhiên, không spam, xưng "em" gọi khách là "${context.preferredCall || "anh/chị"}"

Trả về ĐÚNG JSON (không thêm bất kỳ thứ gì khác):
{"decision":"send","reasoning":"...","message":"..."}
HOẶC
{"decision":"wait","reasoning":"..."}
HOẶC
{"decision":"stop","reasoning":"..."}`;

  try {
    const model = gemini.getGenerativeModel({
      model: "gemini-3.1-pro-preview",
      generationConfig: {
        responseMimeType: "application/json",
      },
    });

    const result = await model.generateContent(instruction);
    const raw = result.response.text().trim();

    const parsed = JSON.parse(raw) as ProactiveDecision;
    if (!["send", "wait", "stop"].includes(parsed.decision)) {
      return { decision: "wait", reasoning: "Kết quả không hợp lệ" };
    }
    return parsed;
  } catch (err) {
    console.error("[ProactiveAnalyzer] Lỗi Gemini:", err);
    return { decision: "wait", reasoning: "Lỗi khi gọi AI" };
  }
}
