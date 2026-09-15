"use client";

import { useState } from "react";
import NotificationDropdown, { AppNotification } from "./NotificationDropdown";

type AppHeaderProps = {
  onToggleSidebar: () => void;
  onNewChat: () => void;
  onOpenProfile: () => void;
  currentUsername?: string | null;
  currentAvatar?: string | null;
  unreadNotificationsCount?: number;
  notifications?: AppNotification[];
  onMarkNotificationAsRead?: (id: string) => void;
  onMarkAllNotificationsAsRead?: () => void;
  onSelectNotification?: (notification: AppNotification) => void;
};

export default function AppHeader({
  onToggleSidebar,
  onNewChat,
  onOpenProfile,
  currentUsername,
  currentAvatar,
  unreadNotificationsCount = 0,
  notifications = [],
  onMarkNotificationAsRead,
  onMarkAllNotificationsAsRead,
  onSelectNotification,
}: AppHeaderProps) {
  const [isNotificationOpen, setIsNotificationOpen] = useState(false);

  return (
    <header className="h-14 border-b border-zinc-800/80 bg-zinc-900/90 backdrop-blur-md px-4 flex items-center justify-between z-30 shrink-0 select-none">
      {/* Left: Hamburger & New Chat */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onToggleSidebar}
          aria-label="Toggle Sidebar Navigation"
          className="h-9 w-9 rounded-xl bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 hover:text-white flex items-center justify-center transition active:scale-95 border border-zinc-700/50"
        >
          <span className="text-lg leading-none font-mono">☰</span>
        </button>

        <button
          type="button"
          onClick={onNewChat}
          className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 text-white text-xs font-semibold shadow-md shadow-indigo-900/30 transition active:scale-95"
        >
          <span>✨</span>
          <span className="hidden sm:inline font-bold">New Chat</span>
        </button>
      </div>

      {/* Center title for mobile */}
      <div className="flex items-center gap-2 md:hidden">
        <span className="text-xs font-bold tracking-tight text-white">
          Chat<span className="text-indigo-400">Buddy</span>
        </span>
      </div>

      {/* Right: Icons (Profile, Notifications, Status) */}
      <div className="flex items-center gap-2">
        {/* Profile Button */}
        <button
          type="button"
          onClick={onOpenProfile}
          className="flex items-center gap-2 pl-2 pr-3 py-1 rounded-xl bg-zinc-800/80 hover:bg-zinc-700 border border-zinc-700/50 text-xs text-zinc-200 transition"
          title="View profile details"
        >
          <span className="text-base">{currentAvatar || "👤"}</span>
          <span className="font-semibold max-w-[100px] truncate hidden sm:inline">
            {currentUsername || "Profile"}
          </span>
        </button>

        {/* Notifications Icon with count */}
        <div className="relative">
          <button
            type="button"
            data-notification-trigger="true"
            onClick={() => setIsNotificationOpen((prev) => !prev)}
            className="h-9 w-9 rounded-xl bg-zinc-800/80 hover:bg-zinc-700 border border-zinc-700/50 text-zinc-300 hover:text-white flex items-center justify-center text-sm transition relative"
            title="Notifications"
          >
            🔔
          </button>
          {unreadNotificationsCount > 0 && (
            <span className="absolute -top-1 -right-1 h-4 min-w-4 px-1 rounded-full bg-indigo-500 text-white text-[9px] font-bold flex items-center justify-center pointer-events-none">
              {unreadNotificationsCount}
            </span>
          )}

          {/* Notification Dropdown Panel */}
          <NotificationDropdown
            isOpen={isNotificationOpen}
            onClose={() => setIsNotificationOpen(false)}
            notifications={notifications}
            unreadCount={unreadNotificationsCount}
            onMarkAsRead={(id) => onMarkNotificationAsRead?.(id)}
            onMarkAllAsRead={() => onMarkAllNotificationsAsRead?.()}
            onSelectNotification={(n) => {
              setIsNotificationOpen(false);
              onSelectNotification?.(n);
            }}
          />
        </div>

        {/* Realtime Status Indicator */}
        <div
          className="h-9 px-2.5 rounded-xl bg-zinc-800/80 border border-zinc-700/50 text-zinc-300 flex items-center gap-1.5 text-xs font-medium"
          title="Server and Real-time Gateway status"
        >
          <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-[11px] text-zinc-400 hidden sm:inline">Online</span>
        </div>
      </div>
    </header>
  );
}
