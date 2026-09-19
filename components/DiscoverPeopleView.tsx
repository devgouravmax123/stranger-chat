"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { CANONICAL_INTERESTS } from "@/lib/interests";
import { BACKEND_URL } from "@/lib/api-config";

export type DiscoverUserResult = {
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

type DiscoverPeopleViewProps = {
  currentUserId: string;
  onBack?: () => void;
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
  searchQuery?: string;
  onSearchQueryChange?: (q: string) => void;
};

const AVAILABLE_INTERESTS = CANONICAL_INTERESTS;

const GENDER_OPTIONS = [
  { value: "any", label: "Any Gender" },
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "non-binary", label: "Non-binary" },
  { value: "prefer-not-to-say", label: "Prefer not to say" },
];

export default function DiscoverPeopleView({
  currentUserId,
  onBack,
  onOpenProfile,
  onOpenPrivateChat,
  onAcceptRequest,
  showNotification,
  searchQuery: externalSearchQuery,
  onSearchQueryChange: externalOnSearchQueryChange,
}: DiscoverPeopleViewProps) {
  // Filters state
  const [internalSearchQuery, setInternalSearchQuery] = useState("");
  const isControlledSearch = externalSearchQuery !== undefined;
  const searchQuery = isControlledSearch ? externalSearchQuery : internalSearchQuery;

  const handleSearchChange = (val: string) => {
    if (isControlledSearch && externalOnSearchQueryChange) {
      externalOnSearchQueryChange(val);
    } else {
      setInternalSearchQuery(val);
    }
  };

  const [onlineOnly, setOnlineOnly] = useState(false);
  const [genderFilter, setGenderFilter] = useState("any");
  const [selectedInterests, setSelectedInterests] = useState<string[]>([]);
  const [showFilterDrawer, setShowFilterDrawer] = useState(false);

  // Results & status state
  const [users, setUsers] = useState<DiscoverUserResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [sendingRequestIds, setSendingRequestIds] = useState<Record<string, boolean>>({});

  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch users with current filters from backend
  const fetchDiscoverUsers = useCallback(
    async (overrideSearch?: string) => {
      if (!currentUserId) return;

      setIsLoading(true);
      setErrorMessage("");

      const queryParam = typeof overrideSearch === "string" ? overrideSearch : searchQuery;
      const params = new URLSearchParams();
      params.set("userId", currentUserId);

      if (queryParam.trim()) {
        params.set("q", queryParam.trim());
      }
      if (onlineOnly) {
        params.set("onlineOnly", "true");
      }
      if (genderFilter && genderFilter !== "any") {
        params.set("gender", genderFilter);
      }
      if (selectedInterests.length > 0) {
        params.set("interests", selectedInterests.join(","));
      }

      try {
        const res = await fetch(`${BACKEND_URL}/friends/discover?${params.toString()}`);
        if (!res.ok) {
          throw new Error("Failed to discover users");
        }
        const data: DiscoverUserResult[] = await res.json();
        setUsers(data);
      } catch (err: any) {
        console.error("Error discovering users:", err);
        setErrorMessage("Could not load users right now. Please try again.");
      } finally {
        setIsLoading(false);
      }
    },
    [currentUserId, searchQuery, onlineOnly, genderFilter, selectedInterests]
  );

  // Trigger search whenever filters change (with debounce on text query)
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      fetchDiscoverUsers();
    }, 280);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [fetchDiscoverUsers]);

  // Toggle single interest
  const toggleInterest = (interest: string) => {
    setSelectedInterests((prev) =>
      prev.includes(interest) ? prev.filter((i) => i !== interest) : [...prev, interest]
    );
  };

  // Clear all filters back to default
  const handleClearFilters = () => {
    handleSearchChange("");
    setOnlineOnly(false);
    setGenderFilter("any");
    setSelectedInterests([]);
  };

  const hasActiveFilters =
    onlineOnly || genderFilter !== "any" || selectedInterests.length > 0 || !!searchQuery.trim();

  // Send Friend Request
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

      setUsers((prev) =>
        prev.map((item) =>
          item.id === targetUserId ? { ...item, relationshipStatus: "pending_sent" } : item
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

  // Accept incoming friend request
  const handleAcceptIncoming = async (targetUserId: string, requestId: string) => {
    setSendingRequestIds((prev) => ({ ...prev, [targetUserId]: true }));
    try {
      await onAcceptRequest(requestId);
      setUsers((prev) =>
        prev.map((item) =>
          item.id === targetUserId ? { ...item, relationshipStatus: "friends" } : item
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
    <div className="flex-1 w-full max-w-5xl mx-auto p-4 sm:p-6 overflow-y-auto">
      <div className="w-full bg-zinc-900/90 backdrop-blur-md border border-zinc-800 rounded-3xl overflow-hidden shadow-2xl">
        {/* TOP BAR */}
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-zinc-800 bg-zinc-950/60">
          <div className="flex items-center gap-3">
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                className="px-3 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 hover:text-white text-xs font-semibold transition border border-zinc-700/60 flex items-center gap-1.5 active:scale-95"
              >
                <span>←</span>
                <span>Back</span>
              </button>
            )}
            <div>
              <h1 className="text-lg font-bold text-white flex items-center gap-2">
                <span>🌟</span>
                <span>Discover People</span>
              </h1>
              <p className="text-xs text-zinc-400 mt-0.5">
                Connect with real Chirp members, browse profiles, and build lasting friendships
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowFilterDrawer((prev) => !prev)}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold border transition flex items-center gap-2 ${
              hasActiveFilters
                ? "bg-indigo-600/20 text-indigo-300 border-indigo-500/40"
                : "bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border-zinc-700/60"
            }`}
          >
            <span>⚙️</span>
            <span>Filters</span>
            {hasActiveFilters && (
              <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse inline-block" />
            )}
            <span className="text-[10px]">{showFilterDrawer ? "▲" : "▼"}</span>
          </button>
        </div>

        {/* SEARCH & FILTERS CONTROLS */}
        <div className="p-4 sm:p-6 border-b border-zinc-800/80 bg-zinc-950/40 space-y-4">
          {/* Main search bar */}
          <div className="relative">
            <span className="absolute inset-y-0 left-3.5 flex items-center text-zinc-400 text-sm pointer-events-none">
              🔍
            </span>
            <input
              type="text"
              aria-label="Search members by username"
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="Search by username..."
              className="w-full rounded-2xl bg-zinc-950 border border-zinc-700/80 pl-10 pr-10 py-3 text-sm text-white placeholder-zinc-500 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => handleSearchChange("")}
                className="absolute inset-y-0 right-3 flex items-center text-zinc-400 hover:text-white text-sm"
                title="Clear search"
                aria-label="Clear search"
              >
                ✕
              </button>
            )}
          </div>

          {/* Quick filter chips / Toggle controls */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div className="flex flex-wrap items-center gap-2">
              {/* Online Only Toggle */}
              <button
                type="button"
                onClick={() => setOnlineOnly((prev) => !prev)}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold border transition flex items-center gap-2 ${
                  onlineOnly
                    ? "bg-emerald-950/70 border-emerald-500/60 text-emerald-300 shadow-sm shadow-emerald-950"
                    : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    onlineOnly ? "bg-emerald-400 animate-pulse" : "bg-zinc-600"
                  }`}
                />
                <span>Online only</span>
              </button>

              {/* Gender selector */}
              <select
                aria-label="Filter by gender"
                value={genderFilter}
                onChange={(e) => setGenderFilter(e.target.value)}
                className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-zinc-900 border border-zinc-800 text-zinc-200 outline-none focus:border-indigo-500 transition cursor-pointer"
              >
                {GENDER_OPTIONS.map((g) => (
                  <option key={g.value} value={g.value}>
                    {g.label}
                  </option>
                ))}
              </select>

              {/* Interests count indicator */}
              {selectedInterests.length > 0 && (
                <span className="px-2.5 py-1 rounded-xl bg-indigo-950/60 border border-indigo-800/60 text-indigo-300 text-xs font-medium">
                  Interests: {selectedInterests.length} selected
                </span>
              )}
            </div>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={handleClearFilters}
                className="text-xs font-medium text-zinc-400 hover:text-rose-400 transition flex items-center gap-1"
              >
                <span>✕</span>
                <span>Clear Filters</span>
              </button>
            )}
          </div>

          {/* EXPANDABLE INTERESTS PANEL */}
          {showFilterDrawer && (
            <div className="p-4 rounded-2xl bg-zinc-950/80 border border-zinc-800/80 space-y-2.5 animate-fadeIn">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  Filter by Interests
                </span>
                {selectedInterests.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelectedInterests([])}
                    className="text-[11px] text-zinc-500 hover:text-zinc-300"
                  >
                    Reset interests
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {AVAILABLE_INTERESTS.map((interest) => {
                  const isSelected = selectedInterests.includes(interest);
                  return (
                    <button
                      key={interest}
                      type="button"
                      onClick={() => toggleInterest(interest)}
                      className={`px-3 py-1 rounded-xl text-xs font-semibold border transition active:scale-95 ${
                        isSelected
                          ? "bg-indigo-600 text-white border-indigo-500 shadow-xs shadow-indigo-600/30"
                          : "bg-zinc-900 text-zinc-400 border-zinc-800 hover:border-zinc-700 hover:text-zinc-200"
                      }`}
                    >
                      #{interest}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {errorMessage && (
            <div className="p-3 rounded-xl bg-red-950/50 border border-red-800/60 text-xs text-red-300 flex items-center gap-2">
              <span>⚠️</span>
              <span>{errorMessage}</span>
            </div>
          )}
        </div>

        {/* RESULTS GRID AREA */}
        <div className="p-4 sm:p-6 min-h-[380px]">
          {isLoading ? (
            <div className="py-20 text-center">
              <div className="animate-spin h-8 w-8 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full mx-auto" />
              <p className="mt-4 text-xs text-zinc-400">Discovering Chirp users...</p>
            </div>
          ) : users.length === 0 ? (
            <div className="py-16 text-center max-w-sm mx-auto">
              <div className="w-12 h-12 rounded-2xl bg-zinc-800/60 border border-zinc-700/60 text-zinc-400 flex items-center justify-center text-2xl mx-auto mb-3">
                👥
              </div>
              <h3 className="text-sm font-bold text-white">No people found</h3>
              <p className="text-xs text-zinc-400 mt-1.5 leading-relaxed">
                {searchQuery.trim()
                  ? `No members found matching "${searchQuery.trim()}". Try checking the username or loosening active filters.`
                  : "No people match your current filters. Try loosening your filters to discover more people on Chirp."}
              </p>
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={handleClearFilters}
                  className="mt-4 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition active:scale-95"
                >
                  Clear Filters
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between px-1 mb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                  Registered Members ({users.length})
                </span>
                <span className="text-[11px] text-zinc-500">
                  Real users on Chirp
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {users.map((user) => {
                  const isSending = !!sendingRequestIds[user.id];

                  return (
                    <div
                      key={user.id}
                      className="border border-zinc-800 bg-zinc-950/50 hover:bg-zinc-950/80 rounded-2xl p-4 flex flex-col justify-between gap-3 transition hover:border-zinc-700/90 shadow-sm"
                    >
                      <div className="flex items-start gap-3.5">
                        {/* Avatar + Live Presence indicator */}
                        <div className="relative shrink-0">
                          <div className="w-12 h-12 rounded-2xl bg-zinc-800/90 border border-zinc-700/60 flex items-center justify-center text-2xl shadow-inner">
                            {user.avatar || "👤"}
                          </div>
                          <span
                            className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-zinc-950 ${
                              user.isOnline ? "bg-emerald-500 animate-pulse" : "bg-zinc-600"
                            }`}
                            title={user.isOnline ? "Online right now" : "Offline"}
                          />
                        </div>

                        {/* User details */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-bold text-white truncate">
                              {user.username || "Anonymous"}
                            </p>
                            {user.isOnline ? (
                              <span className="text-[10px] text-emerald-400 font-medium bg-emerald-950/60 px-2 py-0.5 rounded-md border border-emerald-800/40">
                                🟢 Online
                              </span>
                            ) : (
                              <span className="text-[10px] text-zinc-500">
                                ⚪ Offline
                              </span>
                            )}
                          </div>

                          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-zinc-400">
                            {user.gender && <span className="capitalize">{user.gender}</span>}
                            {user.age && <span>Age {user.age}</span>}
                            {user.language && <span>{user.language}</span>}
                          </div>

                          {/* Interest tags */}
                          {user.interests && user.interests.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1">
                              {user.interests.slice(0, 3).map((interest) => (
                                <span
                                  key={interest}
                                  className="text-[10px] bg-zinc-800/80 border border-zinc-700/50 text-zinc-300 px-2 py-0.5 rounded-md"
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
                        {/* View Profile */}
                        <button
                          type="button"
                          onClick={() => onOpenProfile(user.id)}
                          className="flex-1 py-2 px-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 hover:text-white text-xs font-semibold border border-zinc-700/60 transition flex items-center justify-center gap-1.5 active:scale-95"
                        >
                          <span>👤</span>
                          <span>View Profile</span>
                        </button>

                        {/* Relationship state button */}
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
                            className="flex-1 py-2 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-xs transition flex items-center justify-center gap-1.5 active:scale-95"
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
                            <span>Request Sent</span>
                          </button>
                        ) : user.relationshipStatus === "pending_received" && user.incomingRequestId ? (
                          <button
                            type="button"
                            disabled={isSending}
                            onClick={() => handleAcceptIncoming(user.id, user.incomingRequestId!)}
                            className="flex-1 py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-xs transition flex items-center justify-center gap-1.5 active:scale-95"
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
                            className="flex-1 py-2 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-xs transition disabled:opacity-50 flex items-center justify-center gap-1.5 active:scale-95"
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
