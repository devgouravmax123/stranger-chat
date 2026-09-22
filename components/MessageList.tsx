"use client";

import { useState, useRef, useCallback } from "react";
import AudioPlayer from "./AudioPlayer";
import ImageLightboxModal from "./ImageLightboxModal";

export type ReactionItem = {
  emoji: string;
  userId: string;
};

export type Message = {
  id?: string;
  clientId?: string;
  text: string;
  sender: "me" | "stranger";
  timestamp: number;
  type?: "text" | "audio" | "image";
  audioUrl?: string;
  imageUrl?: string;
  status?: "sending" | "sent" | "delivered" | "seen";
  deliveredAt?: number;
  seenAt?: number;
  deletedAt?: number | string | null;
  replyToId?: string | null;
  replyTo?: {
    id?: string;
    text: string;
    sender?: "me" | "stranger";
    type?: "text" | "audio" | "image";
  } | null;
  reactions?: ReactionItem[];
};

type MessageListProps = {
  messages: Message[];
  currentUserId?: string | null;
  onReplyMessage?: (message: Message) => void;
  onDeleteMessage?: (messageId: string) => void;
  onToggleReaction?: (messageId: string, emoji: string) => void;
};

const LONG_PRESS_DURATION = 500; // ms
const LONG_PRESS_MOVE_THRESHOLD = 10; // px — cancel if finger moves more than this

