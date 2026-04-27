import { NextResponse } from "next/server";
import { resetPromptCache } from "@/lib/ai-bot/systemPrompt";

export async function POST() {
  resetPromptCache();
  console.log("[SystemPrompt] Cache đã được xóa — sẽ load lại skill files ở request tiếp theo");
  return NextResponse.json({ success: true, message: "Prompt cache cleared" });
}
