"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { RefreshCw, Trash2, ChevronDown, ChevronUp, Wifi, Send, Radio } from "lucide-react";

interface Log {
  id: string;
  timestamp: number;
  method: string;
  query: string;
  body: unknown;
}

export default function DebugPage() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sseStatus, setSseStatus] = useState<"connecting" | "connected" | "error">("connecting");
  const [sseEvents, setSseEvents] = useState<string[]>([]);
  const [testPageId] = useState("729397667519994");

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/webhook/logs");
      const data = await res.json();
      setLogs(data.logs ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  const clearLogs = async () => {
    await fetch("/api/webhook/logs", { method: "DELETE" });
    setLogs([]);
  };

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(fetchLogs, 2000);
    return () => clearInterval(t);
  }, [autoRefresh, fetchLogs]);

  // SSE connection monitor
  useEffect(() => {
    const es = new EventSource(`/api/events?pageId=${testPageId}`);
    es.onopen = () => setSseStatus("connected");
    es.onerror = () => setSseStatus("error");
    es.onmessage = (e) => {
      const d = JSON.parse(e.data);
      setSseEvents((prev) => [`[${new Date().toLocaleTimeString("vi-VN")}] ${JSON.stringify(d)}`, ...prev.slice(0, 19)]);
    };
    return () => es.close();
  }, [testPageId]);

  const sendTestSSE = async () => {
    await fetch(`/api/events/test?pageId=${testPageId}`, { method: "POST" });
  };

  const methodColor: Record<string, string> = {
    GET: "bg-blue-100 text-blue-700",
    POST: "bg-green-100 text-green-700",
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-4 font-mono text-sm">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Wifi className="w-5 h-5 text-green-400" />
          <h1 className="text-base font-bold text-white">Webhook Debug Log</h1>
          <span className="text-xs text-gray-500">
            {logs.length} request{logs.length !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="accent-green-500"
            />
            Auto-refresh 2s
          </label>
          <button
            onClick={fetchLogs}
            disabled={loading}
            className="flex items-center gap-1 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-xs transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <button
            onClick={clearLogs}
            className="flex items-center gap-1 px-3 py-1.5 bg-red-900 hover:bg-red-800 rounded-lg text-xs text-red-300 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Clear
          </button>
        </div>
      </div>

      {/* SSE Monitor Panel */}
      <div className="mb-4 border border-gray-800 rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 bg-gray-900">
          <div className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-purple-400" />
            <span className="text-xs font-bold text-purple-300">SSE Monitor</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              sseStatus === "connected" ? "bg-green-900 text-green-300" :
              sseStatus === "error" ? "bg-red-900 text-red-300" :
              "bg-gray-800 text-gray-400"
            }`}>
              {sseStatus === "connected" ? "● Connected" : sseStatus === "error" ? "● Error" : "● Connecting"}
            </span>
            <span className="text-xs text-gray-600">pageId: {testPageId}</span>
          </div>
          <button
            onClick={sendTestSSE}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-800 hover:bg-purple-700 rounded-lg text-xs text-purple-200 transition-colors"
          >
            <Send className="w-3.5 h-3.5" />
            Gửi test event
          </button>
        </div>
        <div className="bg-gray-950 p-3 min-h-[80px] max-h-[160px] overflow-y-auto">
          {sseEvents.length === 0 ? (
            <p className="text-xs text-gray-600 italic">Chờ SSE event... Nhấn "Gửi test event" để kiểm tra</p>
          ) : (
            sseEvents.map((e, i) => (
              <p key={i} className="text-xs text-purple-300 font-mono leading-relaxed">{e}</p>
            ))
          )}
        </div>
      </div>

      {/* Empty */}
      {logs.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 text-gray-600">
          <Wifi className="w-10 h-10 mb-3 opacity-30" />
          <p>Chưa có request nào đến webhook</p>
          <p className="text-xs mt-1 text-gray-700">
            Gửi tin nhắn vào Fanpage để xem payload ở đây
          </p>
        </div>
      )}

      {/* Log list */}
      <div className="space-y-2">
        {logs.map((log) => {
          const isExpanded = expanded.has(log.id);
          const time = new Date(log.timestamp).toLocaleTimeString("vi-VN", {
            hour: "2-digit", minute: "2-digit", second: "2-digit",
          });
          const bodyStr = JSON.stringify(log.body, null, 2);

          // Quick summary of what the payload contains
          const body = log.body as Record<string, unknown>;
          const isMessaging = body?.object === "page";
          const entries = (body?.entry as unknown[]) ?? [];
          const firstEntry = entries[0] as Record<string, unknown> | undefined;
          const messaging = (firstEntry?.messaging as unknown[]) ?? [];
          const firstMsg = messaging[0] as Record<string, unknown> | undefined;
          const msgText = (firstMsg?.message as Record<string, unknown>)?.text as string | undefined;
          const senderId = (firstMsg?.sender as Record<string, unknown>)?.id as string | undefined;

          return (
            <div
              key={log.id}
              className="border border-gray-800 rounded-lg overflow-hidden"
            >
              {/* Row header */}
              <button
                onClick={() => toggleExpand(log.id)}
                className="flex items-center gap-3 w-full px-3 py-2.5 bg-gray-900 hover:bg-gray-800 transition-colors text-left"
              >
                <span className={`px-1.5 py-0.5 rounded text-xs font-bold ${methodColor[log.method] ?? "bg-gray-700 text-gray-300"}`}>
                  {log.method}
                </span>
                <span className="text-gray-500 text-xs">{time}</span>

                {isMessaging && msgText && (
                  <span className="flex-1 text-xs text-green-400 truncate">
                    💬 {senderId} → &quot;{msgText}&quot;
                  </span>
                )}
                {isMessaging && !msgText && (
                  <span className="flex-1 text-xs text-yellow-400 truncate">
                    📦 {log.method === "GET" ? "Verification handshake" : `page event (no text) — ${messaging.length} event(s)`}
                  </span>
                )}
                {!isMessaging && (
                  <span className="flex-1 text-xs text-gray-500 truncate">
                    {log.method === "GET" ? "Verification" : `object: ${String(body?.object ?? "unknown")}`}
                  </span>
                )}

                {isExpanded
                  ? <ChevronUp className="w-4 h-4 text-gray-600 flex-shrink-0" />
                  : <ChevronDown className="w-4 h-4 text-gray-600 flex-shrink-0" />
                }
              </button>

              {/* Expanded JSON */}
              {isExpanded && (
                <div className="bg-gray-950 border-t border-gray-800 p-3 overflow-x-auto">
                  {log.query && (
                    <p className="text-xs text-gray-500 mb-2">Query: ?{log.query}</p>
                  )}
                  <pre className="text-xs text-green-300 leading-relaxed whitespace-pre-wrap break-all">
                    {bodyStr}
                  </pre>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
