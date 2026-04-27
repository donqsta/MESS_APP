"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { PageToken } from "@/lib/session";
import { ChevronDown, Building2 } from "lucide-react";
import { useState } from "react";

interface Props {
  pages: PageToken[];
}

export default function PageSwitcher({ pages }: Props) {
  const params = useParams();
  const currentPageId = params?.pageId as string | undefined;
  const currentPage = pages.find((p) => p.id === currentPageId);
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full px-3 py-2 bg-blue-700 hover:bg-blue-600 rounded-lg text-white text-sm transition-colors"
      >
        {currentPage?.picture ? (
          <img
            src={currentPage.picture}
            alt={currentPage.name}
            className="w-6 h-6 rounded-full object-cover flex-shrink-0"
          />
        ) : (
          <Building2 className="w-5 h-5 flex-shrink-0" />
        )}
        <span className="flex-1 text-left truncate">
          {currentPage?.name ?? "Chọn fanpage"}
        </span>
        <ChevronDown className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-lg shadow-lg border border-gray-200 z-50 overflow-hidden">
          {pages.length === 0 ? (
            <p className="px-3 py-2 text-sm text-gray-500">Không có fanpage</p>
          ) : (
            pages.map((page) => (
              <Link
                key={page.id}
                href={`/dashboard/${page.id}`}
                onClick={() => setOpen(false)}
                className={`flex items-center gap-2 px-3 py-2 text-sm hover:bg-blue-50 transition-colors ${
                  page.id === currentPageId ? "bg-blue-50 text-blue-700 font-medium" : "text-gray-700"
                }`}
              >
                {page.picture ? (
                  <img
                    src={page.picture}
                    alt={page.name}
                    className="w-6 h-6 rounded-full object-cover flex-shrink-0"
                  />
                ) : (
                  <Building2 className="w-5 h-5 text-gray-400 flex-shrink-0" />
                )}
                <div className="min-w-0">
                  <p className="truncate">{page.name}</p>
                  <p className="text-xs text-gray-400 truncate">{page.category}</p>
                </div>
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  );
}
