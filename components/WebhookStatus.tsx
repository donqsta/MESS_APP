"use client";

import { useEffect, useState } from "react";
import {
  Wifi, WifiOff, Loader2, CheckCircle,
  ChevronDown, ChevronUp, Copy, Check, ExternalLink,
} from "lucide-react";

interface Props {
  pageId: string;
}

type Status = "loading" | "subscribed" | "not_subscribed" | "error";

export default function WebhookStatus({ pageId }: Props) {
  const [status, setStatus] = useState<Status>("loading");
  const [subscribing, setSubscribing] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const checkStatus = async () => {
    setStatus("loading");
    setErrorMsg("");
    try {
      const res = await fetch(`/api/webhook/subscribe?pageId=${pageId}`);
      const data = await res.json();
      if (data.error) {
        // Nếu lỗi permission khi check → coi như chưa subscribe
        setStatus("not_subscribed");
        setErrorMsg(data.error);
        return;
      }
      setStatus((data.apps ?? []).length > 0 ? "subscribed" : "not_subscribed");
    } catch {
      setStatus("not_subscribed");
    }
  };

  const handleSubscribe = async () => {
    setSubscribing(true);
    setErrorMsg("");
    try {
      const res = await fetch(`/api/webhook/subscribe?pageId=${pageId}`, { method: "POST" });
      const data = await res.json();
      if (data.error) {
        setErrorMsg(data.error);
        setStatus("error");
      } else {
        setStatus("subscribed");
      }
    } catch {
      setErrorMsg("Không thể kết nối server");
      setStatus("error");
    } finally {
      setSubscribing(false);
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  useEffect(() => {
    checkStatus();
  }, [pageId]);

  const curlCmd = `curl -X POST "https://graph.facebook.com/v25.0/${pageId}/subscribed_apps?subscribed_fields=messages,messaging_postbacks&access_token=YOUR_PAGE_TOKEN"`;

  const statusIcon = {
    loading: <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400" />,
    subscribed: <Wifi className="w-3.5 h-3.5 text-green-500" />,
    not_subscribed: <WifiOff className="w-3.5 h-3.5 text-orange-400" />,
    error: <WifiOff className="w-3.5 h-3.5 text-orange-400" />,
  }[status];

  const statusLabel = {
    loading: "Đang kiểm tra webhook...",
    subscribed: "Webhook: Live ✓",
    not_subscribed: "Webhook: Chưa kích hoạt",
    error: "Webhook: Chưa kích hoạt",
  }[status];

  return (
    <div className="border-t border-gray-100">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1.5 w-full px-3 py-2 text-xs text-gray-500 hover:bg-gray-50 transition-colors"
      >
        {statusIcon}
        <span className="flex-1 text-left font-medium">{statusLabel}</span>
        {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-3">

          {status === "subscribed" && (
            <div className="flex items-center gap-1.5 text-xs text-green-700 bg-green-50 border border-green-100 rounded-lg p-2.5">
              <CheckCircle className="w-4 h-4 flex-shrink-0" />
              <span>Tin nhắn đang được gửi real-time về app</span>
            </div>
          )}

          {(status === "not_subscribed" || status === "error") && (
            <>
              {/* Thử subscribe qua API trước */}
              <button
                onClick={handleSubscribe}
                disabled={subscribing}
                className="flex items-center justify-center gap-1.5 w-full py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors"
              >
                {subscribing
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Đang kích hoạt...</>
                  : <><Wifi className="w-3.5 h-3.5" /> Kích hoạt Webhook</>
                }
              </button>

              {/* Nếu lỗi permission → hiện hướng dẫn thủ công */}
              {errorMsg && (
                <div className="space-y-2.5">
                  <p className="text-xs text-orange-600 font-medium">
                    Token thiếu permission — kích hoạt thủ công theo 1 trong 2 cách:
                  </p>

                  {/* Cách 1: Meta Console */}
                  <div className="bg-blue-50 border border-blue-100 rounded-lg p-2.5 space-y-1.5">
                    <p className="text-xs font-semibold text-blue-800">Cách 1: Meta Dashboard (dễ nhất)</p>
                    <ol className="text-xs text-blue-700 list-decimal list-inside space-y-1">
                      <li>Vào Meta for Developers → App của bạn</li>
                      <li>Messenger → Webhooks → chọn page</li>
                      <li>Nhấn <strong>Add Subscriptions</strong></li>
                      <li>Tick <strong>messages</strong> → Save</li>
                    </ol>
                    <a
                      href="https://developers.facebook.com/apps"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-blue-600 underline mt-1"
                    >
                      <ExternalLink className="w-3 h-3" /> Mở Meta Dashboard
                    </a>
                  </div>

                  {/* Cách 2: curl */}
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-2.5 space-y-1.5">
                    <p className="text-xs font-semibold text-gray-700">Cách 2: Chạy lệnh curl</p>
                    <p className="text-xs text-gray-500">
                      Thay <code className="bg-gray-200 px-1 rounded">YOUR_PAGE_TOKEN</code> bằng token đã dùng:
                    </p>
                    <div className="relative">
                      <pre className="text-xs bg-gray-800 text-green-400 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
                        {curlCmd}
                      </pre>
                      <button
                        onClick={() => handleCopy(curlCmd)}
                        className="absolute top-1.5 right-1.5 p-1 bg-gray-700 hover:bg-gray-600 rounded text-gray-300"
                        title="Copy"
                      >
                        {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {status !== "loading" && (
            <button onClick={checkStatus} className="text-xs text-blue-500 hover:underline w-full text-center">
              Kiểm tra lại trạng thái
            </button>
          )}
        </div>
      )}
    </div>
  );
}
