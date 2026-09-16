"use client";

import { useState } from "react";

interface IncomingCallModalProps {
  onAccept: () => void;
  onDecline: () => void;
  callerName?: string | null;
  callerAvatar?: string | null;
}

export default function IncomingCallModal({
  onAccept,
  onDecline,
  callerName,
  callerAvatar,
}: IncomingCallModalProps) {
  const [isProcessing, setIsProcessing] = useState<"accepting" | "declining" | null>(null);

  const handleAcceptClick = () => {
    if (isProcessing) return;
    setIsProcessing("accepting");
    onAccept();
  };

  const handleDeclineClick = () => {
    if (isProcessing) return;
    setIsProcessing("declining");
    onDecline();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="incoming-call-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fadeIn"
    >
      <div className="w-full max-w-sm rounded-3xl bg-zinc-900/95 border border-zinc-700/80 p-6 shadow-2xl text-center relative overflow-hidden">
        {/* Subtle accent glow */}
        <div className="absolute -top-10 -left-10 w-32 h-32 bg-indigo-500/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-10 -right-10 w-32 h-32 bg-emerald-500/20 rounded-full blur-3xl pointer-events-none" />

        {/* Pulsing camera icon or avatar badge */}
        <div className="relative mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-600/20 border border-indigo-500/40 text-3xl text-indigo-400 shadow-lg shadow-indigo-600/20">
          {callerAvatar ? (
            <span className="text-2xl">{callerAvatar}</span>
          ) : (
            <span className="animate-bounce">📹</span>
          )}
          <span className="absolute -top-1 -right-1 flex h-4 w-4">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-4 w-4 bg-emerald-500" />
          </span>
        </div>

        <h2 id="incoming-call-title" className="text-lg font-bold text-white tracking-tight">
          Incoming Video Call
        </h2>
        <p className="text-xs text-zinc-400 mt-1.5 leading-relaxed">
          {callerName
            ? `${callerName} wants to start a video call with audio and video.`
            : "Your stranger wants to start a video call with audio and video."}
        </p>

        <div className="mt-6 grid grid-cols-2 gap-3">
          <button
            type="button"
            disabled={!!isProcessing}
            onClick={handleDeclineClick}
            aria-label="Decline video call"
            className="w-full py-2.5 px-4 rounded-xl bg-zinc-800/90 hover:bg-rose-950/60 hover:text-rose-400 text-zinc-300 border border-zinc-700/50 hover:border-rose-800/60 text-xs font-semibold transition active:scale-95 flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span>✕</span>
            <span>{isProcessing === "declining" ? "Declining..." : "Decline"}</span>
          </button>

          <button
            type="button"
            disabled={!!isProcessing}
            onClick={handleAcceptClick}
            aria-label="Accept video call"
            className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-semibold shadow-lg shadow-emerald-600/20 transition active:scale-95 flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span>✓</span>
            <span>{isProcessing === "accepting" ? "Connecting..." : "Accept"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
