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
  onStartVideoCall?: () => void;
  isVideoCallActive?: boolean;
  isVideoCallDisabled?: boolean;
};

export default function ChatHeader({
  status = "online",
  onViewProfile,
  onSkip,
  onReport,
  onBlock,
  onBack,
  onToggleSidebar,
  onStartVideoCall,
  isVideoCallActive = false,
  isVideoCallDisabled = false,
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
    <header className="border-b border-zinc-800/90 px-4 py-2.5 flex items-center justify-between bg-zinc-900/90 backdrop-blur-md relative z-20 shrink-0">
      <div className="flex items-center gap-2.5 min-w-0">
        {onToggleSidebar && (
          <button
            type="button"
            onClick={onToggleSidebar}
            aria-label="Toggle Sidebar Navigation (Chat)"
            className="h-8 w-8 rounded-xl bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 hover:text-white flex items-center justify-center text-sm font-mono border border-zinc-700/50 transition active:scale-95 shrink-0"
            title="Toggle Sidebar"
          >
            ☰
          </button>
        )}
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="px-2.5 py-1.5 rounded-xl bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 hover:text-white text-xs font-semibold border border-zinc-700/50 transition shrink-0"
            title="Leave chat and return to main screen"
          >
            ← Back
          </button>
        )}
        <div className="min-w-0">
          <h1 className="text-sm font-bold text-white leading-tight truncate">
            Stranger Chat
          </h1>
          <div className="text-[11px] mt-0.5">{getStatusBadge()}</div>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {/* VIDEO CALL BUTTON */}
        {onStartVideoCall && (
          <button
            type="button"
            onClick={onStartVideoCall}
            disabled={isVideoCallDisabled || isVideoCallActive || status === "disconnected"}
            title={
              isVideoCallActive
                ? "Video call in progress"
                : status === "disconnected"
                ? "Stranger is disconnected"
                : "Start 1-to-1 Video Call"
            }
            aria-label="Start video call"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition active:scale-95 shadow-sm ${
              isVideoCallActive
                ? "bg-emerald-950/80 text-emerald-400 border border-emerald-800/60 cursor-default"
                : isVideoCallDisabled || status === "disconnected"
                ? "bg-zinc-800/50 text-zinc-500 border border-zinc-800 cursor-not-allowed"
                : "bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-emerald-600/20"
            }`}
          >
            <span>{isVideoCallActive ? "🟢" : "🎥"}</span>
            <span className="hidden sm:inline">
              {isVideoCallActive ? "In Call" : "Video Call"}
            </span>
          </button>
        )}

        {/* NEXT STRANGER / SKIP BUTTON */}
        {onSkip && (
          <button
            type="button"
            onClick={onSkip}
            title="Skip to next stranger"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 text-white text-xs font-semibold shadow-sm transition active:scale-95"
          >
            <span>Next Stranger</span>
            <span>⏭</span>
          </button>
        )}

        {/* PROFILE BUTTON */}
        <button
          type="button"
          onClick={onViewProfile}
          className="px-2.5 py-1.5 rounded-xl bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 hover:text-white text-xs font-medium border border-zinc-700/50 transition"
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
              aria-label="Safety options"
              aria-expanded={showMenu}
              className="flex h-8 w-8 items-center justify-center rounded-xl bg-zinc-800/80 hover:bg-zinc-700 text-zinc-400 hover:text-white border border-zinc-700/50 transition font-bold"
              title="Safety Options"
            >
              ⋮
            </button>

            {showMenu && (
              <div
                className="absolute right-0 mt-2 w-44 rounded-2xl bg-zinc-900 p-1.5 shadow-2xl border border-zinc-800 z-30 animate-fadeIn text-zinc-200"
                onClick={() => setShowMenu(false)}
              >
                {onReport && (
                  <button
                    type="button"
                    onClick={onReport}
                    className="w-full text-left px-3 py-2 rounded-xl text-xs font-medium text-amber-400 hover:bg-amber-950/40 flex items-center gap-2 transition"
                  >
                    <span>🚩</span> Report Stranger
                  </button>
                )}
                {onBlock && (
                  <button
                    type="button"
                    onClick={onBlock}
                    className="w-full text-left px-3 py-2 rounded-xl text-xs font-medium text-red-400 hover:bg-red-950/40 flex items-center gap-2 transition"
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