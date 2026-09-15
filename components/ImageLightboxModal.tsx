"use client";

import { useEffect } from "react";

type ImageLightboxModalProps = {
  imageUrl: string | null;
  onClose: () => void;
};

export default function ImageLightboxModal({
  imageUrl,
  onClose,
}: ImageLightboxModalProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    if (imageUrl) {
      document.addEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "hidden";
    }

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [imageUrl, onClose]);

  if (!imageUrl) return null;

  const handleDownload = () => {
    const a = document.createElement("a");
    a.href = imageUrl;
    a.download = `photo-${Date.now()}.jpg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90 backdrop-blur-sm p-4 transition-opacity animate-fadeIn"
      onClick={onClose}
    >
      {/* HEADER BAR */}
      <div
        className="absolute top-4 right-4 flex items-center gap-3 z-10"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={handleDownload}
          title="Download Image"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20 text-white transition hover:bg-white/30 active:scale-95"
        >
          📥
        </button>

        <button
          type="button"
          onClick={onClose}
          title="Close Preview"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20 text-white text-lg font-bold transition hover:bg-white/30 active:scale-95"
        >
          ✕
        </button>
      </div>

      {/* FULL IMAGE CONTAINER */}
      <div
        className="relative max-h-[85vh] max-w-[90vw] overflow-hidden rounded-2xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={imageUrl}
          alt="Expanded full size view"
          className="h-full w-full max-h-[85vh] max-w-[90vw] object-contain rounded-2xl select-none"
        />
      </div>
    </div>
  );
}
