"use client";

import { useState } from "react";

type ChatHeaderProps = {
  status?: "online" | "offline" | "connecting" | "disconnected";
  onViewProfile: () => void;
  onSkip?: () => void;
  onReport?: () => void;
  onBlock?: () => void;
  onBack?: () => void;
  onToggleSidebar?: () => void;
};

export default function ChatHeader({
  status = "online",
  onViewProfile,
  onSkip,
  onReport,
  onBlock,
  onBack,
  onToggleSidebar,
}: ChatHeaderProps) {
  const [showMenu, setShowMenu] = useState(false);

  const getStatusBadge = () => {
    switch (status) {
      case "online":
        return (
          <span className="text-green-600 flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse inline-block" />
            Online
          </span>
        );
      case "disconnected":
        return <span className="text-red-500 font-medium">🔴 Stranger disconnected</span>;
      case "connecting":
        return <span className="text-amber-500">🟡 Connecting...</span>;
      default:
        return <span className="text-zinc-400">⚪ Offline</span>;
    }
  };

  return (
    <header className="border-b border-zinc-200 px-4 py-3 flex items-center justify-between bg-white relative">
      <div className="flex items-center gap-2.5">
        {onToggleSidebar && (
          <button
            type="button"
            onClick={onToggleSidebar}
            className="h-8 w-8 rounded-xl bg-zinc-100 hover:bg-zinc-200 text-zinc-700 flex items-center justify-center text-base font-mono transition"
            title="Toggle Sidebar"
          >
            ☰
          </button>
        )}
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="px-2.5 py-1.5 rounded-xl bg-zinc-100 text-zinc-700 text-xs font-semibold hover:bg-zinc-200 transition"
            title="Leave chat and return to main screen"
          >
            ← Back
          </button>
        )}
        <div>
          <h1 className="text-base font-bold text-zinc-900 leading-tight">
            Stranger Chat
          </h1>
          <div className="text-xs mt-0.5">{getStatusBadge()}</div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {/* NEXT STRANGER / SKIP BUTTON */}
        {onSkip && (
          <button
            type="button"
            onClick={onSkip}
            title="Skip to next stranger"
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-zinc-900 text-white text-xs font-semibold hover:bg-zinc-800 transition active:scale-95 shadow-sm"
          >
            <span>Next Stranger</span>
            <span>⏭</span>
          </button>
        )}

        {/* PROFILE BUTTON */}
        <button
          type="button"
          onClick={onViewProfile}
          className="px-2.5 py-1.5 rounded-xl bg-zinc-100 text-zinc-700 text-xs font-medium hover:bg-zinc-200 transition"
          title="View Stranger Profile"
        >
          👤 Profile
        </button>

        {/* SAFETY MENU DROPDOWN */}
        {(onReport || onBlock) && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowMenu((prev) => !prev)}
              className="flex h-8 w-8 items-center justify-center rounded-xl bg-zinc-100 text-zinc-600 hover:bg-zinc-200 transition font-bold"
              title="Safety Options"
            >
              ⋮
            </button>

            {showMenu && (
              <div
                className="absolute right-0 mt-2 w-44 rounded-2xl bg-white p-1.5 shadow-xl border border-zinc-200 z-30 animate-fadeIn"
                onClick={() => setShowMenu(false)}
              >
                {onReport && (
                  <button
                    type="button"
                    onClick={onReport}
                    className="w-full text-left px-3 py-2 rounded-xl text-xs font-medium text-amber-700 hover:bg-amber-50 flex items-center gap-2"
                  >
                    <span>🚩</span> Report Stranger
                  </button>
                )}
                {onBlock && (
                  <button
                    type="button"
                    onClick={onBlock}
                    className="w-full text-left px-3 py-2 rounded-xl text-xs font-medium text-red-600 hover:bg-red-50 flex items-center gap-2"
                  >
                    <span>🚫</span> Block Stranger
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}