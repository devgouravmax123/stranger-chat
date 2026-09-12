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
  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>
  ) => {
    if (e.key === "Enter") {
      sendMessage();
    }
  };

  return (
    <div className="border-t p-4 flex gap-3">

      <input
        type="text"
        placeholder="Type a message..."
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={handleKeyDown}
        className="flex-1 border border-zinc-300 rounded-xl px-4 py-3 outline-none focus:border-zinc-500"
      />

      <button
        onClick={sendMessage}
        className="bg-zinc-900 text-white px-5 py-3 rounded-xl font-medium hover:bg-zinc-700"
      >
        Send
      </button>

    </div>
  );
}