"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Globe,
  Phone,
  MapPin,
  RefreshCw,
  CheckCircle,
  MessageCircle,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Wifi,
  WifiOff,
  KeyRound,
  Eye,
  EyeOff,
  Trash2,
  ExternalLink,
  Zap,
  ZapOff,
} from "lucide-react";
import type { UhchatLead } from "@/lib/uhchat";

// ── Polling interval ──────────────────────────────────────────────────────────

const POLL_MS = Number(process.env.NEXT_PUBLIC_UHCHAT_POLL_MS ?? "30000");

// ── Types ─────────────────────────────────────────────────────────────────────

interface SyncResult {
  newLeads: number;
  newStats?: number;
  getflySynced: number;
  syncToGetfly?: boolean;
  timestamp: string;
  error?: string;
}

// ── Lead card ─────────────────────────────────────────────────────────────────

function LeadCard({ lead }: { lead: UhchatLead }) {
  const [open, setOpen] = useState(false);
  const visitorMsgs = lead.messages.filter((m) => m.from === "visitor");

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
      {/* Header */}
      <div
        className="flex items-start gap-3 p-3 cursor-pointer hover:bg-gray-50 transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="w-9 h-9 rounded-full bg-teal-100 flex items-center justify-center flex-shrink-0">
          <MessageCircle className="w-4 h-4 text-teal-600" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-gray-800 text-sm truncate">
              {lead.visitorName || "Khách ẩn danh"}
            </span>
            {lead.phone && (
              <span className="inline-flex items-center gap-1 text-xs bg-green-50 text-green-700 border border-green-200 rounded-full px-2 py-0.5">
                <Phone className="w-3 h-3" />
                {lead.phone}
              </span>
            )}
            {lead.getflysynced && (
              <span className="inline-flex items-center gap-1 text-xs bg-blue-50 text-blue-600 border border-blue-200 rounded-full px-2 py-0.5">
                <CheckCircle className="w-3 h-3" />
                Getfly
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 mt-0.5 flex-wrap">
            {lead.currentPage && (
              <span className="flex items-center gap-1 text-xs text-gray-400 truncate max-w-[200px]">
                <Globe className="w-3 h-3 flex-shrink-0" />
                {(() => {
                  try { return new URL(lead.currentPage).hostname; } catch { return lead.currentPage; }
                })()}
              </span>
            )}
            {lead.ipAddress && (
              <span className="flex items-center gap-1 text-xs text-gray-400">
                <MapPin className="w-3 h-3" />
                {lead.ipAddress}
              </span>
            )}
            {lead.startTime && (
              <span className="text-xs text-gray-400">{lead.startTime}</span>
            )}
          </div>

          {visitorMsgs.length > 0 && (
            <p className="text-xs text-gray-500 mt-1 truncate">
              {visitorMsgs[visitorMsgs.length - 1]?.text}
            </p>
          )}
        </div>

        <button className="text-gray-300 hover:text-gray-500 flex-shrink-0 mt-0.5">
          {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {/* Expandable conversation */}
      {open && (
        <div className="border-t border-gray-100 px-3 pb-3 pt-2 space-y-1.5 max-h-60 overflow-y-auto">
          {lead.messages.length === 0 ? (
            <p className="text-xs text-gray-400 italic">Không có tin nhắn.</p>
          ) : (
            lead.messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.from === "admin" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`px-2.5 py-1.5 rounded-2xl text-xs max-w-[80%] ${
                    msg.from === "admin"
                      ? "bg-teal-600 text-white rounded-tr-sm"
                      : "bg-gray-100 text-gray-700 rounded-tl-sm"
                  }`}
                >
                  {msg.text}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── Stats visitor card (truy cập nhưng không chat) ───────────────────────────

function StatsVisitorCard({ lead }: { lead: UhchatLead }) {
  return (
    <div className="bg-white border border-amber-100 rounded-xl shadow-sm overflow-hidden">
      <div className="flex items-start gap-3 p-3">
        <div className="w-9 h-9 rounded-full bg-amber-50 flex items-center justify-center flex-shrink-0">
          <Eye className="w-4 h-4 text-amber-500" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {lead.phone && (
              <span className="inline-flex items-center gap-1 text-sm font-semibold text-gray-800">
                <Phone className="w-3.5 h-3.5 text-green-600" />
                {lead.phone}
              </span>
            )}
            {lead.getflysynced && (
              <span className="inline-flex items-center gap-1 text-xs bg-blue-50 text-blue-600 border border-blue-200 rounded-full px-2 py-0.5">
                <CheckCircle className="w-3 h-3" />
                Getfly
              </span>
            )}
            <span className="inline-flex items-center gap-1 text-xs bg-amber-50 text-amber-600 border border-amber-200 rounded-full px-2 py-0.5">
              <Eye className="w-3 h-3" />
              Không chat
            </span>
          </div>

          <div className="flex items-center gap-3 mt-0.5 flex-wrap">
            {lead.currentPage && (
              <a
                href={lead.currentPage}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-xs text-blue-500 hover:underline truncate max-w-[260px]"
                onClick={(e) => e.stopPropagation()}
              >
                <ExternalLink className="w-3 h-3 flex-shrink-0" />
                {(() => {
                  try {
                    const u = new URL(lead.currentPage!);
                    return u.hostname + u.pathname.slice(0, 30) + (u.pathname.length > 30 ? "…" : "");
                  } catch { return lead.currentPage; }
                })()}
              </a>
            )}
            {lead.startTime && (
              <span className="text-xs text-gray-400">{lead.startTime}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Cookie setup section ──────────────────────────────────────────────────────

function CookieSetup({ onSaved }: { onSaved: () => void }) {
  const [phpsessid, setPhpsessid] = useState("");
  const [tk, setTk] = useState("");
  const [showTk, setShowTk] = useState(false);
  const [saving, setSaving] = useState(false);
  const [autoLogging, setAutoLogging] = useState(false);
  const [hasCredentials, setHasCredentials] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [expanded, setExpanded] = useState(true);

  // Kiểm tra server có cấu hình email/password không
  useEffect(() => {
    fetch("/api/uhchat/auto-login")
      .then((r) => r.json())
      .then((d: { hasCredentials?: boolean }) => setHasCredentials(!!d.hasCredentials))
      .catch(() => {});
  }, []);

  const save = async () => {
    if (!phpsessid.trim()) return;
    setSaving(true);
    const cookie = tk.trim()
      ? `PHPSESSID=${phpsessid.trim()}; tk=${tk.trim()}`
      : `PHPSESSID=${phpsessid.trim()}`;
    try {
      const res = await fetch("/api/uhchat/set-cookie", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cookie }),
      });
      const data = await res.json() as { success?: boolean; message?: string; error?: string };
      if (data.success) {
        setStatus({ ok: true, msg: "Đã lưu cookie. Đang sync..." });
        setExpanded(false);
        onSaved();
      } else {
        setStatus({ ok: false, msg: data.error ?? "Lỗi không xác định" });
      }
    } catch (e) {
      setStatus({ ok: false, msg: String(e) });
    } finally {
      setSaving(false);
    }
  };

  const autoLogin = async () => {
    setAutoLogging(true);
    setStatus(null);
    try {
      const res = await fetch("/api/uhchat/auto-login", { method: "POST" });
      const data = await res.json() as { success?: boolean; message?: string; error?: string };
      if (data.success) {
        setStatus({ ok: true, msg: "Đăng nhập tự động thành công!" });
        setExpanded(false);
        onSaved();
      } else {
        setStatus({ ok: false, msg: data.error ?? "Đăng nhập thất bại" });
      }
    } catch (e) {
      setStatus({ ok: false, msg: String(e) });
    } finally {
      setAutoLogging(false);
    }
  };

  const clear = async () => {
    await fetch("/api/uhchat/set-cookie", { method: "DELETE" });
    setPhpsessid("");
    setTk("");
    setStatus(null);
    setExpanded(true);
  };

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl mx-3 mt-3 overflow-hidden">
      {/* Header toggle */}
      <button
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-amber-100 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <KeyRound className="w-4 h-4 text-amber-600 flex-shrink-0" />
        <span className="text-sm font-medium text-amber-800 flex-1">
          Cài đặt phiên đăng nhập uhchat.net
        </span>
        {status?.ok && (
          <span className="text-xs text-green-600 flex items-center gap-1">
            <CheckCircle className="w-3 h-3" /> Đã kết nối
          </span>
        )}
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-amber-500" />
        ) : (
          <ChevronDown className="w-4 h-4 text-amber-500" />
        )}
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2.5">

          {/* Tự động đăng nhập (nếu có cấu hình email/password) */}
          {hasCredentials && (
            <div className="bg-teal-50 border border-teal-200 rounded-lg p-2.5">
              <p className="text-xs text-teal-700 font-medium mb-1.5 flex items-center gap-1">
                <Zap className="w-3.5 h-3.5" /> Tự động đăng nhập
              </p>
              <p className="text-xs text-teal-600 mb-2">
                Server đã cấu hình email/password — nhấn bên dưới để tự động lấy cookie mới.
              </p>
              <button
                onClick={autoLogin}
                disabled={autoLogging}
                className="w-full text-xs py-1.5 rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50 transition-colors font-medium flex items-center justify-center gap-1.5"
              >
                {autoLogging ? (
                  <><RefreshCw className="w-3 h-3 animate-spin" /> Đang đăng nhập...</>
                ) : (
                  <><Zap className="w-3 h-3" /> Đăng nhập tự động</>
                )}
              </button>
            </div>
          )}

          {/* Divider */}
          {hasCredentials && (
            <div className="flex items-center gap-2">
              <div className="flex-1 h-px bg-amber-200" />
              <span className="text-xs text-amber-400">hoặc nhập thủ công</span>
              <div className="flex-1 h-px bg-amber-200" />
            </div>
          )}

          {/* Hướng dẫn thủ công */}
          <div className="text-xs text-amber-700 space-y-1 pt-1">
            <p className="font-medium">Lấy cookie thủ công:</p>
            <ol className="list-decimal list-inside space-y-0.5 pl-1">
              <li>
                Mở{" "}
                <a href="https://uhchat.net/admin/" target="_blank" rel="noreferrer"
                  className="underline inline-flex items-center gap-0.5">
                  uhchat.net/admin <ExternalLink className="w-2.5 h-2.5" />
                </a>{" "}và đăng nhập
              </li>
              <li>
                Nhấn <kbd className="bg-amber-100 border border-amber-300 rounded px-1">F12</kbd>
                {" "}→ <strong>Application</strong> → <strong>Cookies</strong> → <strong>https://uhchat.net</strong>
              </li>
              <li>Copy và dán giá trị 2 cookie bên dưới</li>
            </ol>
          </div>

          {/* PHPSESSID */}
          <div>
            <label className="text-xs font-medium text-amber-800 mb-1 block">
              PHPSESSID <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={phpsessid}
              onChange={(e) => setPhpsessid(e.target.value)}
              placeholder="Dán giá trị PHPSESSID vào đây..."
              className="w-full text-xs border border-amber-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400 font-mono"
            />
          </div>

          {/* tk */}
          <div>
            <label className="text-xs font-medium text-amber-800 mb-1 block">
              tk <span className="text-amber-500 font-normal">(không bắt buộc)</span>
            </label>
            <div className="relative">
              <input
                type={showTk ? "text" : "password"}
                value={tk}
                onChange={(e) => setTk(e.target.value)}
                placeholder="Dán giá trị tk vào đây..."
                className="w-full text-xs border border-amber-300 rounded-lg px-3 py-2 pr-8 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400 font-mono"
              />
              <button
                type="button"
                onClick={() => setShowTk((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-amber-400 hover:text-amber-600"
              >
                {showTk ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          {/* Status */}
          {status && (
            <p className={`text-xs flex items-center gap-1 ${status.ok ? "text-green-700" : "text-red-600"}`}>
              {status.ok ? <CheckCircle className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
              {status.msg}
            </p>
          )}

          {/* Actions */}
          <div className="flex gap-2">
            <button
              onClick={save}
              disabled={!phpsessid.trim() || saving}
              className="flex-1 text-xs py-1.5 rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 transition-colors font-medium"
            >
              {saving ? "Đang lưu..." : "Lưu & kết nối"}
            </button>
            {status?.ok && (
              <button
                onClick={clear}
                title="Xóa cookie"
                className="text-xs px-2.5 py-1.5 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function UhchatPanel() {
  const [leads, setLeads] = useState<UhchatLead[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<SyncResult | null>(null);
  const [polling, setPolling] = useState(true);
  const [syncToGetfly, setSyncToGetfly] = useState(false);
  const [showSetup, setShowSetup] = useState(false);

  // Đọc localStorage sau khi mount (tránh hydration mismatch server/client)
  useEffect(() => {
    setSyncToGetfly(localStorage.getItem("uhchat_syncToGetfly") === "true");
  }, []);
  const [tab, setTab] = useState<"chat" | "stats">("chat");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Tải danh sách leads từ store
  const loadLeads = useCallback(async () => {
    try {
      const res = await fetch("/api/uhchat/chats");
      if (!res.ok) return;
      const data = await res.json() as { leads: UhchatLead[] };
      setLeads(data.leads ?? []);
    } catch {
      // im lặng
    }
  }, []);

  // Sync: kéo data mới từ uhchat
  const syncNow = useCallback(async (force = false) => {
    if (syncing) return;
    setSyncing(true);
    try {
      const res = await fetch("/api/uhchat/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ forceRelogin: force, syncToGetfly }),
      });
      const data = await res.json() as SyncResult;
      setLastSync(data);
      if ((data.newLeads ?? 0) > 0 || (data.newStats ?? 0) > 0) await loadLeads();
      // Nếu lỗi xác thực → hiện panel cài đặt cookie
      if (data.error?.includes("xác thực") || data.error?.includes("cookie")) {
        setShowSetup(true);
      }
    } catch (err) {
      setLastSync({ newLeads: 0, getflySynced: 0, timestamp: new Date().toISOString(), error: String(err) });
    } finally {
      setSyncing(false);
    }
  }, [syncing, loadLeads, syncToGetfly]);

  // Polling
  useEffect(() => {
    loadLeads();
    syncNow();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (polling) {
      intervalRef.current = setInterval(() => syncNow(), POLL_MS);
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [polling, syncNow]);

  const chatLeads = leads.filter((l) => !l.source || l.source === "chat");
  const statsLeads = leads.filter((l) => l.source === "stats");
  const withPhone = leads.filter((l) => l.phone).length;
  // Hiện setup nếu lỗi auth hoặc chưa có leads
  const showCookieSetup = showSetup || (lastSync?.error !== undefined && leads.length === 0);

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header bar */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between gap-3 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Globe className="w-4 h-4 text-teal-600" />
          <span className="font-semibold text-gray-800 text-sm">Website Chat (uhchat)</span>
          <span className="bg-teal-100 text-teal-700 text-xs rounded-full px-2 py-0.5 font-medium">
            {chatLeads.length} chat
          </span>
          <span className="bg-amber-100 text-amber-700 text-xs rounded-full px-2 py-0.5 font-medium">
            {statsLeads.length} truy cập
          </span>
          {withPhone > 0 && (
            <span className="bg-green-100 text-green-700 text-xs rounded-full px-2 py-0.5 font-medium">
              {withPhone} SĐT
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Cookie setup toggle */}
          <button
            onClick={() => setShowSetup((v) => !v)}
            title="Cài đặt cookie đăng nhập"
            className={`flex items-center gap-1 text-xs px-2 py-1 rounded-lg border transition-colors ${
              showCookieSetup
                ? "border-amber-300 bg-amber-50 text-amber-700"
                : "border-gray-200 text-gray-400 hover:text-gray-600"
            }`}
          >
            <KeyRound className="w-3.5 h-3.5" />
            Cookie
          </button>

          {/* Getfly sync toggle */}
          <button
            onClick={() => setSyncToGetfly((v) => {
              const next = !v;
              localStorage.setItem("uhchat_syncToGetfly", String(next));
              return next;
            })}
            title={syncToGetfly ? "Đang tạo lead Getfly — nhấn để tắt" : "Không tạo lead Getfly — nhấn để bật"}
            className={`flex items-center gap-1 text-xs px-2 py-1 rounded-lg border transition-colors ${
              syncToGetfly
                ? "border-purple-300 bg-purple-50 text-purple-700"
                : "border-gray-200 text-gray-400 hover:text-gray-600"
            }`}
          >
            {syncToGetfly ? <Zap className="w-3.5 h-3.5" /> : <ZapOff className="w-3.5 h-3.5" />}
            Getfly
          </button>

          {/* Polling toggle */}
          <button
            onClick={() => setPolling((v) => !v)}
            title={polling ? "Đang tự động đồng bộ — nhấn để tắt" : "Đã tắt tự động — nhấn để bật"}
            className={`flex items-center gap-1 text-xs px-2 py-1 rounded-lg border transition-colors ${
              polling
                ? "border-teal-300 bg-teal-50 text-teal-700"
                : "border-gray-200 text-gray-400 hover:text-gray-600"
            }`}
          >
            {polling ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
            {polling ? `Auto ${POLL_MS / 1000}s` : "Manual"}
          </button>

          {/* Manual sync */}
          <button
            onClick={() => syncNow()}
            disabled={syncing}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Đang sync…" : "Sync ngay"}
          </button>
        </div>
      </div>

      {/* Cookie setup panel */}
      {showCookieSetup && (
        <CookieSetup
          onSaved={() => {
            setShowSetup(false);
            syncNow(true);
          }}
        />
      )}

      {/* Last sync status */}
      {lastSync && (
        <div
          className={`px-4 py-1.5 text-xs flex items-center gap-2 flex-shrink-0 ${
            lastSync.error
              ? "bg-red-50 text-red-600 border-b border-red-100"
              : "bg-teal-50 text-teal-700 border-b border-teal-100"
          }`}
        >
          {lastSync.error ? (
            <>
              <AlertCircle className="w-3 h-3 flex-shrink-0" />
              <span className="truncate">{lastSync.error}</span>
              <button
                onClick={() => setShowSetup(true)}
                className="ml-auto text-red-500 underline whitespace-nowrap"
              >
                Cài đặt cookie
              </button>
            </>
          ) : (
            <>
              <CheckCircle className="w-3 h-3" />
              {(() => {
                const parts: string[] = [];
                if ((lastSync.newLeads ?? 0) > 0) parts.push(`+${lastSync.newLeads} chat mới`);
                if ((lastSync.newStats ?? 0) > 0) parts.push(`+${lastSync.newStats} truy cập mới`);
                if (parts.length === 0) parts.push("Không có dữ liệu mới");
                return parts.join(" · ");
              })()}
              {lastSync.getflySynced > 0 && ` · ${lastSync.getflySynced} lead Getfly`}
              <span className="ml-auto text-teal-500">
                {new Date(lastSync.timestamp).toLocaleTimeString("vi-VN")}
              </span>
            </>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="bg-white border-b border-gray-200 px-4 flex gap-1 flex-shrink-0">
        <button
          onClick={() => setTab("chat")}
          className={`text-xs px-3 py-2 border-b-2 font-medium transition-colors ${
            tab === "chat"
              ? "border-teal-500 text-teal-700"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          <span className="flex items-center gap-1">
            <MessageCircle className="w-3.5 h-3.5" />
            Tin nhắn
            <span className="ml-0.5 bg-teal-100 text-teal-700 rounded-full px-1.5">{chatLeads.length}</span>
          </span>
        </button>
        <button
          onClick={() => setTab("stats")}
          className={`text-xs px-3 py-2 border-b-2 font-medium transition-colors ${
            tab === "stats"
              ? "border-amber-500 text-amber-700"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          <span className="flex items-center gap-1">
            <Eye className="w-3.5 h-3.5" />
            Thống kê SĐT
            <span className="ml-0.5 bg-amber-100 text-amber-700 rounded-full px-1.5">{statsLeads.length}</span>
          </span>
        </button>
      </div>

      {/* Lead list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {tab === "chat" ? (
          chatLeads.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center text-gray-400 gap-3 py-12">
              <Globe className="w-12 h-12 opacity-20" />
              <p className="font-medium">Chưa có chat nào từ website</p>
              <p className="text-xs max-w-xs">
                Nhấn <strong>Cookie</strong> ở góc trên để nhập cookie đăng nhập từ trình duyệt,
                sau đó nhấn <strong>Sync ngay</strong>.
              </p>
            </div>
          ) : (
            chatLeads.map((lead) => <LeadCard key={lead.sessionId} lead={lead} />)
          )
        ) : (
          statsLeads.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center text-gray-400 gap-3 py-12">
              <Eye className="w-12 h-12 opacity-20" />
              <p className="font-medium">Chưa có dữ liệu thống kê</p>
              <p className="text-xs max-w-xs">
                Dữ liệu hiển thị sau khi sync — gồm khách truy cập có SĐT nhưng chưa chat.
              </p>
            </div>
          ) : (
            statsLeads.map((lead) => <StatsVisitorCard key={lead.sessionId} lead={lead} />)
          )
        )}
      </div>
    </div>
  );
}
