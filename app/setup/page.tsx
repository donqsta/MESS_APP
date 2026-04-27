"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  MessageSquare, Key, CheckCircle, AlertCircle,
  Loader2, Plus, Trash2, Hash, Tag,
} from "lucide-react";

interface SavedPage {
  id: string;
  name: string;
  category: string;
  picture?: string;
}

export default function SetupPage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [pageId, setPageId] = useState("729397667519994");
  const [pageName, setPageName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedPages, setSavedPages] = useState<SavedPage[]>([]);

  const handleAdd = async () => {
    if (!token.trim()) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pageToken: token.trim(),
          pageId: pageId.trim() || undefined,
          pageName: pageName.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      setSavedPages((prev) => {
        const exists = prev.find((p) => p.id === data.page.id);
        if (exists) return prev.map((p) => (p.id === data.page.id ? data.page : p));
        return [...prev, data.page];
      });
      setToken("");
      setPageId("");
      setPageName("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi không xác định");
    } finally {
      setLoading(false);
    }
  };

  const handleGo = () => {
    if (savedPages.length > 0) {
      router.push(`/dashboard/${savedPages[0].id}`);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-lg">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-blue-600 rounded-2xl mb-3">
            <MessageSquare className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Thêm Page Token</h1>
          <p className="text-gray-500 text-sm mt-1">
            Nhập Page Access Token và Page ID để bỏ qua OAuth
          </p>
        </div>

        {/* How to get token */}
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 mb-6 text-sm text-blue-800">
          <p className="font-semibold mb-1">Cách lấy Page Access Token:</p>
          <ol className="list-decimal list-inside space-y-1 text-blue-700">
            <li>
              Vào{" "}
              <a
                href="https://developers.facebook.com/tools/explorer/"
                target="_blank"
                rel="noopener noreferrer"
                className="underline font-medium"
              >
                Graph API Explorer
              </a>
            </li>
            <li>Chọn App → chọn Page trong "User or Page"</li>
            <li>Generate Access Token → copy token</li>
          </ol>
        </div>

        {/* Inputs */}
        <div className="space-y-4 mb-6">
          {/* Page ID */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Page ID
            </label>
            <div className="relative">
              <Hash className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={pageId}
                onChange={(e) => setPageId(e.target.value)}
                placeholder="729397667519994"
                className="w-full pl-9 pr-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono"
              />
            </div>
          </div>

          {/* Page Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Tên Fanpage <span className="text-gray-400 font-normal">(để hiển thị trong app)</span>
            </label>
            <div className="relative">
              <Tag className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={pageName}
                onChange={(e) => setPageName(e.target.value)}
                placeholder="Tên fanpage của bạn"
                className="w-full pl-9 pr-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* Token */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Page Access Token
            </label>
            <div className="relative">
              <Key className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
              <textarea
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="EAAxxxxxxx..."
                rows={3}
                className="w-full pl-9 pr-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono resize-none"
              />
            </div>
          </div>

          <button
            onClick={handleAdd}
            disabled={!token.trim() || loading}
            className="flex items-center justify-center gap-2 w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-100 disabled:text-gray-400 text-white text-sm font-semibold rounded-xl transition-colors"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Plus className="w-4 h-4" />
            )}
            {loading ? "Đang xác minh..." : "Thêm Page"}
          </button>

          {error && (
            <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg p-3">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <p>{error}</p>
            </div>
          )}
        </div>

        {/* Saved pages list */}
        {savedPages.length > 0 && (
          <div className="mb-6">
            <p className="text-sm font-medium text-gray-700 mb-2">
              Pages đã thêm ({savedPages.length})
            </p>
            <div className="space-y-2">
              {savedPages.map((page) => (
                <div
                  key={page.id}
                  className="flex items-center gap-3 bg-green-50 border border-green-100 rounded-xl p-3"
                >
                  <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0" />
                  {page.picture ? (
                    <img
                      src={page.picture}
                      alt={page.name}
                      className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                    />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-sm flex-shrink-0">
                      {page.name[0]}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800 truncate">{page.name}</p>
                    <p className="text-xs text-gray-400">
                      {page.category} · ID: {page.id}
                    </p>
                  </div>
                  <button
                    onClick={() =>
                      setSavedPages((prev) => prev.filter((p) => p.id !== page.id))
                    }
                    className="p-1 text-gray-300 hover:text-red-500 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-3">
          <a
            href="/login"
            className="flex-1 text-center py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition-colors"
          >
            Đăng nhập OAuth
          </a>
          <button
            onClick={handleGo}
            disabled={savedPages.length === 0}
            className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-100 disabled:text-gray-400 text-white text-sm font-semibold rounded-xl transition-colors"
          >
            Vào Dashboard →
          </button>
        </div>
      </div>
    </div>
  );
}
