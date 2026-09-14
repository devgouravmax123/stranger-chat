"use client";

import { useEffect, useRef } from "react";

import type { Message } from "@/app/page";

type MessageListProps = {
  messages: Message[];
};

export default function MessageList({
  messages,
}: MessageListProps) {
  const messagesEndRef =
    useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth",
    });
  }, [messages]);

  return (
    <div className="flex-1 p-6 space-y-4 overflow-y-auto">

      {messages.map((message, index) => {
        const isMine =
          message.sender === "me";

        return (
          <div
            key={`${message.timestamp}-${index}`}
            className={`flex ${
              isMine
                ? "justify-end"
                : "justify-start"
            }`}
          >
            <div
              className={`px-4 py-3 rounded-2xl max-w-[75%] break-words ${
                isMine
                  ? "bg-zinc-900 text-white rounded-br-sm"
                  : "bg-zinc-200 text-zinc-900 rounded-bl-sm"
              }`}
            >
              {message.text}
            </div>
          </div>
        );
      })}

      <div ref={messagesEndRef} />

    </div>
  );
}