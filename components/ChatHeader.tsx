"use client";

type ChatHeaderProps = {
  onViewProfile: () => void;
};

export default function ChatHeader({
  onViewProfile,
}: ChatHeaderProps) {
  return (
    <header className="border-b px-6 py-4 flex items-center justify-between">

      <div>
        <h1 className="text-xl font-bold text-zinc-900">
          Stranger Chat
        </h1>

        <p className="text-sm text-green-600 mt-1">
          🟢 Connected to stranger
        </p>
      </div>

      <button
        type="button"
        onClick={onViewProfile}
        className="px-3 py-2 rounded-lg bg-zinc-100 text-zinc-700 text-sm font-medium hover:bg-zinc-200 transition"
      >
        👤 Profile
      </button>

    </header>
  );
}