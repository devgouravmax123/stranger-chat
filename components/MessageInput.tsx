"use client";

import { useEffect, useRef, useState } from "react";
import EmojiPicker, { EmojiClickData } from "emoji-picker-react";
import VoiceRecorder from "./VoiceRecorder";
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
  const fileInputRef = useRef<HTMLInputElement | null>(null);
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
    }

    if (message.trim() !== "") {
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

      <div className="flex items-center gap-1.5 sm:gap-2">
        {/* EMOJI (Completely removed on mobile, available on desktop) */}
        <button
          type="button"
          onClick={() => setShowEmojiPicker((previous) => !previous)}
          disabled={disabled}
          className="hidden sm:flex h-10 w-10 sm:h-11 sm:w-11 shrink-0 rounded-xl bg-zinc-800/90 hover:bg-zinc-700 border border-zinc-700/60 text-lg sm:text-xl transition disabled:cursor-not-allowed disabled:opacity-50 items-center justify-center text-zinc-200"
          aria-label="Open emoji picker"
        >
          😊
        </button>

        {/* PHOTO / MEDIA ATTACH (Hidden on mobile when user is typing or has entered text/file) */}
        <button
          type="button"
          onClick={handlePhotoClick}
          disabled={disabled}
          className={`${
            message.length > 0 || attachedFile ? "hidden sm:flex" : "flex"
          } h-10 w-10 sm:h-11 sm:w-11 shrink-0 rounded-xl bg-zinc-800/90 hover:bg-zinc-700 border border-zinc-700/60 text-lg sm:text-xl transition disabled:cursor-not-allowed disabled:opacity-50 items-center justify-center text-zinc-200`}
          title="Send photo"
          aria-label="Upload photo"
        >
          📷
        </button>

        {/* VOICE RECORDER (Hidden on mobile when user is typing or has entered text/file) */}
        <div className={message.length > 0 || attachedFile ? "hidden sm:block shrink-0" : "shrink-0"}>
          <VoiceRecorder
            onRecorded={handleVoiceRecorded}
            disabled={disabled || isVoiceDisabled}
            disabledReason={voiceDisabledReason}
          />
        </div>

        {/* TEXT INPUT CONTAINER (Expands across full available width with embedded mobile send arrow) */}
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
            className={`w-full rounded-xl bg-zinc-950 border border-zinc-700/80 px-3 sm:px-4 py-2.5 sm:py-3 text-sm text-white placeholder-zinc-500 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 disabled:bg-zinc-900 transition ${
              message.trim() !== "" || attachedFile ? "pr-10 sm:pr-4" : ""
            }`}
          />

          {/* MOBILE INTEGRATED SEND ARROW BUTTON */}
          {(message.trim() !== "" || attachedFile) && (
            <button
              type="button"
              onClick={handleSend}
              disabled={disabled}
              className="sm:hidden absolute right-1.5 flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-sm active:scale-95 transition hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed"
              title="Send message"
              aria-label="Send message"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="w-4 h-4"
              >
                <path d="M3.105 2.289a.75.75 0 00-.826.95l1.414 4.925A1.5 1.5 0 004.978 9.25h4.772a.75.75 0 010 1.5H4.978a1.5 1.5 0 00-1.285 1.086l-1.414 4.925a.75.75 0 00.826.95 28.896 28.896 0 0015.293-7.154.75.75 0 000-1.112A28.896 28.896 0 003.105 2.289z" />
              </svg>
            </button>
          )}
        </div>

        {/* DESKTOP SEND BUTTON (Hidden on mobile, preserved on desktop) */}
        <button
          type="button"
          onClick={handleSend}
          disabled={disabled || (!attachedFile && message.trim() === "")}
          className="hidden sm:inline-flex rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 px-3.5 sm:px-5 py-2.5 sm:py-3 font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-40 shrink-0 text-sm shadow-sm active:scale-95 items-center justify-center"
        >
          Send
        </button>
      </div>
    </div>
  );
}