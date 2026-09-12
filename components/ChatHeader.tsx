export default function ChatHeader() {
  return (
    <header className="border-b px-6 py-4">
      <h1 className="text-xl font-bold text-zinc-900">
        Stranger Chat
      </h1>

      <p className="text-sm text-green-600 mt-1">
        🟢 Connected to stranger
      </p>
    </header>
  );
}