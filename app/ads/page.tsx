"use client";

import { useEffect, useState, useCallback } from "react";
import { RefreshCw, Megaphone, MessageSquare, ExternalLink } from "lucide-react";
import Link from "next/link";

interface AdLead {
  senderId: string;
  pageId: string;
  referral: {
    source: string;
    type: string;
    ref?: string;
    ad_id?: string;
    adset_id?: string;
    campaign_id?: string;
    ad_title?: string;
    photo_url?: string;
    video_url?: string;
    post_id?: string;
  };
  firstMessageText: string;
  timestamp: number;
}

export default function AdsPage() {
  const [leads, setLeads] = useState<AdLead[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/ads/leads");
      const data = await res.json();
      setLeads(data.leads ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLeads();
    const t = setInterval(fetchLeads, 10000);
    return () => clearInterval(t);
  }, [fetchLeads]);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Megaphone className="w-5 h-5 text-blue-600" />
          <h1 className="font-bold text-gray-900">Tin nhắn từ Quảng cáo</h1>
          <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
            {leads.length} leads
          </span>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="text-sm text-gray-500 hover:text-gray-700">
            ← Dashboard
          </Link>
          <button
            onClick={fetchLeads}
            disabled={loading}
            className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-6">
        {leads.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-gray-400 gap-3">
            <Megaphone className="w-12 h-12 opacity-20" />
            <p className="text-lg font-medium">Chưa có tin nhắn từ quảng cáo</p>
            <p className="text-sm text-center">
              Khi user nhắn tin từ Click-to-Messenger Ad,<br />
              thông tin quảng cáo sẽ xuất hiện ở đây.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {leads.map((lead) => (
              <div
                key={`${lead.senderId}-${lead.timestamp}`}
                className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden"
              >
                <div className="flex items-start gap-4 p-4">
                  {/* Ad photo */}
                  {lead.referral.photo_url ? (
                    <img
                      src={lead.referral.photo_url}
                      alt="Ad"
                      className="w-16 h-16 rounded-lg object-cover flex-shrink-0 border border-gray-100"
                    />
                  ) : (
                    <div className="w-16 h-16 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
                      <Megaphone className="w-7 h-7 text-blue-400" />
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    {/* Ad title */}
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div>
                        <span className="inline-flex items-center gap-1 text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-medium mb-1">
                          <Megaphone className="w-3 h-3" /> Từ quảng cáo
                        </span>
                        <p className="font-semibold text-gray-800">
                          {lead.referral.ad_title ?? "Quảng cáo không có tiêu đề"}
                        </p>
                      </div>
                      <span className="text-xs text-gray-400 flex-shrink-0">
                        {new Date(lead.timestamp).toLocaleString("vi-VN")}
                      </span>
                    </div>

                    {/* First message */}
                    <div className="flex items-start gap-2 bg-gray-50 rounded-lg px-3 py-2 mb-3">
                      <MessageSquare className="w-3.5 h-3.5 text-gray-400 mt-0.5 flex-shrink-0" />
                      <p className="text-sm text-gray-700">
                        {lead.firstMessageText || <span className="italic text-gray-400">Không có text</span>}
                      </p>
                    </div>

                    {/* Ad info grid */}
                    <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
                      {lead.referral.ad_id && (
                        <InfoRow label="Ad ID" value={lead.referral.ad_id} />
                      )}
                      {lead.referral.adset_id && (
                        <InfoRow label="Adset ID" value={lead.referral.adset_id} />
                      )}
                      {lead.referral.campaign_id && (
                        <InfoRow label="Campaign ID" value={lead.referral.campaign_id} />
                      )}
                      {lead.referral.ref && (
                        <InfoRow label="Ref" value={lead.referral.ref} />
                      )}
                      <InfoRow label="Sender ID" value={lead.senderId} />
                      <InfoRow label="Source" value={lead.referral.source} />
                    </div>
                  </div>
                </div>

                {/* Footer actions */}
                <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-t border-gray-100">
                  <Link
                    href={`/dashboard/${lead.pageId}`}
                    className="flex items-center gap-1.5 text-xs text-blue-600 hover:underline"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    Xem hội thoại
                  </Link>

                  {lead.referral.post_id && (
                    <a
                      href={`https://www.facebook.com/${lead.referral.post_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs text-gray-500 hover:text-blue-600"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Xem bài quảng cáo
                    </a>
                  )}

                  {lead.referral.ad_id && (
                    <a
                      href={`https://www.facebook.com/ads/manager/account/campaigns?act=&selected_campaign_ids=${lead.referral.campaign_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs text-gray-500 hover:text-blue-600"
                    >
                      <Megaphone className="w-3.5 h-3.5" />
                      Ads Manager
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-gray-400 min-w-[80px]">{label}:</span>
      <span className="text-gray-700 font-mono truncate">{value}</span>
    </div>
  );
}
