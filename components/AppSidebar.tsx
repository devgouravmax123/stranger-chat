"use client";

import { useState } from "react";
import { UserProfile } from "./EditProfileModal";
import { formatGoal } from "@/lib/interests";

export type SidebarTab = "chat" | "friends" | "discover" | "search-friends";

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
  onLogout?: () => void;
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
  onLogout,
  onDeleteAccount,
}: AppSidebarProps) {
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [settingsSubView, setSettingsSubView] = useState<"main" | "privacy" | "community">("main");
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
          <div className="leading-tight">
            <h2 className="text-base font-bold text-white tracking-wide">
              Chi<span className="text-indigo-400">rp</span>
            </h2>
            <p className="text-[10px] text-zinc-400">Instant Stranger Chat</p>
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

        {/* Navigation Tabs (Chat / Friends / Discover) */}
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
              onClick={() => onSelectTab("discover")}
              className={`py-2 px-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1 transition ${
                activeTab === "discover" || activeTab === "search-friends"
                  ? "bg-indigo-600 text-white shadow-sm shadow-indigo-600/30"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
              title="Discover Registered People"
            >
              <span>🌟</span>
              <span>Discover</span>
            </button>
          </div>
        </div>

        {/* Search Friends Input (Click to open Discover People) */}
        <div className="px-3 pb-2">
          <div className="relative">
            <span className="absolute inset-y-0 left-3 flex items-center text-zinc-500 text-xs">
              🔍
            </span>
            <input
              type="text"
              aria-label="Discover people"
              value={searchQuery}
              onChange={(e) => {
                onSearchQueryChange(e.target.value);
                if (activeTab !== "discover") {
                  onSelectTab("discover");
                }
              }}
              onClick={() => {
                if (activeTab !== "discover") {
                  onSelectTab("discover");
                }
              }}
              placeholder="Discover people..."
              className="w-full rounded-xl bg-zinc-950/90 border border-zinc-800/80 pl-8 pr-3 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500 transition cursor-pointer"
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

              <div className="rounded-2xl bg-zinc-950/40 border border-zinc-800/60 p-3.5 space-y-2.5">
                <div className="flex items-center justify-between text-xs font-semibold text-zinc-400">
                  <div className="flex items-center gap-1.5">
                    <span>Preferences</span>
                    <span className="text-[10px] text-emerald-400 font-normal">● Active</span>
                  </div>
                  <button
                    type="button"
                    onClick={onOpenEditProfile}
                    className="text-[10px] text-indigo-400 hover:text-indigo-300 font-medium transition cursor-pointer hover:underline"
                    title="Edit Preferences"
                  >
                    Edit
                  </button>
                </div>

                {!userProfile ? (
                  <div className="animate-pulse space-y-2 py-1">
                    <div className="h-3 bg-zinc-800/70 rounded w-1/3" />
                    <div className="h-3 bg-zinc-800/70 rounded w-2/3" />
                    <div className="h-4 bg-zinc-800/70 rounded w-1/2" />
                  </div>
                ) : (
                  <div className="text-[11px] text-zinc-300 space-y-2">
                    <p>
                      <span className="text-zinc-500">Language:</span>{" "}
                      <span className="text-zinc-200">{userProfile.language || "English"}</span>
                    </p>

                    <div>
                      <span className="text-zinc-500">Goal:</span>{" "}
                      {userProfile.goal ? (
                        <span className="text-zinc-200 font-medium">
                          {formatGoal(userProfile.goal)}
                        </span>
                      ) : (
                        <span className="text-zinc-500 italic">No goal selected</span>
                      )}
                    </div>

                    <div>
                      <span className="text-zinc-500 block mb-1">Interests:</span>
                      {userProfile.interests && userProfile.interests.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {userProfile.interests.map((it) => (
                            <span
                              key={it}
                              className="px-2 py-0.5 rounded-md bg-zinc-800/90 text-zinc-300 text-[10px] font-medium"
                            >
                              #{it}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-zinc-500 italic">No interests added</span>
                      )}
                    </div>
                  </div>
                )}
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
                  Search through registered Chirp users, view profiles, and send direct friend requests.
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
                aria-label="Edit profile details"
                className="h-8 px-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white text-xs font-medium border border-zinc-700/60 transition"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => setShowSettingsModal(true)}
                title="Settings"
                aria-label="Application settings"
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
          role="dialog"
          aria-modal="true"
          aria-labelledby="settings-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 animate-fadeIn"
          onClick={() => {
            setShowSettingsModal(false);
            setSettingsSubView("main");
          }}
        >
          <div
            className={`w-full ${
              settingsSubView === "privacy" ? "max-w-lg" : "max-w-sm"
            } bg-zinc-900 border border-zinc-800 rounded-3xl p-6 shadow-2xl text-zinc-100 transition-all`}
            onClick={(e) => e.stopPropagation()}
          >
            {settingsSubView === "main" && (
              <>
                <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
                  <h3 id="settings-modal-title" className="text-sm font-bold text-white flex items-center gap-2">
                    <span>⚙️</span> Application Settings
                  </h3>
                  <button
                    type="button"
                    onClick={() => {
                      setShowSettingsModal(false);
                      setSettingsSubView("main");
                    }}
                    aria-label="Close application settings"
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

                  {/* Navigation item to Privacy Policy */}
                  <button
                    type="button"
                    onClick={() => setSettingsSubView("privacy")}
                    className="w-full flex items-center justify-between p-2.5 rounded-xl bg-zinc-950 hover:bg-zinc-800/70 border border-zinc-800/80 text-zinc-200 hover:text-white transition group"
                  >
                    <span className="flex items-center gap-2">
                      <span>📜</span>
                      <span>Privacy Policy</span>
                    </span>
                    <span className="text-zinc-500 group-hover:text-zinc-300 font-bold text-sm">›</span>
                  </button>

                  {/* Navigation item to Community */}
                  <button
                    type="button"
                    onClick={() => setSettingsSubView("community")}
                    className="w-full flex items-center justify-between p-2.5 rounded-xl bg-zinc-950 hover:bg-zinc-800/70 border border-zinc-800/80 text-zinc-200 hover:text-white transition group"
                  >
                    <span className="flex items-center gap-2">
                      <span>🌐</span>
                      <span>Community</span>
                    </span>
                    <span className="text-zinc-500 group-hover:text-zinc-300 font-bold text-sm">›</span>
                  </button>
                </div>

                {/* Account Actions */}
                <div className="pt-2 pb-3 border-t border-zinc-800 space-y-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowSettingsModal(false);
                      onLogout?.();
                    }}
                    className="w-full py-2.5 px-3 rounded-xl bg-zinc-800 hover:bg-zinc-700/80 border border-zinc-700/60 text-xs font-semibold text-zinc-200 hover:text-white flex items-center justify-center gap-2 transition"
                  >
                    <span>🚪</span> Log Out (Switch User / Device)
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowConfirmDelete(true)}
                    className="w-full py-2.5 px-3 rounded-xl bg-red-950/40 hover:bg-red-900/60 border border-red-800/50 text-xs font-semibold text-red-400 hover:text-red-300 flex items-center justify-center gap-2 transition"
                  >
                    <span>🗑️</span> Permanently Delete Account
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setShowSettingsModal(false);
                    setSettingsSubView("main");
                  }}
                  className="w-full py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-white transition"
                >
                  Close
                </button>
              </>
            )}

            {settingsSubView === "privacy" && (
              <div className="flex flex-col max-h-[80vh]">
                <div className="flex items-center justify-between pb-3 border-b border-zinc-800 shrink-0">
                  <button
                    type="button"
                    onClick={() => setSettingsSubView("main")}
                    className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white transition font-medium"
                  >
                    <span>←</span>
                    <span>Back</span>
                  </button>
                  <h3 id="settings-modal-title" className="text-sm font-bold text-white">
                    Privacy Policy
                  </h3>
                  <button
                    type="button"
                    onClick={() => {
                      setShowSettingsModal(false);
                      setSettingsSubView("main");
                    }}
                    aria-label="Close application settings"
                    className="text-zinc-400 hover:text-white text-sm"
                  >
                    ✕
                  </button>
                </div>

                <div className="py-4 overflow-y-auto space-y-3.5 text-xs text-zinc-300 leading-relaxed pr-1 scrollbar-thin">
                  <h1 className="text-base font-bold text-white">Chirp Privacy Policy</h1>

                  <p>
                    Chirp allows users to create profiles, discover people, connect based on interests, and communicate with other users.
                  </p>

                  <div>
                    <p className="font-semibold text-zinc-200 mb-1.5">We may collect information you provide, such as:</p>
                    <ul className="list-disc list-inside space-y-1 text-zinc-400 pl-1">
                      <li>username</li>
                      <li>age</li>
                      <li>gender</li>
                      <li>avatar</li>
                      <li>interests</li>
                      <li>messages and other information you choose to share</li>
                    </ul>
                  </div>

                  <div>
                    <p className="font-semibold text-zinc-200 mb-1.5">We use this information to:</p>
                    <ul className="list-disc list-inside space-y-1 text-zinc-400 pl-1">
                      <li>create and display your profile</li>
                      <li>match you with people</li>
                      <li>provide Discover People</li>
                      <li>provide chat, friend, voice, image and video features</li>
                      <li>maintain security and prevent misuse</li>
                    </ul>
                  </div>

                  <p>Information included in your profile may be visible to other Chirp users.</p>

                  <p>
                    You are responsible for the personal information and content you choose to share with other users. Do not share passwords, financial information, government IDs, or other sensitive information with strangers.
                  </p>

                  <p>Chirp may use third-party services required to operate the platform.</p>

                  <p>You may delete your Chirp account using the account-deletion feature available in the application.</p>

                  <p>
                    By using Chirp, you understand that information you voluntarily share with another user may be outside Chirp&apos;s control once that user receives or copies it.
                  </p>

                  <div className="pt-2 border-t border-zinc-800 text-[11px] text-zinc-500 font-medium">
                    Last updated: September 19, 2026
                  </div>
                </div>

                <div className="pt-3 border-t border-zinc-800 shrink-0">
                  <button
                    type="button"
                    onClick={() => setSettingsSubView("main")}
                    className="w-full py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-white transition"
                  >
                    Back to Settings
                  </button>
                </div>
              </div>
            )}

            {settingsSubView === "community" && (
              <div className="flex flex-col">
                <div className="flex items-center justify-between pb-3 border-b border-zinc-800 shrink-0">
                  <button
                    type="button"
                    onClick={() => setSettingsSubView("main")}
                    className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white transition font-medium"
                  >
                    <span>←</span>
                    <span>Back</span>
                  </button>
                  <h3 id="settings-modal-title" className="text-sm font-bold text-white">
                    Community
                  </h3>
                  <button
                    type="button"
                    onClick={() => {
                      setShowSettingsModal(false);
                      setSettingsSubView("main");
                    }}
                    aria-label="Close application settings"
                    className="text-zinc-400 hover:text-white text-sm"
                  >
                    ✕
                  </button>
                </div>

                <div className="py-6 space-y-4 text-center">
                  <h1 className="text-base font-bold text-white">Community</h1>

                  <p className="text-xs text-zinc-300 leading-relaxed max-w-xs mx-auto">
                    Follow Chirp and stay connected with the community.
                  </p>

                  <div className="pt-2 flex justify-center">
                    <a
                      href="https://www.instagram.com/chirp_chat/"
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="Follow Chirp on Instagram"
                      className="inline-flex items-center justify-center p-3.5 rounded-2xl bg-gradient-to-tr from-amber-500 via-rose-500 to-purple-600 hover:opacity-90 transition active:scale-95 shadow-lg shadow-rose-900/30 group"
                      title="Follow Chirp on Instagram"
                    >
                      <svg
                        className="w-7 h-7 text-white"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
                        <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
                        <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
                      </svg>
                    </a>
                  </div>
                </div>

                <div className="pt-3 border-t border-zinc-800 shrink-0">
                  <button
                    type="button"
                    onClick={() => setSettingsSubView("main")}
                    className="w-full py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-white transition"
                  >
                    Back to Settings
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Delete Account Confirmation Modal */}
      {showConfirmDelete && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-account-modal-title"
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
                <h3 id="delete-account-modal-title" className="text-base font-bold text-white">Delete your account?</h3>
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
