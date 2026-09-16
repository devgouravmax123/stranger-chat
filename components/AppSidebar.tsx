"use client";

import { useState } from "react";
import { UserProfile } from "./EditProfileModal";

export type SidebarTab = "chat" | "friends" | "search-friends";

type AppSidebarProps = {
  isOpen: boolean;
  onClose: () => void;
  activeTab: SidebarTab;
  onSelectTab: (tab: SidebarTab) => void;
  userProfile: UserProfile | null;
  onOpenEditProfile: () => void;
  onStartNewChat: () => void;
  friendsCount?: number;
  pendingRequestsCount?: number;
  searchQuery: string;
  onSearchQueryChange: (q: string) => void;
  onDeleteAccount?: () => void;
};

export default function AppSidebar({
  isOpen,
  onClose,
  activeTab,
  onSelectTab,
  userProfile,
  onOpenEditProfile,
  onStartNewChat,
  friendsCount = 0,
  pendingRequestsCount = 0,
  searchQuery,
  onSearchQueryChange,
  onDeleteAccount,
}: AppSidebarProps) {
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);

  return (
    <>
      {/* Mobile Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-xs md:hidden transition-opacity"
          onClick={onClose}
        />
      )}

      {/* Sidebar Container */}
      <aside
        className={`fixed md:static inset-y-0 left-0 z-40 w-72 md:w-80 flex flex-col bg-zinc-900/95 backdrop-blur-md border-r border-zinc-800 transition-transform duration-300 ease-in-out ${
          isOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        } ${isOpen ? "md:flex" : "md:hidden"}`}
      >
        {/* Top Brand / New Chat action */}
        <div className="p-4 border-b border-zinc-800/80 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 text-white text-base font-bold shadow-md shadow-indigo-600/30">
              ⚡
            </span>
            <div className="leading-tight">
              <h2 className="text-sm font-bold text-white tracking-wide">
                Chat<span className="text-indigo-400">Buddy</span>
              </h2>
              <p className="text-[10px] text-zinc-400">Instant Stranger Chat</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onStartNewChat}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 hover:text-white text-xs font-semibold border border-zinc-700/60 transition active:scale-95"
            title="Start a new stranger search"
          >
            <span>✨</span>
            <span>New Chat</span>
          </button>
        </div>

        {/* Navigation Tabs (Chat / Friends / Search) */}
        <div className="p-3">
          <div className="grid grid-cols-3 gap-1 bg-zinc-950/80 p-1 rounded-xl border border-zinc-800">
            <button
              type="button"
              onClick={() => onSelectTab("chat")}
              className={`py-2 px-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1 transition ${
                activeTab === "chat"
                  ? "bg-zinc-800 text-white shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
              title="Stranger Chat"
            >
              <span>💬</span>
              <span>Chat</span>
            </button>

            <button
              type="button"
              onClick={() => onSelectTab("friends")}
              className={`relative py-2 px-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1 transition ${
                activeTab === "friends"
                  ? "bg-zinc-800 text-white shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
              title="Friends List & Requests"
            >
              <span>👥</span>
              <span>Friends</span>
              {pendingRequestsCount > 0 && (
                <span className="ml-0.5 px-1 py-0.2 rounded-full bg-rose-500 text-[9px] font-bold text-white leading-none">
                  {pendingRequestsCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => onSelectTab("search-friends")}
              className={`py-2 px-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1 transition ${
                activeTab === "search-friends"
                  ? "bg-indigo-600 text-white shadow-sm shadow-indigo-600/30"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
              title="Search Users by Username"
            >
              <span>🔎</span>
              <span>Search</span>
            </button>
          </div>
        </div>

        {/* Search Friends Input (Local filter when in friends tab, or click to open search view) */}
        <div className="px-3 pb-2">
          <div className="relative">
            <span className="absolute inset-y-0 left-3 flex items-center text-zinc-500 text-xs">
              🔍
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchQueryChange(e.target.value)}
              onClick={() => {
                if (activeTab !== "search-friends") {
                  onSelectTab("search-friends");
                }
              }}
              placeholder="Search users / friends..."
              className="w-full rounded-xl bg-zinc-950/90 border border-zinc-800/80 pl-8 pr-3 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500 transition"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => onSearchQueryChange("")}
                className="absolute inset-y-0 right-2.5 flex items-center text-zinc-500 hover:text-zinc-300 text-xs"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Main List Section */}
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
          {activeTab === "chat" ? (
            <div className="space-y-3">
              <div
                onClick={onStartNewChat}
                className="p-3 rounded-2xl bg-zinc-950/40 border border-zinc-800/80 hover:border-indigo-500/50 hover:bg-zinc-950/80 transition cursor-pointer group"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 flex items-center justify-center text-lg group-hover:scale-105 transition">
                    🎲
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-zinc-200 group-hover:text-white truncate">
                      Random Stranger
                    </p>
                    <p className="text-[11px] text-zinc-400 truncate">
                      Instant 1-to-1 match by interests
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl bg-zinc-950/40 border border-zinc-800/60 p-3.5 space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold text-zinc-400">
                  <span>Match Preferences</span>
                  <span className="text-[10px] text-emerald-400 font-normal">● Active</span>
                </div>
                <div className="text-[11px] text-zinc-300 space-y-1">
                  <p>
                    <span className="text-zinc-500">Language:</span>{" "}
                    {userProfile?.language || "English"}
                  </p>
                  <p>
                    <span className="text-zinc-500">Goal:</span>{" "}
                    {userProfile?.goal || "Casual Chat"}
                  </p>
                  {userProfile?.interests && userProfile.interests.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {userProfile.interests.map((it) => (
                        <span
                          key={it}
                          className="px-2 py-0.5 rounded-md bg-zinc-800/90 text-zinc-300 text-[10px]"
                        >
                          #{it}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : activeTab === "friends" ? (
            <div className="text-xs text-zinc-400 py-1">
              <div className="flex items-center justify-between px-1 mb-2 text-zinc-500 font-semibold text-[11px] uppercase tracking-wider">
                <span>Direct Connections</span>
                <span>{friendsCount}</span>
              </div>
              <p className="text-[11px] text-zinc-500 px-1">
                Select any friend from the main panel to open a 1-to-1 private chat with audio, photo, and reactions.
              </p>
            </div>
          ) : (
            <div className="text-xs text-zinc-400 py-2 space-y-2 px-1">
              <div className="p-3 rounded-2xl bg-indigo-950/30 border border-indigo-800/40 text-zinc-300">
                <p className="font-bold text-xs text-indigo-300 mb-1 flex items-center gap-1.5">
                  <span>🔎</span> Global Directory Search
                </p>
                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  Search through registered ChatBuddy users, view profiles, and send direct friend requests.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Bottom User Profile & Settings Area */}
        <div className="p-3 border-t border-zinc-800/90 bg-zinc-950/60">
          <div className="flex items-center justify-between gap-2 p-2 rounded-2xl bg-zinc-900 border border-zinc-800/80">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-zinc-800 border border-zinc-700 flex items-center justify-center text-xl shrink-0">
                {userProfile?.avatar || "🐶"}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-white truncate">
                  {userProfile?.username || "Anonymous"}
                </p>
                <p className="text-[10px] text-emerald-400 flex items-center gap-1 font-medium">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 inline-block" />
                  Free Tier
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={onOpenEditProfile}
                title="Edit Profile"
                className="h-8 px-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white text-xs font-medium border border-zinc-700/60 transition"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => setShowSettingsModal(true)}
                title="Settings"
                className="h-8 w-8 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white flex items-center justify-center text-sm border border-zinc-700/60 transition"
              >
                ⚙️
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* Settings Modal */}
      {showSettingsModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 animate-fadeIn"
          onClick={() => setShowSettingsModal(false)}
        >
          <div
            className="w-full max-w-sm bg-zinc-900 border border-zinc-800 rounded-3xl p-6 shadow-2xl text-zinc-100"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span>⚙️</span> Application Settings
              </h3>
              <button
                onClick={() => setShowSettingsModal(false)}
                className="text-zinc-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            <div className="py-4 space-y-3 text-xs text-zinc-300">
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-zinc-950 border border-zinc-800/80">
                <span>Sound Notifications</span>
                <span className="text-emerald-400 font-semibold">Enabled</span>
              </div>
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-zinc-950 border border-zinc-800/80">
                <span>Dark Theme</span>
                <span className="text-indigo-400 font-semibold">AMOLED Dark</span>
              </div>
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-zinc-950 border border-zinc-800/80">
                <span>Encryption / Storage</span>
                <span className="text-zinc-400">PostgreSQL + Redis</span>
              </div>
            </div>

            {/* Destructive Account Action */}
            <div className="pt-2 pb-4 border-t border-zinc-800">
              <button
                type="button"
                onClick={() => setShowConfirmDelete(true)}
                className="w-full py-2.5 px-3 rounded-xl bg-red-950/40 hover:bg-red-900/60 border border-red-800/50 text-xs font-semibold text-red-400 hover:text-red-300 flex items-center justify-center gap-2 transition"
              >
                <span>🗑️</span> Logout / Delete Account
              </button>
            </div>

            <button
              onClick={() => setShowSettingsModal(false)}
              className="w-full py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-white transition"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Delete Account Confirmation Modal */}
      {showConfirmDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fadeIn"
          onClick={() => setShowConfirmDelete(false)}
        >
          <div
            className="w-full max-w-sm bg-zinc-900 border border-red-900/80 rounded-3xl p-6 shadow-2xl text-zinc-100"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 pb-3 border-b border-zinc-800">
              <span className="text-2xl">⚠️</span>
              <div>
                <h3 className="text-base font-bold text-white">Delete your account?</h3>
                <p className="text-[11px] text-red-400">This action cannot be undone.</p>
              </div>
            </div>

            <div className="py-4 text-xs text-zinc-300 space-y-2 leading-relaxed">
              <p className="text-zinc-400 font-medium">This will permanently delete your:</p>
              <ul className="list-disc list-inside space-y-1 text-zinc-300 text-[11px]">
                <li>Profile & preferences</li>
                <li>Friends & friend requests</li>
                <li>Private 1-to-1 chats & messages</li>
                <li>Stranger-chat history & media</li>
                <li>Notifications & settings</li>
              </ul>
              <p className="text-[11px] text-zinc-400 pt-1">
                You will be logged out and returned to Create Profile.
              </p>
            </div>

            <div className="flex items-center gap-2 pt-2 border-t border-zinc-800">
              <button
                type="button"
                onClick={() => setShowConfirmDelete(false)}
                className="flex-1 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-white transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowConfirmDelete(false);
                  setShowSettingsModal(false);
                  onDeleteAccount?.();
                }}
                className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-xs font-semibold text-white shadow-lg shadow-red-600/30 transition"
              >
                Delete Account
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
