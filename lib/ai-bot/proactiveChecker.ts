import { getRecentSilentConversations, addMessage, incrementProactiveCount, setBotEnabled } from "./botMemory";
import { analyzeFollowUp } from "./proactiveAnalyzer";
import { withGeminiSlot, getConcurrencyStats } from "./concurrency";
import { getPageFromEnv } from "@/lib/pages";
import { sendMessage } from "@/lib/facebook";

const MIN_WAIT_MS = 3 * 60 * 1000;   // Ít nhất 3 phút im lặng mới check
const CHECK_INTERVAL_MS = 60 * 1000; // Check mỗi 1 phút

/**
 * Chạy một lần kiểm tra tất cả conversations im lặng.
 * Các conversation được phân tích song song, cùng chia sẻ Gemini semaphore với user messages.
 */
async function runCheck(): Promise<void> {
  const candidates = getRecentSilentConversations(MIN_WAIT_MS);
  if (candidates.length === 0) return;

  const stats = getConcurrencyStats();
  console.log(
    `[Proactive] Check ${candidates.length} conversation(s) im lặng` +
    ` | Gemini: ${stats.gemini.active} active / ${stats.gemini.queued} queued`
  );

  // Chạy song song tất cả candidates — semaphore tự điều phối slot
  await Promise.allSettled(
    candidates.map((c) => analyzeOne(c))
  );
}

async function analyzeOne(c: ReturnType<typeof getRecentSilentConversations>[number]): Promise<void> {
  const page = getPageFromEnv(c.pageId);
  if (!page?.accessToken) return;

  let result;
  try {
    // Dùng cùng semaphore pool với user messages — cạnh tranh công bằng
    result = await withGeminiSlot(() =>
      analyzeFollowUp(c.history, {
        displayName: c.profile.displayName,
        preferredCall: c.profile.preferredCall,
        pageName: page.name,
        minutesSilent: c.minutesSilent,
        proactiveCount: c.profile.proactiveCount,
      })
    );
  } catch (err) {
    console.error(`[Proactive] Lỗi analyze ${c.conversationId}:`, err);
    return;
  }

  console.log(`[Proactive] ${c.conversationId} → ${result.decision}: ${result.reasoning}`);

  if (result.decision === "send" && result.message) {
      try {
        await sendMessage(c.pageId, page.accessToken, c.senderId, result.message);
        addMessage(c.conversationId, "model", result.message);
        incrementProactiveCount(c.conversationId);
        console.log(`[Proactive] Sent follow-up → ${c.senderId}: "${result.message}"`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("551")) {
          console.warn(`[Proactive] #551 — Khách unavailable. Tắt bot convId=${c.conversationId}`);
          setBotEnabled(c.conversationId, false);
        } else {
          console.error(`[Proactive] Lỗi gửi tin ${c.conversationId}:`, msg);
        }
      }
  }
}

// ── Singleton interval ────────────────────────────────────────────────────────

const proc = process as NodeJS.Process & {
  _proactiveCheckerStarted?: boolean;
};

export function startProactiveChecker(): void {
  if (proc._proactiveCheckerStarted) return;
  proc._proactiveCheckerStarted = true;

  console.log("[Proactive] Checker started — interval:", CHECK_INTERVAL_MS / 1000, "s");

  setInterval(() => {
    runCheck().catch((e) => console.error("[Proactive] Unhandled error:", e));
  }, CHECK_INTERVAL_MS);
}
