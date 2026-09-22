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
  onOpenNotifications?: () => void;
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
  onOpenNotifications,
}: AppHeaderProps) {
  const [isNotificationOpen, setIsNotificationOpen] = useState(false);

  const handleToggleNotifications = () => {
    const nextState = !isNotificationOpen;
    setIsNotificationOpen(nextState);
    if (nextState) {
      onOpenNotifications?.();
    }
  };

  return (
    <header className="h-14 border-b border-zinc-800/80 bg-zinc-900/90 backdrop-blur-md px-3 sm:px-4 flex items-center justify-between z-30 shrink-0 select-none">
      {/* Left: Hamburger, Brand & New Chat */}
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        <button
          type="button"
          onClick={onToggleSidebar}
          aria-label="Toggle Sidebar Navigation"
          className="h-9 w-9 shrink-0 rounded-xl bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 hover:text-white flex items-center justify-center transition active:scale-95 border border-zinc-700/50"
        >
          <span className="text-lg leading-none font-mono">☰</span>
        </button>

        <div className="flex items-center shrink-0">
          <span className="text-base font-bold tracking-tight text-white inline">
            Chi<span className="text-indigo-400">rp</span>
          </span>
        </div>

        <button
          type="button"
          onClick={onNewChat}
          className="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1.5 rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 text-white text-xs font-semibold shadow-md shadow-indigo-900/30 transition active:scale-95 shrink-0"
        >
          <span>✨</span>
          <span className="hidden sm:inline font-bold">New Chat</span>
        </button>
      </div>

      {/* Right: Icons (Profile, Notifications, Status) */}
      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        {/* Profile Button */}
        <button
          type="button"
          onClick={onOpenProfile}
          aria-label="View profile details"
          title="View profile details"
          className="flex items-center gap-1.5 sm:gap-2 px-2 sm:pl-2 sm:pr-3 py-1 rounded-xl bg-zinc-800/80 hover:bg-zinc-700 border border-zinc-700/50 text-xs text-zinc-200 transition"
        >
          <span className="text-base leading-none">{currentAvatar || "👤"}</span>
          <span className="font-semibold max-w-[80px] sm:max-w-[100px] truncate hidden md:inline">
            {currentUsername || "Profile"}
          </span>
        </button>

        {/* Notifications Icon with count */}
        <div className="relative">
          <button
            type="button"
            data-notification-trigger="true"
            onClick={handleToggleNotifications}
            aria-label={
              unreadNotificationsCount > 0
                ? `Notifications (${unreadNotificationsCount} unread)`
                : "Notifications"
            }
            aria-expanded={isNotificationOpen}
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
          className="h-9 px-2 sm:px-2.5 rounded-xl bg-zinc-800/80 border border-zinc-700/50 text-zinc-300 flex items-center gap-1.5 text-xs font-medium"
          title="Server and Real-time Gateway status"
        >
          <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-[11px] text-zinc-400 hidden sm:inline">Online</span>
        </div>
      </div>
    </header>
  );
}
