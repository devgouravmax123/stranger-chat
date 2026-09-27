"use client";

import { useEffect, useRef, useState } from "react";
import EmojiPicker, { EmojiClickData } from "emoji-picker-react";
import VoiceRecorder, { VoiceRecorderHandle } from "./VoiceRecorder";
import { MAX_E2EE_IMAGE_BYTES } from "@/lib/crypto";
import { Message } from "./MessageList";

type MessageInputProps = {
  message: string;
  setMessage: (message: string) => void;
  sendMessage: () => void;
  onVoiceRecorded?: (audioBlob: Blob) => void;
  onImageSelected?: (file: File) => void;
  replyingTo?: Message | null;
  onCancelReply?: () => void;
  onTypingStart?: () => void;
  onTypingStop?: () => void;
  disabled?: boolean;
  isVoiceDisabled?: boolean;
  voiceDisabledReason?: string;
};

export default function MessageInput({
  message,
  setMessage,
  sendMessage,
  onVoiceRecorded,
  onImageSelected,
  replyingTo = null,
  onCancelReply,
  onTypingStart,
  onTypingStop,
  disabled = false,
  isVoiceDisabled = false,
  voiceDisabledReason,
}: MessageInputProps) {
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [attachedPreviewUrl, setAttachedPreviewUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [voiceRecordingState, setVoiceRecordingState] = useState<"idle" | "recording" | "recorded">("idle");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const voiceRecorderRef = useRef<VoiceRecorderHandle | null>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);

  // ==========================================
  // TYPING DEBOUNCE LOGIC
  // ==========================================

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setMessage(val);

    if (val.trim() !== "") {
      if (!isTypingRef.current && onTypingStart) {
        isTypingRef.current = true;
        onTypingStart();
      }

      if (typingTimerRef.current) {
        clearTimeout(typingTimerRef.current);
      }

      typingTimerRef.current = setTimeout(() => {
        if (isTypingRef.current && onTypingStop) {
          isTypingRef.current = false;
          onTypingStop();
        }
      }, 2000);
    } else {
      if (isTypingRef.current && onTypingStop) {
        isTypingRef.current = false;
        onTypingStop();
      }
    }
  };

  useEffect(() => {
    return () => {
      if (typingTimerRef.current) {
        clearTimeout(typingTimerRef.current);
      }
    };
  }, []);

  // ==========================================
  // TEXT ENTER
  // ==========================================

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSend();
    }
  };

  // ==========================================
  // EMOJI
  // ==========================================

  const handleEmojiClick = (emojiData: EmojiClickData) => {
    setMessage(message + emojiData.emoji);
  };

  // ==========================================
  // VOICE
  // ==========================================

  const handleVoiceRecorded = (audioBlob: Blob) => {
    if (onVoiceRecorded) {
      onVoiceRecorded(audioBlob);
    }
  };

  // ==========================================
  // FILE / IMAGE SELECTION & VALIDATION
  // ==========================================

  const handlePhotoClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setImageError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset input value so same file can be selected again if needed
    e.target.value = "";

    // 1. Strict MIME type validation: file.type MUST start with "image/"
    if (!file.type || !file.type.toLowerCase().startsWith("image/")) {
      setImageError("Invalid file format. Only image files (JPEG, PNG, WebP, GIF) are allowed.");
      return;
    }

    // 2. Strict size check: file MUST NOT exceed MAX_E2EE_IMAGE_BYTES
    if (file.size > MAX_E2EE_IMAGE_BYTES) {
      const maxMb = (MAX_E2EE_IMAGE_BYTES / (1024 * 1024)).toFixed(1);
      const actualMb = (file.size / (1024 * 1024)).toFixed(1);
      setImageError(`Image is too large (${actualMb} MB). Maximum allowed size is ${maxMb} MB.`);
      return;
    }

    // 3. Clean up any previous object URL before creating a new one
    if (attachedPreviewUrl) {
      try {
        URL.revokeObjectURL(attachedPreviewUrl);
      } catch {}
    }

    try {
      const localUrl = URL.createObjectURL(file);
      setAttachedFile(file);
      setAttachedPreviewUrl(localUrl);
    } catch (err) {
      console.error("[E2EE Photo] Failed to create local preview object URL:", err);
      setImageError("Failed to prepare image preview. Please try another image.");
    }
  };

  const clearAttachedImage = () => {
    if (attachedPreviewUrl) {
      try {
        URL.revokeObjectURL(attachedPreviewUrl);
      } catch {}
    }
    setAttachedFile(null);
    setAttachedPreviewUrl(null);
    setImageError(null);
  };

  // Clean up object URL when component unmounts
  useEffect(() => {
    return () => {
      if (attachedPreviewUrl) {
        try {
          URL.revokeObjectURL(attachedPreviewUrl);
        } catch {}
      }
    };
  }, [attachedPreviewUrl]);

  // ==========================================
  // SEND MESSAGE / IMAGE
  // ==========================================

  const handleSend = () => {
    if (isTypingRef.current && onTypingStop) {
      isTypingRef.current = false;
      onTypingStop();
    }

    if (attachedFile && onImageSelected) {
      onImageSelected(attachedFile);
      // Revoke the attached preview URL since page will handle optimistic display
      if (attachedPreviewUrl) {
        try {
          URL.revokeObjectURL(attachedPreviewUrl);
        } catch {}
      }
      setAttachedFile(null);
      setAttachedPreviewUrl(null);
      setImageError(null);
    } else if (message.trim() !== "") {
      sendMessage();
    }

    setShowEmojiPicker(false);
  };

  const renderReplyText = (msg: Message) => {
    if (msg.type === "audio") return "🎙️ Voice message";
    if (msg.type === "image") return "📷 Photo message";
    return msg.text;
  };

  return (
    <div className="border-t border-zinc-800/90 bg-zinc-900/95 p-2 sm:p-3 safe-bottom shrink-0">
      {/* ====================================== */}
      {/* REPLY PREVIEW BAR */}
      {/* ====================================== */}

      {replyingTo && (
        <div className="mb-2.5 flex items-center justify-between gap-2 rounded-xl bg-zinc-950 px-3 py-2 border-l-4 border-indigo-500 border border-zinc-800 animate-fadeIn text-zinc-200">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold text-indigo-400">
              ↩ Replying to {replyingTo.sender === "me" ? "yourself" : "Stranger"}
            </p>
            <p className="text-xs text-zinc-400 truncate font-mono mt-0.5">
              {renderReplyText(replyingTo)}
            </p>
          </div>
          {onCancelReply && (
            <button
              type="button"
              onClick={onCancelReply}
              className="rounded-lg p-1 text-zinc-400 hover:text-white hover:bg-zinc-800 transition"
              title="Cancel reply"
            >
              ✕
            </button>
          )}
        </div>
      )}

      {/* ====================================== */}
      {/* EMOJI PICKER */}
      {/* ====================================== */}

      {showEmojiPicker && (
        <div className="mb-3 rounded-2xl overflow-hidden border border-zinc-800 shadow-2xl">
          <EmojiPicker
            onEmojiClick={handleEmojiClick}
            width="100%"
            height={320}
            theme={"dark" as any}
            searchDisabled={false}
            skinTonesDisabled={false}
            previewConfig={{
              showPreview: false,
            }}
          />
        </div>
      )}

      {/* ====================================== */}
      {/* ERROR NOTICE BAR */}
      {/* ====================================== */}

      {imageError && (
        <div className="mb-3 flex items-center justify-between gap-2 rounded-xl bg-red-950/80 p-2.5 border border-red-800/80 text-red-200 text-xs animate-fadeIn">
          <span>⚠️ {imageError}</span>
          <button
            type="button"
            onClick={() => setImageError(null)}
            className="p-1 text-red-400 hover:text-white"
          >
            ✕
          </button>
        </div>
      )}

      {/* ====================================== */}
      {/* ATTACHED IMAGE PREVIEW BAR */}
      {/* ====================================== */}

      {attachedPreviewUrl && (
        <div className="mb-3 flex items-center gap-3 rounded-xl bg-zinc-950 p-2.5 border border-zinc-800 animate-fadeIn">
          <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-zinc-700 shadow-sm">
            <img
              src={attachedPreviewUrl}
              alt="Attached preview"
              className="h-full w-full object-cover"
            />
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-zinc-200 truncate">
              {attachedFile?.name || "Photo Attached"}
            </p>
            <p className="text-[11px] text-zinc-400">
              {attachedFile ? `${(attachedFile.size / 1024).toFixed(0)} KB • Encrypted before sending` : "Ready to send"}
            </p>
          </div>

          <button
            type="button"
            onClick={clearAttachedImage}
            title="Remove attachment"
            aria-label="Remove attachment"
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white font-bold transition"
          >
            ✕
          </button>
        </div>
      )}

      {/* ====================================== */}
      {/* HIDDEN FILE INPUT */}
      {/* ====================================== */}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* ====================================== */}
      {/* INPUT BAR */}
      {/* ====================================== */}

      {/* ====================================== */}
      {/* INPUT BAR */}
      {/* ====================================== */}

      {(() => {
        const hasText = message.trim().length > 0;
        const hasInput = hasText || !!attachedFile;
        const isVoiceActive = voiceRecordingState !== "idle";

        return (
          <div className="w-full">
            {/* If voice recording or recorded preview is active, render the full-width recorder interface */}
            <div className={isVoiceActive ? "w-full" : "hidden"}>
              <VoiceRecorder
                ref={voiceRecorderRef}
                onRecorded={handleVoiceRecorded}
                disabled={disabled || isVoiceDisabled}
                disabledReason={voiceDisabledReason}
                onRecordingStateChange={setVoiceRecordingState}
              />
            </div>

            {/* When not recording/previewing voice, render the standard text composer */}
            <div className={isVoiceActive ? "hidden" : "flex items-center gap-1.5 sm:gap-2"}>
              {/* EMOJI ICON (Always visible on desktop in idle & typing states) */}
              <button
                type="button"
                onClick={() => setShowEmojiPicker((previous) => !previous)}
                disabled={disabled}
                className="hidden sm:flex h-10 w-10 sm:h-11 sm:w-11 shrink-0 rounded-xl bg-zinc-800/90 hover:bg-zinc-700 border border-zinc-700/60 text-lg sm:text-xl transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 items-center justify-center text-zinc-200"
                aria-label="Emoji"
              >
                😊
              </button>

              {/* PHOTO / MEDIA ATTACH (Visible on desktop & mobile when input is empty, hidden when typing) */}
              {!hasInput && (
                <button
                  type="button"
                  onClick={handlePhotoClick}
                  disabled={disabled}
                  className="flex h-10 w-10 sm:h-11 sm:w-11 shrink-0 rounded-xl bg-zinc-800/90 hover:bg-zinc-700 border border-zinc-700/60 text-lg sm:text-xl transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 items-center justify-center text-zinc-200"
                  title="Send photo"
                  aria-label="Attach media"
                >
                  📷
                </button>
              )}

              {/* TEXT INPUT CONTAINER (Full width with embedded Voice Recorder when empty, WhatsApp-Style Arrow Send Button when typing) */}
              <div className="relative min-w-0 flex-1 flex items-center">
                <input
                  type="text"
                  aria-label={
                    attachedFile
                      ? "Add a caption"
                      : replyingTo
                      ? "Type your reply"
                      : "Type a message"
                  }
                  placeholder={
                    attachedFile
                      ? "Add a caption (optional)..."
                      : replyingTo
                      ? "Type your reply..."
                      : "Type a message..."
                  }
                  value={message}
                  onChange={handleInputChange}
                  onKeyDown={handleKeyDown}
                  disabled={disabled}
                  className="w-full rounded-xl bg-zinc-950 border border-zinc-700/80 px-3 sm:px-4 py-2.5 sm:py-3 text-sm text-white placeholder-zinc-500 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 disabled:bg-zinc-900 transition pr-11 sm:pr-12"
                />

                {/* EMBEDDED IDLE MIC TRIGGER (Inside composer right side when input is empty and voice is idle) */}
                {!hasInput && !isVoiceActive && (
                  <div className="absolute right-1 sm:right-1.5 flex items-center justify-center">
                    <button
                      type="button"
                      onClick={() => {
                        voiceRecorderRef.current?.startRecording();
                      }}
                      disabled={disabled || isVoiceDisabled}
                      title={
                        disabled && voiceDisabledReason
                          ? voiceDisabledReason
                          : isVoiceDisabled && voiceDisabledReason
                          ? voiceDisabledReason
                          : "Record voice message"
                      }
                      aria-label="Record voice message"
                      className="flex h-8 w-8 sm:h-8 sm:w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 hover:text-white text-base sm:text-lg transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
                    >
                      🎙️
                    </button>
                  </div>
                )}

                {/* WHATSAPP-STYLE RIGHT ARROW SEND BUTTON (Inside composer right side when typing on both mobile & desktop) */}
                {hasInput && (
                  <button
                    type="button"
                    onClick={handleSend}
                    disabled={disabled}
                    className="absolute right-1 sm:right-1.5 flex h-8 w-8 sm:h-8 sm:w-8 items-center justify-center rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white shadow-md active:scale-95 transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                    title="Send message"
                    aria-label="Send message"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      className="w-4 h-4 sm:w-4.5 sm:h-4.5"
                    >
                      <path
                        fillRule="evenodd"
                        d="M3 10a.75.75 0 01.75-.75h10.638L10.23 5.29a.75.75 0 111.04-1.08l5.5 5.25a.75.75 0 010 1.08l-5.5 5.25a.75.75 0 11-1.04-1.08l4.158-3.96H3.75A.75.75 0 013 10z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}