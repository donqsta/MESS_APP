"use client";

import { useEffect, useState, useCallback } from "react";
import { Megaphone, FileText, Inbox, RefreshCw, Search, ExternalLink, Check, Loader2, Library } from "lucide-react";

export interface AssignableProject {
  id: number;
  name: string;
  postIds?: string[];
  adIds?: string[];
}

interface ContentItem {
  kind: "post" | "ad";
  id: string;
  text: string;
  picture?: string;
  permalink?: string;
  createdTime?: string;
  status?: string;
  postId?: string;
  isAdPost?: boolean;
  leadCount?: number;
}

type Source = "posts" | "ads" | "leads";

const FALLBACK_ID = 41;

/** Thư viện Quảng cáo: xem mọi QC đang chạy của page, kể cả do BM khác chạy. */
export function adLibraryUrl(pageId: string): string {
  return `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=VN&view_all_page_id=${pageId}`;
}

/** Post ID có thể là "{pageId}_{postId}" hoặc "{postId}" — so theo phần cuối. */
function sameFbId(a: string, b: string): boolean {
  return a === b || a.split("_").pop() === b.split("_").pop();
}

export function findAssignedProject(
  projects: AssignableProject[],
  kind: "post" | "ad",
  id: string
): AssignableProject | undefined {
  return projects.find((p) =>
    (kind === "post" ? p.postIds : p.adIds)?.some((x) => sameFbId(x, id))
  );
}

/**
 * Dropdown chọn dự án cho 1 post/ad — đổi là lưu ngay vào projects.json.
 */