export default function MessageList({
  messages,
  currentUserId = null,
  onReplyMessage,
  onDeleteMessage,
  onToggleReaction,
}: MessageListProps) {
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [activeActionId, setActiveActionId] = useState<string | null>(null);
  const [longPressActionId, setLongPressActionId] = useState<string | null>(null);

  // Long-press refs
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartPosRef = useRef<{ x: number; y: number } | null>(null);

  const clearLongPress = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    touchStartPosRef.current = null;
  }, []);

  const handleTouchStart = useCallback(
    (msgKey: string, e: React.TouchEvent) => {
      const touch = e.touches[0];
      touchStartPosRef.current = { x: touch.clientX, y: touch.clientY };
      longPressTimerRef.current = setTimeout(() => {
        setLongPressActionId((prev) => (prev === msgKey ? null : msgKey));
        setActiveActionId(null); // close emoji picker if open
        longPressTimerRef.current = null;
      }, LONG_PRESS_DURATION);
    },
    [],
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!touchStartPosRef.current) return;
      const touch = e.touches[0];
      const dx = Math.abs(touch.clientX - touchStartPosRef.current.x);
      const dy = Math.abs(touch.clientY - touchStartPosRef.current.y);
      if (dx > LONG_PRESS_MOVE_THRESHOLD || dy > LONG_PRESS_MOVE_THRESHOLD) {
        clearLongPress();
      }
    },
    [clearLongPress],
  );

  const handleTouchEnd = useCallback(() => {
    clearLongPress();
  }, [clearLongPress]);

  const availableEmojis = ["❤️", "😂", "👍", "😮", "😢", "😡"];

  const renderStatusBadge = (msg: Message) => {
    if (msg.sender !== "me") return null;
    const status = msg.status || "sent";

    switch (status) {
      case "sending":
        return <span className="text-[10px] text-zinc-400">⏳</span>;
      case "sent":
        return <span className="text-[10px] text-zinc-400 tracking-tight" title="Sent">✓</span>;
      case "delivered":
        return <span className="text-[10px] text-zinc-400 tracking-tight" title="Delivered">✓✓</span>;
      case "seen":
        return <span className="text-[10px] text-sky-400 font-bold tracking-tight" title="Seen">✓✓</span>;
      default:
        return null;
    }
  };

  const formatParentReply = (reply: Message["replyTo"]) => {
    if (!reply) return null;
    if (reply.type === "audio") return "🎙️ Voice message";
    if (reply.type === "image") return "📷 Photo message";
    return reply.text;
  };

  return (
    <div
      className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3"
      onClick={() => { setLongPressActionId(null); setActiveActionId(null); }}
    >
      {messages.length === 0 ? (
        <div className="h-full flex flex-col items-center justify-center text-center p-6 text-zinc-500">
          <div className="w-12 h-12 rounded-2xl bg-zinc-800/60 border border-zinc-700/40 flex items-center justify-center text-2xl mb-3 shadow-inner">
            💬
          </div>
          <p className="text-sm font-semibold text-zinc-300">No messages yet</p>
          <p className="text-xs text-zinc-500 mt-1 max-w-xs">
            Say hello or tap a conversation idea below to break the ice!
          </p>
        </div>
      ) : (
        messages.map((message, index) => {
          const isMe = message.sender === "me";
          const isDeleted = Boolean(message.deletedAt);
          const msgKey = message.clientId || message.id || `${message.timestamp}-${index}`;

          return (
            <div
              key={msgKey}
              className={`group relative flex flex-col ${
                isMe ? "items-end" : "items-start"
              }`}
              onTouchStart={(e) => handleTouchStart(msgKey, e)}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              onTouchCancel={handleTouchEnd}
            >
              <div
                className={`relative flex items-center gap-2 max-w-[92%] xs:max-w-[88%] sm:max-w-[75%] md:max-w-[70%] ${
                  isMe ? "flex-row-reverse" : "flex-row"
                }`}
              >
                {/* MESSAGE BUBBLE */}
                <div
                  className={`rounded-2xl transition-all shadow-sm ${
                    isDeleted
                      ? "bg-zinc-800/50 text-zinc-400 italic px-4 py-2 text-xs border border-zinc-800"
                      : message.type === "audio"
                      ? "p-1.5 " + (isMe ? "bg-gradient-to-r from-indigo-600 to-indigo-700 text-white rounded-tr-xs shadow-md shadow-indigo-900/20" : "bg-zinc-800 text-zinc-100 border border-zinc-700/60 rounded-tl-xs")
                      : message.type === "image"
                      ? "p-2 " + (isMe ? "bg-gradient-to-r from-indigo-600 to-indigo-700 text-white rounded-tr-xs shadow-md shadow-indigo-900/20" : "bg-zinc-800 text-zinc-100 border border-zinc-700/60 rounded-tl-xs")
                      : "px-4 py-2.5 " + (isMe ? "bg-gradient-to-r from-indigo-600 to-indigo-700 text-white rounded-tr-xs shadow-md shadow-indigo-900/20" : "bg-zinc-800 text-zinc-100 border border-zinc-700/60 rounded-tl-xs")
                  }`}
                >
                  {/* REPLIED QUOTE PREVIEW */}
                  {!isDeleted && message.replyTo && (
                    <div
                      className={`mb-2 rounded-xl p-2 text-xs border-l-2 ${
                        isMe
                          ? "bg-white/10 border-white text-zinc-200"
                          : "bg-zinc-900/80 border-indigo-500 text-zinc-300"
                      }`}
                    >
                      <p className="font-semibold text-[10px] text-zinc-300">
                        ↩ {message.replyTo.sender === "me" ? "You" : "Stranger"}
                      </p>
                      <p className="truncate font-mono text-[11px] mt-0.5 text-zinc-400">
                        {formatParentReply(message.replyTo)}
                      </p>
                    </div>
                  )}

                  {/* DELETED MESSAGE CONTENT */}
                  {isDeleted ? (
                    <p className="flex items-center gap-1.5">
                      <span>🚫</span> This message was deleted
                    </p>
                  ) : message.type === "audio" ? (
                    /* AUDIO MESSAGE */
                    message.audioUrl ? (
                      <AudioPlayer src={message.audioUrl} isMe={isMe} />
                    ) : (
                      <div className="flex items-center gap-2 rounded-lg bg-black/20 p-2 text-xs text-zinc-300">
                        <span>🎙️</span>
                        <span className="italic">{message.text || "Unable to decrypt this voice message"}</span>
                      </div>
                    )
                  ) : message.type === "image" ? (
                    /* IMAGE MESSAGE */
                    message.imageUrl ? (
                      <div className="flex flex-col gap-1.5">
                        <div
                          onClick={() => setLightboxImage(message.imageUrl || null)}
                          className="relative max-w-[260px] max-h-[260px] overflow-hidden rounded-xl cursor-pointer group/img shadow-sm"
                        >
                          <img
                            src={message.imageUrl}
                            alt="Encrypted photo"
                            className="h-full w-full object-cover transition transform duration-200 group-hover/img:scale-105"
                            loading="lazy"
                          />
                          <div className="absolute inset-0 bg-black/30 opacity-0 group-hover/img:opacity-100 transition flex items-center justify-center text-white text-xs font-semibold backdrop-blur-2xs">
                            🔍 Expand
                          </div>
                        </div>

                        {message.text && message.text !== "Photo message" && (
                          <p className="px-1 break-words whitespace-pre-wrap text-sm leading-relaxed">
                            {message.text}
                          </p>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 rounded-lg bg-black/20 p-2 text-xs text-zinc-300">
                        <span>📷</span>
                        <span className="italic">{message.text || "Unable to decrypt this photo"}</span>
                      </div>
                    )
                  ) : (
                    /* TEXT MESSAGE */
                    <p className="break-words whitespace-pre-wrap text-sm leading-relaxed">
                      {message.text}
                    </p>
                  )}

                  {/* TIMESTAMP & STATUS TICKS */}
                  <div
                    className={`mt-1 flex items-center justify-end gap-1 text-[10px] ${
                      message.type === "image" ? "px-1" : ""
                    } ${isMe ? "text-indigo-200/80" : "text-zinc-400"}`}
                  >
                    <span>
                      {new Date(message.timestamp).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    {renderStatusBadge(message)}
                  </div>
                </div>

                {/* ACTION TRIGGER BUTTONS ON HOVER / LONG-PRESS */}
                {!isDeleted && (
                  <div className={`transition flex items-center gap-1 ${longPressActionId === msgKey ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
                    {onReplyMessage && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onReplyMessage(message); setLongPressActionId(null); }}
                        aria-label="Reply to this message"
                        className="h-7 w-7 rounded-full bg-zinc-800/90 hover:bg-zinc-700 text-zinc-300 hover:text-white flex items-center justify-center text-xs shadow-sm transition border border-zinc-700/60"
                        title="Reply"
                      >
                        ↩
                      </button>
                    )}

                    {onToggleReaction && message.id && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveActionId((prev) =>
                            prev === message.id ? null : (message.id || null),
                          );
                        }}
                        aria-label="React to this message"
                        className="h-7 w-7 rounded-full bg-zinc-800/90 hover:bg-zinc-700 text-zinc-300 hover:text-white flex items-center justify-center text-xs shadow-sm transition border border-zinc-700/60"
                        title="React"
                      >
                        😊
                      </button>
                    )}

                    {isMe && onDeleteMessage && message.id && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onDeleteMessage(message.id!); setLongPressActionId(null); }}
                        aria-label="Delete this message"
                        className="h-7 w-7 rounded-full bg-red-950/60 hover:bg-red-900/80 text-red-400 hover:text-red-300 flex items-center justify-center text-xs shadow-sm transition border border-red-800/50"
                        title="Delete"
                      >
                        🗑
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* EMOJI REACTION POPUP BAR */}
              {activeActionId === message.id && onToggleReaction && message.id && (
                <div
                  className={`mt-1 flex items-center gap-1 rounded-full bg-zinc-900 p-1.5 shadow-2xl border border-zinc-700/80 z-20 animate-fadeIn ${
                    isMe ? "mr-2" : "ml-2"
                  }`}
                >
                  {availableEmojis.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => {
                        onToggleReaction(message.id!, emoji);
                        setActiveActionId(null);
                      }}
                      className="h-7 w-7 rounded-full text-base transition transform hover:scale-125 hover:bg-zinc-800 flex items-center justify-center"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              )}

              {/* RENDERED REACTIONS BADGES */}
              {!isDeleted && message.reactions && message.reactions.length > 0 && (
                <div
                  className={`mt-1 flex flex-wrap gap-1 ${
                    isMe ? "justify-end pr-1" : "justify-start pl-1"
                  }`}
                >
                  {Object.entries(
                    message.reactions.reduce((acc, r) => {
                      acc[r.emoji] = (acc[r.emoji] || 0) + 1;
                      return acc;
                    }, {} as Record<string, number>),
                  ).map(([emoji, count]) => {
                    const hasReacted =
                      currentUserId &&
                      message.reactions?.some(
                        (r) => r.emoji === emoji && r.userId === currentUserId,
                      );

                    return (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() =>
                          onToggleReaction && message.id && onToggleReaction(message.id, emoji)
                        }
                        className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition ${
                          hasReacted
                            ? "border-blue-500 bg-blue-50 text-blue-700 font-bold"
                            : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-100"
                        }`}
                      >
                        <span>{emoji}</span>
                        {count > 1 && <span className="text-[10px]">{count}</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })
      )}

      {/* LIGHTBOX MODAL */}
      <ImageLightboxModal
        imageUrl={lightboxImage}
        onClose={() => setLightboxImage(null)}
      />
    </div>
  );
}