"use client";

import { useState } from "react";

interface CallingModalProps {
  onCancel: () => void;
  targetName?: string | null;
}

export default function CallingModal({ onCancel, targetName }: CallingModalProps) {
  const [isCancelling, setIsCancelling] = useState(false);

  const handleCancelClick = () => {
    if (isCancelling) return;
    setIsCancelling(true);
    onCancel();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="calling-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fadeIn"
    >
      <div className="w-full max-w-sm rounded-3xl bg-zinc-900/95 border border-zinc-700/80 p-6 shadow-2xl text-center relative overflow-hidden">
        {/* Subtle accent glow */}
        <div className="absolute -top-10 -left-10 w-32 h-32 bg-indigo-500/20 rounded-full blur-3xl pointer-events-none" />

        {/* Pulsing radar animation around icon */}
        <div className="relative mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-600/20 border border-indigo-500/40 text-3xl text-indigo-400 shadow-lg shadow-indigo-600/20">
          <span className="animate-pulse">🎥</span>
          <span className="absolute -inset-1 rounded-2xl border border-indigo-400/40 animate-ping opacity-75" />
        </div>

        <h2 id="calling-modal-title" className="text-lg font-bold text-white tracking-tight">
          {targetName ? `Calling ${targetName}...` : "Calling Stranger..."}
        </h2>
        <p className="text-xs text-zinc-400 mt-1.5 leading-relaxed">
          {targetName ? `Waiting for ${targetName} to respond.` : "Waiting for stranger to respond."}
        </p>

        <div className="mt-6">
          <button
            type="button"
            disabled={isCancelling}
            onClick={handleCancelClick}
            aria-label="Cancel video call"
            className="w-full py-2.5 px-4 rounded-xl bg-zinc-800 hover:bg-rose-950/60 hover:text-rose-400 text-zinc-300 border border-zinc-700/50 hover:border-rose-800/60 text-xs font-semibold transition active:scale-95 flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span>✕</span>
            <span>{isCancelling ? "Cancelling..." : "Cancel"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