export function ProjectAssignSelect({
  projects,
  kind,
  contentId,
  onChanged,
}: {
  projects: AssignableProject[];
  kind: "post" | "ad";
  contentId: string;
  onChanged: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const assigned = findAssignedProject(projects, kind, contentId);

  async function assign(value: string) {
    setSaving(true);
    try {
      const res = await fetch("/api/bot/assign-content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, id: contentId, projectId: value ? Number(value) : null }),
      });
      const data = await res.json();
      if (data.success) {
        onChanged();
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
      } else {
        alert(`Lỗi: ${data.error}`);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      <select
        value={assigned?.id ?? ""}
        disabled={saving}
        onChange={(e) => assign(e.target.value)}
        className={`text-xs border rounded-lg px-2 py-1 outline-none max-w-[200px] ${
          assigned
            ? "border-emerald-300 bg-emerald-50 text-emerald-800 font-medium"
            : "border-gray-200 bg-white text-gray-500"
        }`}
      >
        <option value="">— Chưa gắn dự án —</option>
        {projects
          .filter((p) => p.id !== FALLBACK_ID)
          .map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
      </select>
      {saving && <Loader2 className="w-3.5 h-3.5 text-gray-400 animate-spin" />}
      {saved && <Check className="w-3.5 h-3.5 text-emerald-600" />}
    </div>
  );
}

/**
 * Trình gắn Post / Ads vào dự án: liệt kê bài viết Page, quảng cáo, và post/ad
 * khách vừa nhắn — chọn dự án trực tiếp, không cần tự tìm ID.
 */
export default function AdPostManager({
  projects,
  onChanged,
}: {
  projects: AssignableProject[];
  onChanged: () => void;
}) {
  const [pages, setPages] = useState<Array<{ id: string; name: string }>>([]);
  const [pageId, setPageId] = useState("");
  const [source, setSource] = useState<Source>("posts");
  const [items, setItems] = useState<ContentItem[]>([]);
  const [next, setNext] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [onlyUnassigned, setOnlyUnassigned] = useState(false);

  useEffect(() => {
    fetch("/api/pages")
      .then((r) => r.json())
      .then((d: { pages?: Array<{ id: string; name: string }> }) => {
        const list = (d.pages ?? []).map((p) => ({ id: p.id, name: p.name }));
        setPages(list);
        if (list[0]) setPageId((cur) => cur || list[0].id);
      })
      .catch(() => { /* ignore */ });
  }, []);

  const load = useCallback(async (append?: string) => {
    if (source === "posts" && !pageId) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ source });
      if (pageId && source !== "ads") params.set("pageId", pageId);
      if (append) params.set("after", append);
      const res = await fetch(`/api/fb-content?${params}`);
      const data = await res.json() as { items?: ContentItem[]; next?: string; error?: string };
      setItems((prev) => (append ? [...prev, ...(data.items ?? [])] : data.items ?? []));
      setNext(data.next);
      if (data.error) setError(data.error);
    } catch {
      setError("Lỗi kết nối API");
    } finally {
      setLoading(false);
    }
  }, [source, pageId]);

  useEffect(() => { load(); }, [load]);

  const needle = query.trim().toLowerCase();
  const visible = items.filter((it) => {
    if (onlyUnassigned && findAssignedProject(projects, it.kind, it.id)) return false;
    if (!needle) return true;
    return it.text.toLowerCase().includes(needle) || it.id.includes(needle);
  });

  const tabs: Array<{ key: Source; label: string; icon: typeof FileText }> = [
    { key: "posts", label: "Bài viết Page", icon: FileText },
    { key: "ads", label: "Quảng cáo", icon: Megaphone },
    { key: "leads", label: "Khách vừa nhắn", icon: Inbox },
  ];

  return (
    <div className="space-y-3">
      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setSource(key)}
            className={`flex-1 flex items-center justify-center gap-1.5 text-xs py-1.5 rounded-md transition-colors ${
              source === key ? "bg-white text-gray-900 shadow-sm font-medium" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        {source !== "ads" && (
          <select
            value={pageId}
            onChange={(e) => setPageId(e.target.value)}
            className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white outline-none focus:border-blue-400"
          >
            {source === "leads" && <option value="">Tất cả fanpage</option>}
            {pages.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        )}
        <div className="flex-1 min-w-[160px] flex items-center gap-1.5 border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus-within:border-blue-400">
          <Search className="w-3.5 h-3.5 text-gray-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tìm theo nội dung hoặc ID..."
            className="flex-1 text-xs outline-none bg-transparent"
          />
        </div>
        {source !== "ads" && pageId && (
          <a
            href={adLibraryUrl(pageId)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-blue-600 border border-blue-200 bg-blue-50 hover:bg-blue-100 px-2 py-1.5 rounded-lg whitespace-nowrap"
            title="Mở Thư viện Quảng cáo của page — xem cả QC do BM khác chạy"
          >
            <Library className="w-3.5 h-3.5" />
            Xem QC đang chạy
          </a>
        )}
        <label className="flex items-center gap-1 text-xs text-gray-600 cursor-pointer select-none">
          <input type="checkbox" checked={onlyUnassigned} onChange={(e) => setOnlyUnassigned(e.target.checked)} />
          Chưa gắn
        </label>
        <button
          onClick={() => load()}
          disabled={loading}
          className="p-1.5 text-gray-500 hover:text-blue-600 disabled:opacity-50"
          title="Tải lại"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {error && (
        <p className="text-xs text-orange-700 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2">{error}</p>
      )}

      {/* List */}
      <div className="border border-gray-100 rounded-lg divide-y divide-gray-100 max-h-[480px] overflow-y-auto">
        {visible.length === 0 && !loading && (
          <p className="text-xs text-gray-400 text-center py-8">
            {source === "leads" ? "Chưa có khách nhắn từ quảng cáo (dữ liệu reset khi restart server)" : "Không có dữ liệu"}
          </p>
        )}
        {visible.map((it) => (
          <div key={`${it.kind}:${it.id}`} className="flex items-start gap-3 p-3">
            {it.picture ? (
              <img src={it.picture} alt="" className="w-14 h-14 rounded-md object-cover shrink-0 border border-gray-100" />
            ) : (
              <div className="w-14 h-14 rounded-md bg-gray-50 flex items-center justify-center shrink-0">
                {it.kind === "ad" ? <Megaphone className="w-5 h-5 text-gray-300" /> : <FileText className="w-5 h-5 text-gray-300" />}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-xs text-gray-700 line-clamp-2 whitespace-pre-wrap">
                {it.text || <span className="italic text-gray-400">Không có nội dung</span>}
              </p>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1 text-[11px] text-gray-400">
                <span className={`px-1 rounded ${it.kind === "ad" ? "bg-indigo-50 text-indigo-600" : "bg-purple-50 text-purple-600"}`}>
                  {it.kind === "ad" ? "Ad" : "Post"}
                </span>
                <span className="font-mono">{it.id}</span>
                {it.isAdPost && <span className="text-orange-600">bài quảng cáo ẩn</span>}
                {it.status && <span>{it.status}</span>}
                {it.leadCount !== undefined && <span>{it.leadCount} khách</span>}
                {it.createdTime && <span>{new Date(it.createdTime).toLocaleDateString("vi-VN")}</span>}
                {it.permalink && (
                  <a href={it.permalink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 hover:text-blue-600">
                    <ExternalLink className="w-3 h-3" /> Xem
                  </a>
                )}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <ProjectAssignSelect projects={projects} kind={it.kind} contentId={it.id} onChanged={onChanged} />
                {it.kind === "ad" && it.postId && (
                  <span className="flex items-center gap-1 text-[11px] text-gray-400">
                    Post của ad:
                    <ProjectAssignSelect projects={projects} kind="post" contentId={it.postId} onChanged={onChanged} />
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-center py-4">
            <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />
          </div>
        )}
      </div>

      {next && !loading && (
        <button onClick={() => load(next)} className="w-full text-xs text-blue-600 hover:bg-blue-50 py-2 rounded-lg">
          Tải thêm
        </button>
      )}
    </div>
  );
}
