import { NextRequest, NextResponse } from "next/server";
import { resetConversationMemory, resetAllMemory } from "@/lib/ai-bot/botMemory";
import { resetPromptCache } from "@/lib/ai-bot/systemPrompt";

/**
 * POST /api/bot/reset-memory
 * Body (optional): { conversationId?: string, full?: boolean, reloadPrompt?: boolean }
 *
 * - conversationId: chỉ xóa 1 conversation cụ thể
 * - full=true: xóa cả trạng thái bật/tắt (mặc định chỉ xóa lịch sử chat)
 * - reloadPrompt=true: đồng thời reload prompt cache từ file
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as {
    conversationId?: string;
    full?: boolean;
    reloadPrompt?: boolean;
  };

  if (body.full) {
    resetAllMemory();
  } else {
    resetConversationMemory(body.conversationId);
  }

  if (body.reloadPrompt) {
    resetPromptCache();
    console.log("[SystemPrompt] Cache cleared via reset-memory");
  }

  return NextResponse.json({
    success: true,
    cleared: body.full ? "all (memory + bot states)" : (body.conversationId ?? "all conversations"),
    promptReloaded: body.reloadPrompt ?? false,
  });
}
