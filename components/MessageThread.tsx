"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { FBMessage } from "@/lib/facebook";
import { useSSE } from "@/hooks/useSSE";
import { AdLead } from "@/lib/ad-store";
import ReplyBox from "./ReplyBox";
import { RefreshCw, ChevronUp, Paperclip, Wifi, WifiOff, Megaphone, Bot } from "lucide-react";
import { formatTime, formatDate } from "@/lib/time";

const POLL_INTERVAL = 0; // Tắt polling — dùng webhook SSE

interface Props {
  conversationId: string;
  pageId: string;
  pageScoped: string;
  initialRecipientId: string;
  initialAdLead?: AdLead;
}

interface LocalMessage extends FBMessage {
  pending?: boolean;
}

export default function MessageThread({ conversationId, pageId, pageScoped, initialRecipientId, initialAdLead }: Props) {
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [prevCursor, setPrevCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [liveStatus, setLiveStatus] = useState<"sse" | "polling" | "offline">("polling");
  const [botEnabled, setBotEnabled] = useState(false);
  const [botToggling, setBotToggling] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const knownIdsRef = useRef<Set<string>>(new Set());
  const isAtBottomRef = useRef(true);

  // Tìm ID người nhận: ưu tiên người đã gửi tin khác với page, nếu không có lấy từ URL param
  const recipientId = messages.find((m) => m.from.id !== pageScoped && m.from.id !== pageId)?.from.id ?? initialRecipientId;

  // Track nếu user đang scroll ở dưới cùng
  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };

  const scrollToBottom = useCallback((force = false) => {
    if (force || isAtBottomRef.current) {
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    }
  }, []);

  // Merge tin nhắn mới vào state, tránh duplicate
  const mergeNewMessages = useCallback(
    (incoming: LocalMessage[], scrollForce = false) => {
      setMessages((prev) => {
        const existingIds = new Set(prev.map((m) => m.id));
        const truly_new = incoming.filter((m) => !existingIds.has(m.id));
        if (truly_new.length === 0) return prev;
        // Xóa pending trùng nội dung nếu có
        const withoutPending = prev.filter(
          (m) =>
            !m.pending ||
            !truly_new.some(
              (n) => n.message === m.message && n.from.id === m.from.id
            )
        );
        const merged = [...withoutPending, ...truly_new].sort(
          (a, b) =>
            new Date(a.created_time).getTime() - new Date(b.created_time).getTime()
        );
        merged.forEach((m) => knownIdsRef.current.add(m.id));
        return merged;
      });
      if (scrollForce || isAtBottomRef.current) scrollToBottom();
    },
    [scrollToBottom]
  );

  // Load ban đầu
  const fetchMessages = useCallback(
    async (cursor?: string) => {
      if (!cursor) setLoading(true);
      else setLoadingMore(true);
      setError(null);

      try {
        const params = new URLSearchParams({ pageId });
        if (cursor) params.set("cursor", cursor);
        const res = await fetch(`/api/messages/${conversationId}?${params}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        if (cursor) {
          const prevH = containerRef.current?.scrollHeight ?? 0;
          setMessages((prev) => {
            const merged = [...(data.data as LocalMessage[]), ...prev];
            merged.forEach((m) => knownIdsRef.current.add(m.id));
            return merged;
          });
          setPrevCursor(data.paging?.cursors?.before ?? null);
          requestAnimationFrame(() => {
            if (containerRef.current) {
              containerRef.current.scrollTop =
                containerRef.current.scrollHeight - prevH;
            }
          });
        } else {
          const msgs: LocalMessage[] = data.data ?? [];
          msgs.forEach((m) => knownIdsRef.current.add(m.id));
          setMessages(msgs);
          setPrevCursor(data.paging?.cursors?.before ?? null);
          requestAnimationFrame(() =>
            bottomRef.current?.scrollIntoView({ behavior: "instant" })
          );
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Lỗi tải tin nhắn");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [conversationId, pageId]
  );

  // Silent poll: chỉ lấy tin mới nhất và merge vào state
  const silentPoll = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/messages/${conversationId}?pageId=${pageId}`,
        { cache: "no-store" }
      );
      const data = await res.json();
      if (data.error) return;
      const incoming: LocalMessage[] = data.data ?? [];
      mergeNewMessages(incoming);
      setLiveStatus("polling");
    } catch {
      setLiveStatus("offline");
    }
  }, [conversationId, pageId, mergeNewMessages]);

  // Fetch bot status on mount — also registers senderId mapping for webhook lookup
  useEffect(() => {
    const params = new URLSearchParams({ conversationId });
    if (pageId) params.set("pageId", pageId);
    if (initialRecipientId) params.set("senderId", initialRecipientId);
    fetch(`/api/bot/toggle?${params}`)
      .then((r) => r.json())
      .then((d) => { if (typeof d.enabled === "boolean") setBotEnabled(d.enabled); })
      .catch(() => {});
  }, [conversationId, pageId, initialRecipientId]);

  const handleBotToggle = async () => {
    setBotToggling(true);
    try {
      const res = await fetch("/api/bot/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, pageId, senderId: initialRecipientId }),
      });
      const data = await res.json();
      if (typeof data.enabled === "boolean") setBotEnabled(data.enabled);
    } catch {
      // ignore
    } finally {
      setBotToggling(false);
    }
  };

  // Mount: load + bắt đầu polling
  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  // Polling đã tắt — webhook SSE xử lý real-time
  // useEffect(() => {
  //   const timer = setInterval(silentPoll, POLL_INTERVAL);
  //   return () => clearInterval(timer);
  // }, [silentPoll]);

  // SSE với auto-reconnect
  useSSE(pageId, (data) => {
    if (data.type === "connected") {
      setLiveStatus("sse");
    } else if (data.type === "message") {
      // Gọi fetch API để lấy tin mới nhất thay vì tự merge bằng tay
      // Điều này xử lý trường hợp user tự nhắn cho page (không thỏa đ/k data.senderId !== pageScoped)
      // VÀ cũng cho phép tải luôn attachment nếu có
      silentPoll();
    }
  });

  const handleSent = (text: string) => {
    const optimistic: LocalMessage = {
      id: `pending-${Date.now()}`,
      message: text,
      created_time: new Date().toISOString(),
      from: { id: pageScoped, name: "Page" },
      pending: true,
    };
    setMessages((prev) => [...prev, optimistic]);
    scrollToBottom(true);
    // Poll sớm để lấy message_id thực
    setTimeout(silentPoll, 2500);
  };

  if (loading) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 flex items-center justify-center">
          <RefreshCw className="w-6 h-6 text-gray-300 animate-spin" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 flex items-center justify-center flex-col gap-2 text-sm text-red-500">
          <p>{error}</p>
          <button onClick={() => fetchMessages()} className="text-blue-600 underline">
            Thử lại
          </button>
        </div>
      </div>
    );
  }

  let lastDate = "";

  return (
    <div className="flex flex-col h-full">
      {/* Status bar: live indicator + bot toggle */}
      <div className="flex items-center justify-between px-4 py-1 bg-gray-50 border-b border-gray-100">
        {liveStatus === "sse" ? (
          <span className="flex items-center gap-1 text-xs text-green-600">
            <Wifi className="w-3 h-3" /> Live
          </span>
        ) : liveStatus === "polling" ? (
          <span className="flex items-center gap-1 text-xs text-gray-400">
            <RefreshCw className="w-3 h-3" /> Chờ webhook...
          </span>
        ) : (
          <span className="flex items-center gap-1 text-xs text-gray-400">
            <WifiOff className="w-3 h-3" /> Mất kết nối
          </span>
        )}

        {/* AI Bot toggle */}
        <button
          onClick={handleBotToggle}
          disabled={botToggling}
          title={botEnabled ? "Tắt AI Bot" : "Bật AI Bot"}
          className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border transition-all duration-150 font-medium ${
            botEnabled
              ? "bg-blue-600 text-white border-blue-600 hover:bg-blue-700"
              : "bg-white text-gray-500 border-gray-200 hover:border-blue-400 hover:text-blue-500"
          } ${botToggling ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
        >
          <Bot className="w-3 h-3" />
          {botEnabled ? "Bot ON" : "Bot OFF"}
        </button>
      </div>

      {/* Messages area */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-3"
      >
        {initialAdLead && (
          <div className="mb-4 bg-orange-50 border border-orange-100 rounded-xl p-3 flex items-start gap-3 text-sm">
            {initialAdLead.referral.photo_url ? (
              <img
                src={initialAdLead.referral.photo_url}
                alt="Ad"
                className="w-12 h-12 rounded object-cover flex-shrink-0 border border-orange-200"
              />
            ) : (
              <div className="w-12 h-12 rounded bg-orange-100 flex items-center justify-center flex-shrink-0">
                <Megaphone className="w-5 h-5 text-orange-500" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-orange-800 font-semibold mb-0.5">
                Đến từ quảng cáo: {initialAdLead.referral.ad_title ?? "Không có tiêu đề"}
              </p>
              <div className="flex items-center gap-x-4 gap-y-1 flex-wrap text-xs text-orange-600/80">
                {initialAdLead.referral.ad_id && (
                  <span>Ad ID: {initialAdLead.referral.ad_id}</span>
                )}
                {initialAdLead.referral.campaign_id && (
                  <span>Campaign: {initialAdLead.referral.campaign_id}</span>
                )}
                <span>Nguồn: {initialAdLead.referral.source}</span>
              </div>
            </div>
          </div>
        )}

        {prevCursor && (
          <div className="flex justify-center py-2">
            <button
              onClick={() => fetchMessages(prevCursor)}
              disabled={loadingMore}
              className="flex items-center gap-1 text-xs text-blue-600 hover:bg-blue-50 px-3 py-1.5 rounded-full transition-colors disabled:opacity-50"
            >
              <ChevronUp className="w-3 h-3" />
              {loadingMore ? "Đang tải..." : "Tải tin cũ hơn"}
            </button>
          </div>
        )}

        {messages.map((msg) => {
          const isSelf = msg.from.id === pageScoped;
          const msgDate = formatDate(msg.created_time);
          const showDate = msgDate !== lastDate;
          lastDate = msgDate;

          return (
            <div key={msg.id}>
              {showDate && (
                <div className="flex items-center gap-2 my-3">
                  <div className="flex-1 h-px bg-gray-100" />
                  <span className="text-xs text-gray-400 px-2">{msgDate}</span>
                  <div className="flex-1 h-px bg-gray-100" />
                </div>
              )}

              <div className={`flex ${isSelf ? "justify-end" : "justify-start"} mb-1`}>
                <div className="max-w-[70%]">
                  {!isSelf && (
                    <p className="text-xs text-gray-400 mb-0.5 px-1">{msg.from.name}</p>
                  )}
                  <div
                    className={`px-3 py-2 rounded-2xl text-sm ${
                      isSelf
                        ? `bg-blue-600 text-white rounded-br-sm ${msg.pending ? "opacity-60" : ""}`
                        : "bg-gray-100 text-gray-800 rounded-bl-sm"
                    }`}
                  >
                    {msg.attachments?.data?.map((att) => (
                      <div key={att.id} className="mb-1">
                        {att.image_data ? (
                          <img
                            src={att.image_data.preview_url}
                            alt={att.name ?? "image"}
                            className="rounded-lg max-w-full max-h-48 object-cover"
                          />
                        ) : (
                          <a
                            href={att.file_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-xs underline"
                          >
                            <Paperclip className="w-3 h-3" />
                            {att.name ?? "Tệp đính kèm"}
                          </a>
                        )}
                      </div>
                    ))}
                    {msg.message && (
                      <p className="whitespace-pre-wrap break-words">{msg.message}</p>
                    )}
                  </div>
                  <p className={`text-xs text-gray-400 mt-0.5 px-1 ${isSelf ? "text-right" : ""}`}>
                    {formatTime(msg.created_time)}
                    {msg.pending && " · Đang gửi..."}
                  </p>
                </div>
              </div>
            </div>
          );
        })}

        <div ref={bottomRef} />
      </div>

      {/* Reply box */}
      {recipientId && (
        <div className="flex flex-col">
          <div className="px-4 py-1 text-[10px] text-gray-400 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
            <span>Gửi tin đến ID: {recipientId}</span>
            <span>{pageId === pageScoped ? "" : `(Page ID: ${pageId})`}</span>
          </div>
          <ReplyBox pageId={pageId} recipientId={recipientId} onSent={handleSent} />
        </div>
      )}
    </div>
  );
}
