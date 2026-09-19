"use client";

import { useState, useEffect, useRef } from "react";
import { BACKEND_URL } from "@/lib/api-config";

export type SearchUserResult = {
  id: string;
  username: string | null;
  age: number | null;
  gender: string | null;
  avatar: string | null;
  language: string | null;
  interests: string[];
  goal: string | null;
  lastSeenAt: string | null;
  isOnline: boolean;
  relationshipStatus: "none" | "friends" | "pending_sent" | "pending_received" | "blocked";
  incomingRequestId?: string;
};

type SearchFriendsViewProps = {
  currentUserId: string;
  onBack: () => void;
  onOpenProfile: (userId: string) => void;
  onOpenPrivateChat: (friend: {
    id: string;
    username: string | null;
    avatar: string | null;
    isOnline?: boolean;
    lastSeenAt?: string | null;
  }) => void;
  onAcceptRequest: (requestId: string) => Promise<void>;
  showNotification: (msg: string) => void;
};

export default function SearchFriendsView({
  currentUserId,
  onBack,
  onOpenProfile,
  onOpenPrivateChat,
  onAcceptRequest,
  showNotification,
}: SearchFriendsViewProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchUserResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [sendingRequestIds, setSendingRequestIds] = useState<Record<string, boolean>>({});

  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  const executeSearch = async (searchTerm: string) => {
    const trimmed = searchTerm.trim();
    if (!trimmed) {
      setResults([]);
      setHasSearched(false);
      setIsLoading(false);
      setErrorMessage("");
      return;
    }

    if (trimmed.length < 2) {
      setResults([]);
      setHasSearched(true);
      setIsLoading(false);
      setErrorMessage("Please enter at least 2 characters to search.");
      return;
    }

    setIsLoading(true);
    setErrorMessage("");

    try {
      const res = await fetch(
        `${BACKEND_URL}/friends/search?userId=${encodeURIComponent(
          currentUserId
        )}&q=${encodeURIComponent(trimmed)}`
      );

      if (!res.ok) {
        throw new Error("Failed to search users");
      }

      const data: SearchUserResult[] = await res.json();
      setResults(data);
      setHasSearched(true);
    } catch (err: any) {
      console.error("Search friends error:", err);
      setErrorMessage("Couldn't search right now. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  // Debounced live search
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    if (!query.trim()) {
      setResults([]);
      setHasSearched(false);
      setErrorMessage("");
      return;
    }

    debounceTimerRef.current = setTimeout(() => {
      executeSearch(query);
    }, 350);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [query]);

  const handleManualSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    executeSearch(query);
  };

  const handleClear = () => {
    setQuery("");
    setResults([]);
    setHasSearched(false);
    setErrorMessage("");
  };

  const handleSendFriendRequest = async (targetUserId: string) => {
    setSendingRequestIds((prev) => ({ ...prev, [targetUserId]: true }));
    try {
      const res = await fetch(`${BACKEND_URL}/friends/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          senderId: currentUserId,
          receiverId: targetUserId,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.message || "Failed to send friend request");
      }

      // Update item relationship in results
      setResults((prev) =>
        prev.map((item) =>
          item.id === targetUserId
            ? { ...item, relationshipStatus: "pending_sent" }
            : item
        )
      );
      showNotification("Friend request sent!");
    } catch (err: any) {
      console.error("Send request error:", err);
      showNotification(err.message || "Could not send friend request");
    } finally {
      setSendingRequestIds((prev) => ({ ...prev, [targetUserId]: false }));
    }
  };

  const handleAcceptIncoming = async (targetUserId: string, requestId: string) => {
    setSendingRequestIds((prev) => ({ ...prev, [targetUserId]: true }));
    try {
      await onAcceptRequest(requestId);
      setResults((prev) =>
        prev.map((item) =>
          item.id === targetUserId
            ? { ...item, relationshipStatus: "friends" }
            : item
        )
      );
      showNotification("Friend request accepted!");
    } catch (err: any) {
      showNotification(err.message || "Could not accept request");
    } finally {
      setSendingRequestIds((prev) => ({ ...prev, [targetUserId]: false }));
    }
  };

  return (
    <div className="flex-1 w-full max-w-4xl mx-auto p-4 sm:p-6 overflow-y-auto">
      <div className="w-full bg-zinc-900/90 backdrop-blur-md border border-zinc-800 rounded-3xl overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-950/60">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onBack}
              className="px-3 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 hover:text-white text-xs font-semibold transition border border-zinc-700/60 flex items-center gap-1.5 active:scale-95"
            >
              <span>←</span>
              <span>Back</span>
            </button>
            <div>
              <h1 className="text-lg font-bold text-white flex items-center gap-2">
                <span>🔎</span>
                <span>Search Friends</span>
              </h1>
              <p className="text-xs text-zinc-400 mt-0.5">
                Find Chirp users worldwide by username
              </p>
            </div>
          </div>
        </div>

        {/* Search Bar Form */}
        <div className="p-6 border-b border-zinc-800/80 bg-zinc-950/40">
          <form onSubmit={handleManualSearch} className="flex gap-2.5">
            <div className="relative flex-1">
              <span className="absolute inset-y-0 left-3.5 flex items-center text-zinc-400 text-sm pointer-events-none">
                🔍
              </span>
              <input
                type="text"
                aria-label="Search friends by username"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by username (e.g. Alex, Maya)..."
                className="w-full rounded-2xl bg-zinc-950 border border-zinc-700/80 pl-10 pr-10 py-3 text-sm text-white placeholder-zinc-500 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition"
                autoFocus
              />
              {query && (
                <button
                  type="button"
                  onClick={handleClear}
                  className="absolute inset-y-0 right-3 flex items-center text-zinc-400 hover:text-white text-sm"
                  title="Clear search"
                  aria-label="Clear search"
                >
                  ✕
                </button>
              )}
            </div>

            <button
              type="submit"
              disabled={isLoading || !query.trim()}
              className="px-5 py-3 rounded-2xl bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 text-white text-sm font-semibold shadow-md shadow-indigo-900/30 transition disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 shrink-0 flex items-center gap-2"
            >
              {isLoading ? (
                <>
                  <span className="h-4 w-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  <span className="hidden sm:inline">Searching...</span>
                </>
              ) : (
                <span>Search</span>
              )}
            </button>
          </form>

          {errorMessage && (
            <div className="mt-3 p-3 rounded-xl bg-red-950/50 border border-red-800/60 text-xs text-red-300 flex items-center gap-2">
              <span>⚠️</span>
              <span>{errorMessage}</span>
            </div>
          )}
        </div>

        {/* Results Area */}
        <div className="p-6 min-h-[360px]">
          {isLoading ? (
            <div className="py-16 text-center">
              <div className="animate-spin h-8 w-8 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full mx-auto" />
              <p className="mt-4 text-xs text-zinc-400">Searching Chirp directory...</p>
            </div>
          ) : !hasSearched && !query ? (
            <div className="py-16 text-center max-w-sm mx-auto">
              <div className="w-12 h-12 rounded-2xl bg-indigo-600/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center text-2xl mx-auto mb-3">
                👥
              </div>
              <h3 className="text-sm font-bold text-white">Find People on Chirp</h3>
              <p className="text-xs text-zinc-400 mt-1.5 leading-relaxed">
                Type any username above to find friends, view their profiles, and send private chat requests.
              </p>
            </div>
          ) : results.length === 0 ? (
            <div className="py-16 text-center max-w-sm mx-auto">
              <div className="w-12 h-12 rounded-2xl bg-zinc-800/60 border border-zinc-700/60 text-zinc-400 flex items-center justify-center text-2xl mx-auto mb-3">
                🔍
              </div>
              <h3 className="text-sm font-bold text-white">No users found</h3>
              <p className="text-xs text-zinc-400 mt-1.5 leading-relaxed">
                No Chirp users matched <span className="text-indigo-400 font-semibold">"{query}"</span>. Try searching with a different spelling.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between px-1 mb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                  Search Results ({results.length})
                </span>
                <span className="text-[11px] text-zinc-500">
                  Showing matching profiles
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {results.map((user) => {
                  const isSending = !!sendingRequestIds[user.id];

                  return (
                    <div
                      key={user.id}
                      className="border border-zinc-800 bg-zinc-950/50 hover:bg-zinc-950/80 rounded-2xl p-4 flex flex-col justify-between gap-3 transition hover:border-zinc-700"
                    >
                      <div className="flex items-start gap-3">
                        <div className="relative shrink-0">
                          <div className="w-11 h-11 rounded-2xl bg-zinc-800/80 border border-zinc-700/60 flex items-center justify-center text-2xl">
                            {user.avatar || "👤"}
                          </div>
                          <span
                            className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-zinc-950 ${
                              user.isOnline ? "bg-emerald-500" : "bg-zinc-600"
                            }`}
                            title={user.isOnline ? "Online" : "Offline"}
                          />
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-bold text-white truncate">
                              {user.username || "Anonymous"}
                            </p>
                            {user.isOnline ? (
                              <span className="text-[10px] text-emerald-400 font-medium bg-emerald-950/50 px-2 py-0.5 rounded-md border border-emerald-800/40">
                                Online
                              </span>
                            ) : (
                              <span className="text-[10px] text-zinc-500">
                                Offline
                              </span>
                            )}
                          </div>

                          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-zinc-400">
                            {user.age && <span>Age: {user.age}</span>}
                            {user.gender && <span className="capitalize">{user.gender}</span>}
                            {user.language && <span>{user.language}</span>}
                          </div>

                          {user.interests && user.interests.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1">
                              {user.interests.slice(0, 3).map((interest) => (
                                <span
                                  key={interest}
                                  className="text-[10px] bg-zinc-800/90 border border-zinc-700/50 text-zinc-300 px-2 py-0.5 rounded-md"
                                >
                                  #{interest}
                                </span>
                              ))}
                              {user.interests.length > 3 && (
                                <span className="text-[10px] text-zinc-500 px-1 py-0.5">
                                  +{user.interests.length - 3}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Action buttons */}
                      <div className="flex items-center gap-2 pt-2 border-t border-zinc-800/70">
                        <button
                          type="button"
                          onClick={() => onOpenProfile(user.id)}
                          className="flex-1 py-2 px-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 hover:text-white text-xs font-semibold border border-zinc-700/60 transition flex items-center justify-center gap-1.5"
                        >
                          <span>👤</span>
                          <span>Profile</span>
                        </button>

                        {user.relationshipStatus === "friends" ? (
                          <button
                            type="button"
                            onClick={() =>
                              onOpenPrivateChat({
                                id: user.id,
                                username: user.username,
                                avatar: user.avatar,
                                isOnline: user.isOnline,
                                lastSeenAt: user.lastSeenAt,
                              })
                            }
                            className="flex-1 py-2 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-xs transition flex items-center justify-center gap-1.5"
                          >
                            <span>💬</span>
                            <span>Chat</span>
                          </button>
                        ) : user.relationshipStatus === "pending_sent" ? (
                          <button
                            type="button"
                            disabled
                            className="flex-1 py-2 px-3 rounded-xl bg-zinc-800/60 text-amber-400 border border-amber-900/40 text-xs font-semibold cursor-not-allowed flex items-center justify-center gap-1.5"
                          >
                            <span>⏳</span>
                            <span>Requested</span>
                          </button>
                        ) : user.relationshipStatus === "pending_received" && user.incomingRequestId ? (
                          <button
                            type="button"
                            disabled={isSending}
                            onClick={() => handleAcceptIncoming(user.id, user.incomingRequestId!)}
                            className="flex-1 py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-xs transition flex items-center justify-center gap-1.5"
                          >
                            <span>✓</span>
                            <span>Accept</span>
                          </button>
                        ) : user.relationshipStatus === "blocked" ? (
                          <button
                            type="button"
                            disabled
                            className="flex-1 py-2 px-3 rounded-xl bg-red-950/40 text-red-400 border border-red-900/40 text-xs font-semibold cursor-not-allowed"
                          >
                            Blocked
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={isSending}
                            onClick={() => handleSendFriendRequest(user.id)}
                            className="flex-1 py-2 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-xs transition disabled:opacity-50 flex items-center justify-center gap-1.5"
                          >
                            {isSending ? (
                              <span className="h-3.5 w-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                            ) : (
                              <>
                                <span>➕</span>
                                <span>Add Friend</span>
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
