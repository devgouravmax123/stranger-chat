"use client";

import { useState } from "react";
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

export default function MessageList({
  messages,
  currentUserId = null,
  onReplyMessage,
  onDeleteMessage,
  onToggleReaction,
}: MessageListProps) {
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [activeActionId, setActiveActionId] = useState<string | null>(null);

  const availableEmojis = ["❤️", "😂", "👍", "😮", "😢", "😡"];

  const renderStatusBadge = (msg: Message) => {
    if (msg.sender !== "me") return null;
    const status = msg.status || "sent";

    switch (status) {
      case "sending":
        return <span className="text-[10px] text-zinc-400">⏳</span>;
      case "sent":
        return <span className="text-[10px] text-zinc-400" title="Sent">✓</span>;
      case "delivered":
        return <span className="text-[10px] text-zinc-400" title="Delivered">✓✓</span>;
      case "seen":
        return <span className="text-[10px] text-blue-400 font-bold" title="Seen">✓✓</span>;
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
    <div className="flex-1 overflow-y-auto p-4 space-y-3">
      {messages.length === 0 ? (
        <div className="h-full flex items-center justify-center">
          <p className="text-sm text-zinc-400">
            No messages yet. Start the conversation!
          </p>
        </div>
      ) : (
        messages.map((message, index) => {
          const isMe = message.sender === "me";
          const isDeleted = Boolean(message.deletedAt);
          const msgKey = message.id || message.clientId || `${message.timestamp}-${index}`;

          return (
            <div
              key={msgKey}
              className={`group relative flex flex-col ${
                isMe ? "items-end" : "items-start"
              }`}
            >
              <div
                className={`relative flex items-center gap-2 max-w-[85%] ${
                  isMe ? "flex-row-reverse" : "flex-row"
                }`}
              >
                {/* MESSAGE BUBBLE */}
                <div
                  className={`rounded-2xl transition-all shadow-sm ${
                    isDeleted
                      ? "bg-zinc-100 text-zinc-400 italic px-4 py-2 text-xs border border-zinc-200"
                      : message.type === "audio"
                      ? "p-1.5 " + (isMe ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-900")
                      : message.type === "image"
                      ? "p-2 " + (isMe ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-900")
                      : "px-4 py-2.5 " + (isMe ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-900")
                  }`}
                >
                  {/* REPLIED QUOTE PREVIEW */}
                  {!isDeleted && message.replyTo && (
                    <div
                      className={`mb-2 rounded-xl p-2 text-xs border-l-2 ${
                        isMe
                          ? "bg-white/10 border-white text-zinc-200"
                          : "bg-zinc-200/60 border-zinc-900 text-zinc-700"
                      }`}
                    >
                      <p className="font-semibold text-[10px]">
                        ↩ {message.replyTo.sender === "me" ? "You" : "Stranger"}
                      </p>
                      <p className="truncate font-mono text-[11px] mt-0.5">
                        {formatParentReply(message.replyTo)}
                      </p>
                    </div>
                  )}

                  {/* DELETED MESSAGE CONTENT */}
                  {isDeleted ? (
                    <p className="flex items-center gap-1.5">
                      <span>🚫</span> This message was deleted
                    </p>
                  ) : message.type === "audio" && message.audioUrl ? (
                    /* AUDIO MESSAGE */
                    <AudioPlayer src={message.audioUrl} isMe={isMe} />
                  ) : message.type === "image" && message.imageUrl ? (
                    /* IMAGE MESSAGE */
                    <div className="flex flex-col gap-1.5">
                      <div
                        onClick={() => setLightboxImage(message.imageUrl || null)}
                        className="relative max-w-[260px] max-h-[260px] overflow-hidden rounded-xl cursor-pointer group/img shadow-sm"
                      >
                        <img
                          src={message.imageUrl}
                          alt="Shared photo"
                          className="h-full w-full object-cover transition transform duration-200 group-hover/img:scale-105"
                          loading="lazy"
                        />
                        <div className="absolute inset-0 bg-black/20 opacity-0 group-hover/img:opacity-100 transition flex items-center justify-center text-white text-xs font-semibold">
                          🔍 Expand
                        </div>
                      </div>

                      {message.text && message.text !== "Photo message" && (
                        <p className="px-1 break-words whitespace-pre-wrap text-sm">
                          {message.text}
                        </p>
                      )}
                    </div>
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
                    } ${isMe ? "text-zinc-400" : "text-zinc-500"}`}
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

                {/* ACTION TRIGGER BUTTONS ON HOVER */}
                {!isDeleted && (
                  <div className="opacity-0 group-hover:opacity-100 transition flex items-center gap-1">
                    {onReplyMessage && (
                      <button
                        type="button"
                        onClick={() => onReplyMessage(message)}
                        className="h-7 w-7 rounded-full bg-zinc-100 hover:bg-zinc-200 text-zinc-600 flex items-center justify-center text-xs shadow-sm transition"
                        title="Reply"
                      >
                        ↩
                      </button>
                    )}

                    {onToggleReaction && message.id && (
                      <button
                        type="button"
                        onClick={() =>
                          setActiveActionId((prev) =>
                            prev === message.id ? null : (message.id || null),
                          )
                        }
                        className="h-7 w-7 rounded-full bg-zinc-100 hover:bg-zinc-200 text-zinc-600 flex items-center justify-center text-xs shadow-sm transition"
                        title="React"
                      >
                        😊
                      </button>
                    )}

                    {isMe && onDeleteMessage && message.id && (
                      <button
                        type="button"
                        onClick={() => onDeleteMessage(message.id!)}
                        className="h-7 w-7 rounded-full bg-red-50 hover:bg-red-100 text-red-600 flex items-center justify-center text-xs shadow-sm transition"
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
                  className={`mt-1 flex items-center gap-1 rounded-full bg-white p-1.5 shadow-lg border border-zinc-200 z-20 animate-fadeIn ${
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
                      className="h-7 w-7 rounded-full text-base transition transform hover:scale-125 hover:bg-zinc-100 flex items-center justify-center"
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