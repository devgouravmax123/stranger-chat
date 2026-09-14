"use client";

import { useState } from "react";
import EmojiPicker, {
  EmojiClickData,
} from "emoji-picker-react";

type MessageInputProps = {
  message: string;
  setMessage: (message: string) => void;
  sendMessage: () => void;
};

export default function MessageInput({
  message,
  setMessage,
  sendMessage,
}: MessageInputProps) {
  const [showEmojiPicker, setShowEmojiPicker] =
    useState(false);

  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
  ) => {
    if (e.key === "Enter") {
      sendMessage();
      setShowEmojiPicker(false);
    }
  };

  const handleEmojiClick = (
    emojiData: EmojiClickData,
  ) => {
    setMessage(
      message + emojiData.emoji,
    );
  };

  return (
    <div className="border-t bg-white p-4">

      {/* EMOJI PICKER */}

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

      {/* INPUT BAR */}

      <div className="flex gap-2 items-center">

        {/* EMOJI BUTTON */}

        <button
          type="button"
          onClick={() =>
            setShowEmojiPicker(
              (previous) => !previous,
            )
          }
          className="h-11 w-11 shrink-0 rounded-xl bg-zinc-100 text-2xl hover:bg-zinc-200 transition"
          aria-label="Open emoji picker"
        >
          😊
        </button>

        {/* TEXT INPUT */}

        <input
          type="text"
          placeholder="Type a message..."
          value={message}
          onChange={(e) =>
            setMessage(e.target.value)
          }
          onKeyDown={handleKeyDown}
          className="flex-1 border border-zinc-300 rounded-xl px-4 py-3 outline-none focus:border-zinc-500"
        />

        {/* SEND BUTTON */}

        <button
          type="button"
          onClick={() => {
            sendMessage();
            setShowEmojiPicker(false);
          }}
          disabled={
            message.trim() === ""
          }
          className="bg-zinc-900 text-white px-5 py-3 rounded-xl font-medium hover:bg-zinc-700 disabled:bg-zinc-300 disabled:cursor-not-allowed transition"
        >
          Send
        </button>

      </div>
    </div>
  );
}