"use client";

import { useEffect, useRef } from "react";
import { WebhookMessage } from "@/lib/webhook-store";

type SSEEvent = { type: "connected"; pageId: string } | ({ type: "message" } & WebhookMessage);

/**
 * Hook SSE với auto-reconnect khi server restart hoặc mất kết nối.
 */
export function useSSE(pageId: string, onMessage: (msg: SSEEvent) => void) {
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    if (!pageId) return;

    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryDelay = 1000;
    let destroyed = false;

    const connect = () => {
      if (destroyed) return;

      es = new EventSource(`/api/events?pageId=${pageId}`);

      es.onopen = () => {
        console.log(`[SSE] Connected pageId=${pageId}`);
        retryDelay = 1000; // reset delay khi kết nối thành công
      };

      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data) as SSEEvent;
          onMessageRef.current(data);
        } catch { /* ignore parse error */ }
      };

      es.onerror = () => {
        console.warn(`[SSE] Disconnected — retry in ${retryDelay}ms`);
        es?.close();
        es = null;

        if (!destroyed) {
          retryTimer = setTimeout(() => {
            retryDelay = Math.min(retryDelay * 2, 30000); // exponential backoff max 30s
            connect();
          }, retryDelay);
        }
      };
    };

    connect();

    return () => {
      destroyed = true;
      if (retryTimer) clearTimeout(retryTimer);
      es?.close();
    };
  }, [pageId]);
}
