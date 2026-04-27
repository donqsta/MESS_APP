import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";
import { ChatMessage } from "./botMemory";

const MODEL_NAME = "gemini-3.1-pro-preview";

let client: GoogleGenerativeAI | null = null;

function getClient(): GoogleGenerativeAI {
  if (!client) {
    const apiKey = process.env.GOOGLE_AI_API_KEY;
    if (!apiKey) throw new Error("GOOGLE_AI_API_KEY chưa được cấu hình trong .env.local");
    client = new GoogleGenerativeAI(apiKey);
  }
  return client;
}

const SAFETY_SETTINGS = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

/**
 * Gửi lịch sử hội thoại + system prompt tới Gemini, nhận phản hồi.
 * Phản hồi có thể chứa [BREAK] để tách thành nhiều bubble.
 */
export async function chat(
  history: ChatMessage[],
  systemPrompt: string,
  customerContext: string
): Promise<string> {
  const gemini = getClient();
  const model = gemini.getGenerativeModel({
    model: MODEL_NAME,
    systemInstruction: systemPrompt + (customerContext ? `\n\n---\n${customerContext}` : ""),
    safetySettings: SAFETY_SETTINGS,
    generationConfig: {
      maxOutputTokens: 1500, // ~400-500 từ tiếng Việt (2-3 bubble × 50-60 từ)
      temperature: 0.75,
      topP: 0.95,
    },
  });

  // Gemini cần history không có tin nhắn cuối (tin cuối là user input hiện tại)
  const formattedHistory = history.slice(0, -1).map((m) => ({
    role: m.role,
    parts: [{ text: m.content }],
  }));

  const lastMessage = history[history.length - 1];
  if (!lastMessage || lastMessage.role !== "user") {
    throw new Error("Tin nhắn cuối phải là của user");
  }

  const chatSession = model.startChat({ history: formattedHistory });
  const result = await chatSession.sendMessage(lastMessage.content);

  // Log nếu bị cắt giữa chừng do token limit
  const finishReason = result.response.candidates?.[0]?.finishReason;
  if (finishReason && finishReason !== "STOP") {
    console.warn(`[Gemini] finishReason=${finishReason} — reply có thể bị cắt`);
  }

  const text = result.response.text();
  if (!text?.trim()) throw new Error("Gemini trả về phản hồi rỗng");
  return text.trim();
}
