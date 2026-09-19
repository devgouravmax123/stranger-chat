"use client";

import { useEffect, useRef, useState } from "react";
import EmojiPicker, { EmojiClickData } from "emoji-picker-react";
import VoiceRecorder from "./VoiceRecorder";
import { compressImage } from "@/lib/imageCompressor";
import { Message } from "./MessageList";

type MessageInputProps = {
  message: string;
  setMessage: (message: string) => void;
  sendMessage: () => void;
  onVoiceRecorded?: (audioBlob: Blob) => void;
  onImageSelected?: (imageDataUrl: string) => void;
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
  const [attachedImage, setAttachedImage] = useState<string | null>(null);
  const [isCompressing, setIsCompressing] = useState(false);
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
  // FILE / IMAGE SELECTION
  // ==========================================

  const handlePhotoClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsCompressing(true);
      const compressedDataUrl = await compressImage(file);
      setAttachedImage(compressedDataUrl);
    } catch (err) {
      console.error("Image compression error:", err);
      alert("Failed to process image file. Please try another image.");
    } finally {
      setIsCompressing(false);
      e.target.value = "";
    }
  };

  const clearAttachedImage = () => {
    setAttachedImage(null);
  };

  // ==========================================
  // SEND MESSAGE / IMAGE
  // ==========================================

  const handleSend = () => {
    if (isTypingRef.current && onTypingStop) {
      isTypingRef.current = false;
      onTypingStop();
    }

    if (attachedImage && onImageSelected) {
      onImageSelected(attachedImage);
      setAttachedImage(null);
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
    <div className="border-t border-zinc-800/90 bg-zinc-900/95 p-3 shrink-0">
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
      {/* ATTACHED IMAGE PREVIEW BAR */}
      {/* ====================================== */}

      {attachedImage && (
        <div className="mb-3 flex items-center gap-3 rounded-xl bg-zinc-950 p-2.5 border border-zinc-800 animate-fadeIn">
          <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-zinc-700 shadow-sm">
            <img
              src={attachedImage}
              alt="Attached preview"
              className="h-full w-full object-cover"
            />
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-zinc-200 truncate">
              Photo Attached
            </p>
            <p className="text-[11px] text-zinc-400">
              Ready to send with your message
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

      <div className="flex items-center gap-2">
        {/* EMOJI */}
        <button
          type="button"
          onClick={() => setShowEmojiPicker((previous) => !previous)}
          disabled={disabled}
          className="h-11 w-11 shrink-0 rounded-xl bg-zinc-800/90 hover:bg-zinc-700 border border-zinc-700/60 text-xl transition disabled:cursor-not-allowed disabled:opacity-50 flex items-center justify-center text-zinc-200"
          aria-label="Open emoji picker"
        >
          😊
        </button>

        {/* PHOTO / MEDIA ATTACH */}
        <button
          type="button"
          onClick={handlePhotoClick}
          disabled={disabled || isCompressing}
          className="h-11 w-11 shrink-0 rounded-xl bg-zinc-800/90 hover:bg-zinc-700 border border-zinc-700/60 text-xl transition disabled:cursor-not-allowed disabled:opacity-50 flex items-center justify-center text-zinc-200"
          title="Send photo"
          aria-label="Upload photo"
        >
          {isCompressing ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-400 border-t-white" />
          ) : (
            "📷"
          )}
        </button>

        {/* VOICE */}
        <VoiceRecorder
          onRecorded={handleVoiceRecorded}
          disabled={disabled || isVoiceDisabled}
          disabledReason={voiceDisabledReason}
        />

        {/* TEXT */}
        <input
          type="text"
          aria-label={
            attachedImage
              ? "Add a caption"
              : replyingTo
              ? "Type your reply"
              : "Type a message"
          }
          placeholder={
            attachedImage
              ? "Add a caption (optional)..."
              : replyingTo
              ? "Type your reply..."
              : "Type a message..."
          }
          value={message}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          className="min-w-0 flex-1 rounded-xl bg-zinc-950 border border-zinc-700/80 px-4 py-3 text-sm text-white placeholder-zinc-500 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 disabled:bg-zinc-900 transition"
        />

        {/* SEND */}
        <button
          type="button"
          onClick={handleSend}
          disabled={disabled || (!attachedImage && message.trim() === "")}
          className="rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 px-5 py-3 font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-40 shrink-0 text-sm shadow-sm active:scale-95"
        >
          Send
        </button>
      </div>
    </div>
  );
}