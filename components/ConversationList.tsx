"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { FBConversation } from "@/lib/facebook";
import { useSSE } from "@/hooks/useSSE";
import { RefreshCw, MessageCircle } from "lucide-react";
import { formatDistanceToNow } from "@/lib/time";

// const POLL_INTERVAL = 20000; // Tắt polling — dùng webhook SSE

interface Props {
  pageId: string;
}

export default function ConversationList({ pageId }: Props) {
  const params = useParams();
  const currentConvId = params?.conversationId as string | undefined;

  const [conversations, setConversations] = useState<FBConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [newConvIds, setNewConvIds] = useState<Set<string>>(new Set());
  const knownConvIdsRef = useRef<Set<string>>(new Set());

  // Full load (initial hoặc manual refresh)
  const fetchConversations = useCallback(
    async (cursor?: string, silent = false) => {
      if (!cursor && !silent) setLoading(true);
      else if (cursor) setLoadingMore(true);
      setError(null);
      try {
        const url = `/api/conversations/${pageId}${cursor ? `?cursor=${cursor}` : ""}`;
        const res = await fetch(url, { cache: "no-store" });
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        const incoming: FBConversation[] = data.data ?? [];

        if (cursor) {
          setConversations((prev) => [...prev, ...incoming]);
        } else if (silent) {
          // Merge: đưa conversation mới lên đầu, cập nhật snippet các conv cũ
          setConversations((prev) => {
            const existingMap = new Map(prev.map((c) => [c.id, c]));
            const newOnes: FBConversation[] = [];

            for (const conv of incoming) {
              if (!knownConvIdsRef.current.has(conv.id)) {
                newOnes.push(conv);
                setNewConvIds((s) => new Set(s).add(conv.id));
              }
              existingMap.set(conv.id, conv); // cập nhật snippet/updated_time
            }

            // Sắp xếp lại theo updated_time
            return Array.from(existingMap.values()).sort(
              (a, b) =>
                new Date(b.updated_time).getTime() -
                new Date(a.updated_time).getTime()
            );
          });
          incoming.forEach((c) => knownConvIdsRef.current.add(c.id));
        } else {
          incoming.forEach((c) => knownConvIdsRef.current.add(c.id));
          setConversations(incoming);
        }

        setNextCursor(data.paging?.cursors?.after ?? null);
      } catch (e) {
        if (!silent) setError(e instanceof Error ? e.message : "Lỗi tải hội thoại");
      } finally {
        if (!silent) setLoading(false);
        if (cursor) setLoadingMore(false);
      }
    },
    [pageId]
  );

  // Initial load
  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  // Auto-polling đã tắt — webhook SSE xử lý real-time

  // SSE với auto-reconnect
  useSSE(pageId, (data) => {
    if (data.type === "message") {
      fetchConversations(undefined, true);
    }
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <RefreshCw className="w-5 h-5 text-gray-400 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-sm text-red-600">
        <p>{error}</p>
        <button onClick={() => fetchConversations()} className="mt-2 text-blue-600 underline">
          Thử lại
        </button>
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-32 text-gray-400 text-sm gap-2">
        <MessageCircle className="w-8 h-8" />
        <p>Chưa có hội thoại nào</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
          Hội thoại
        </span>
        <button
          onClick={() => fetchConversations()}
          className="p-1 text-gray-400 hover:text-blue-600 transition-colors"
          title="Làm mới"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {conversations.map((conv) => {
          // Người tham gia khác với Page
          const participant =
            conv.participants.data.find((p) => p.id !== pageId) ??
            conv.participants.data[0];
          const isActive = conv.id === currentConvId;
          const hasNew = newConvIds.has(conv.id) && !isActive;

          return (
            <Link
              key={conv.id}
              href={`/dashboard/${pageId}/${conv.id}`}
              onClick={() =>
                setNewConvIds((prev) => {
                  const next = new Set(prev);
                  next.delete(conv.id);
                  return next;
                })
              }
              className={`flex items-start gap-3 px-3 py-3 border-b border-gray-50 hover:bg-gray-50 transition-colors ${
                isActive ? "bg-blue-50" : ""
              }`}
            >
              {/* Avatar */}
              <div className="relative flex-shrink-0">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center text-white font-semibold text-sm">
                  {participant?.name?.[0]?.toUpperCase() ?? "?"}
                </div>
                {hasNew && (
                  <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-blue-600 rounded-full border-2 border-white" />
                )}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-1">
                  <span
                    className={`text-sm truncate ${
                      hasNew
                        ? "font-bold text-gray-900"
                        : "font-medium text-gray-800"
                    }`}
                  >
                    {participant?.name ?? "Người dùng ẩn danh"}
                  </span>
                  <span className="text-xs text-gray-400 flex-shrink-0">
                    {formatDistanceToNow(conv.updated_time)}
                  </span>
                </div>
                <p
                  className={`text-xs truncate mt-0.5 ${
                    hasNew ? "text-gray-700 font-medium" : "text-gray-400"
                  }`}
                >
                  {conv.snippet ?? "Nhấn để xem"}
                </p>
              </div>
            </Link>
          );
        })}

        {nextCursor && (
          <button
            onClick={() => fetchConversations(nextCursor)}
            disabled={loadingMore}
            className="w-full py-3 text-sm text-blue-600 hover:bg-blue-50 transition-colors disabled:opacity-50"
          >
            {loadingMore ? "Đang tải..." : "Tải thêm"}
          </button>
        )}
      </div>
    </div>
  );
}
