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
    <div className="border-t bg-white p-3">
      {/* ====================================== */}
      {/* REPLY PREVIEW BAR */}
      {/* ====================================== */}

      {replyingTo && (
        <div className="mb-2.5 flex items-center justify-between gap-2 rounded-xl bg-zinc-100 px-3 py-2 border-l-4 border-zinc-900 animate-fadeIn">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold text-zinc-700">
              ↩ Replying to {replyingTo.sender === "me" ? "yourself" : "Stranger"}
            </p>
            <p className="text-xs text-zinc-600 truncate font-mono mt-0.5">
              {renderReplyText(replyingTo)}
            </p>
          </div>
          {onCancelReply && (
            <button
              type="button"
              onClick={onCancelReply}
              className="rounded-lg p-1 text-zinc-500 hover:bg-zinc-200"
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
        <div className="mb-3">
          <EmojiPicker
            onEmojiClick={handleEmojiClick}
            width="100%"
            height={350}
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
        <div className="mb-3 flex items-center gap-3 rounded-xl bg-zinc-100 p-2.5 border border-zinc-200 animate-fadeIn">
          <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-zinc-300 shadow-sm">
            <img
              src={attachedImage}
              alt="Attached preview"
              className="h-full w-full object-cover"
            />
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-zinc-800 truncate">
              Photo Attached
            </p>
            <p className="text-[11px] text-zinc-500">
              Ready to send with your message
            </p>
          </div>

          <button
            type="button"
            onClick={clearAttachedImage}
            title="Remove attachment"
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-200 text-zinc-700 font-bold hover:bg-zinc-300"
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
          className="h-11 w-11 shrink-0 rounded-xl bg-zinc-100 text-2xl transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="Open emoji picker"
        >
          😊
        </button>

        {/* PHOTO / MEDIA ATTACH */}

        <button
          type="button"
          onClick={handlePhotoClick}
          disabled={disabled || isCompressing}
          className="h-11 w-11 shrink-0 rounded-xl bg-zinc-100 text-xl transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50 flex items-center justify-center"
          title="Send photo"
          aria-label="Upload photo"
        >
          {isCompressing ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-400 border-t-zinc-900" />
          ) : (
            "📷"
          )}
        </button>

        {/* VOICE */}

        <VoiceRecorder onRecorded={handleVoiceRecorded} disabled={disabled} />

        {/* TEXT */}

        <input
          type="text"
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
          className="min-w-0 flex-1 rounded-xl border border-zinc-300 px-4 py-3 outline-none focus:border-zinc-500 disabled:bg-zinc-100 text-sm"
        />

        {/* SEND */}

        <button
          type="button"
          onClick={handleSend}
          disabled={disabled || (!attachedImage && message.trim() === "")}
          className="rounded-xl bg-zinc-900 px-5 py-3 font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:bg-zinc-300 shrink-0 text-sm"
        >
          Send
        </button>
      </div>
    </div>
  );
}