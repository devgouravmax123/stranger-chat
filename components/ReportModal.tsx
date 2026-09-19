"use client";

import { useState } from "react";

type ReportModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (reason: string, description: string) => void;
};

export default function ReportModal({
  isOpen,
  onClose,
  onSubmit,
}: ReportModalProps) {
  const [reason, setReason] = useState("Spam");
  const [description, setDescription] = useState("");
  const [isSubmitted, setIsSubmitted] = useState(false);

  if (!isOpen) return null;

  const reasons = [
    "Spam",
    "Harassment",
    "Inappropriate Content",
    "Scam",
    "Abuse",
    "Other",
  ];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(reason, description);
    setIsSubmitted(true);
    setTimeout(() => {
      setIsSubmitted(false);
      setDescription("");
      onClose();
    }, 1500);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="report-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-zinc-900 border border-zinc-800 p-6 shadow-2xl transition-all text-zinc-100"
        onClick={(e) => e.stopPropagation()}
      >
        {isSubmitted ? (
          <div className="py-6 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-950/60 border border-emerald-700/60 text-emerald-400 text-2xl font-bold">
              ✓
            </div>
            <h3 className="mt-4 text-lg font-bold text-white">
              Report Submitted
            </h3>
            <p className="mt-1 text-sm text-zinc-400">
              Thank you for helping keep Chirp safe.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
              <h2 id="report-modal-title" className="text-lg font-bold text-white flex items-center gap-2">
                <span>🚩</span> Report Stranger
              </h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close report dialog"
                className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              >
                ✕
              </button>
            </div>

            <div className="mt-4">
              <label className="block text-sm font-medium text-zinc-300 mb-2">
                Select Reason
              </label>
              <div className="grid grid-cols-2 gap-2">
                {reasons.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setReason(r)}
                    className={`rounded-xl border px-3 py-2 text-xs font-medium transition ${
                      reason === r
                        ? "border-red-500 bg-red-950/50 text-red-300 font-semibold"
                        : "border-zinc-800 bg-zinc-800/70 text-zinc-300 hover:bg-zinc-800"
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-4">
              <label className="block text-sm font-medium text-zinc-300 mb-1">
                Additional Details (Optional)
              </label>
              <textarea
                rows={3}
                placeholder="Describe what happened..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full rounded-xl border border-zinc-700/80 bg-zinc-950 p-3 text-sm text-white placeholder-zinc-500 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/20"
              />
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 shadow-sm"
              >
                Submit Report
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
