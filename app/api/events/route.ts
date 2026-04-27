import { NextRequest } from "next/server";
import { subscribe } from "@/lib/webhook-store";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  // Đọc session TRƯỚC khi tạo stream (tránh conflict cookies + streaming)
  const session = await getSession();
  if (!session.isLoggedIn) {
    return new Response("Unauthorized", { status: 401 });
  }

  const pageId = req.nextUrl.searchParams.get("pageId");
  if (!pageId) {
    return new Response("Missing pageId", { status: 400 });
  }

  console.log(`[SSE] New connection — pageId=${pageId}`);

  const encoder = new TextEncoder();

  let controller: ReadableStreamDefaultController | null = null;
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const enqueue = (data: string) => {
    try {
      controller?.enqueue(encoder.encode(data));
    } catch {
      // stream closed
    }
  };

  const cleanup = () => {
    if (heartbeat) clearInterval(heartbeat);
    unsubscribe?.();
    try { controller?.close(); } catch { /* already closed */ }
    controller = null;
    console.log(`[SSE] Disconnected — pageId=${pageId}`);
  };

  const stream = new ReadableStream({
    start(ctrl) {
      controller = ctrl;

      // Gửi event connected ngay lập tức
      enqueue(`data: ${JSON.stringify({ type: "connected", pageId })}\n\n`);

      // Subscribe nhận events từ webhook-store
      unsubscribe = subscribe(pageId, (msg) => {
        console.log(`[SSE] Sending message to browser — pageId=${pageId} text="${msg.text}"`);
        enqueue(`data: ${JSON.stringify({ type: "message", ...msg })}\n\n`);
      });

      // Heartbeat mỗi 20s để giữ kết nối
      heartbeat = setInterval(() => {
        enqueue(`: heartbeat\n\n`);
      }, 20000);

      // Cleanup khi client ngắt kết nối
      req.signal.addEventListener("abort", cleanup);
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-store, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
      "Transfer-Encoding": "chunked",
    },
  });
}
