"use client";

import { useEffect, useRef } from "react";

export type AppNotification = {
  id: string;
  type: string;
  title: string;
  body: string;
  data?: string | null;
  isRead: boolean;
  createdAt: string;
};

type NotificationDropdownProps = {
  isOpen: boolean;
  onClose: () => void;
  notifications: AppNotification[];
  unreadCount: number;
  onMarkAsRead: (id: string) => void;
  onMarkAllAsRead: () => void;
  onSelectNotification: (notification: AppNotification) => void;
};

export default function NotificationDropdown({
  isOpen,
  onClose,
  notifications,
  unreadCount,
  onMarkAsRead,
  onMarkAllAsRead,
  onSelectNotification,
}: NotificationDropdownProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("[data-notification-trigger]")) {
        return;
      }
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      ref={panelRef}
      className="absolute right-0 top-12 w-80 sm:w-96 rounded-2xl bg-zinc-900 border border-zinc-700/70 shadow-2xl overflow-hidden z-50 animate-fadeIn text-zinc-100"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 bg-zinc-950/60">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-white">Notifications</span>
          {unreadCount > 0 && (
            <span className="px-1.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-400 text-[10px] font-bold border border-indigo-500/30">
              {unreadCount} new
            </span>
          )}
        </div>
        {unreadCount > 0 && (
          <button
            type="button"
            onClick={onMarkAllAsRead}
            className="text-[11px] font-medium text-indigo-400 hover:text-indigo-300 transition"
          >
            Mark all as read
          </button>
        )}
      </div>

      {/* Notification List */}
      <div className="max-h-[360px] overflow-y-auto divide-y divide-zinc-800/60">
        {notifications.length === 0 ? (
          <div className="py-10 text-center px-4">
            <span className="text-2xl block mb-1">🔔</span>
            <p className="text-xs text-zinc-400">No notifications yet</p>
            <p className="text-[11px] text-zinc-400 mt-1">
              Friend requests and messages will appear here.
            </p>
          </div>
        ) : (
          notifications.map((n) => {
            const isFriendReq = n.type === "FRIEND_REQUEST";
            const isFriendAcc = n.type === "FRIEND_ACCEPTED";

            return (
              <div
                key={n.id}
                onClick={() => {
                  if (!n.isRead) onMarkAsRead(n.id);
                  onSelectNotification(n);
                }}
                className={`px-4 py-3 cursor-pointer transition flex items-start gap-3 hover:bg-zinc-800/50 ${
                  !n.isRead ? "bg-indigo-950/20" : ""
                }`}
              >
                {/* Icon */}
                <div
                  className={`h-8 w-8 rounded-xl flex items-center justify-center text-sm shrink-0 mt-0.5 border ${
                    isFriendReq
                      ? "bg-amber-500/10 border-amber-500/30 text-amber-400"
                      : isFriendAcc
                      ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                      : "bg-indigo-500/10 border-indigo-500/30 text-indigo-400"
                  }`}
                >
                  {isFriendReq ? "🤝" : isFriendAcc ? "🎉" : "💬"}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <p
                      className={`text-xs font-semibold truncate ${
                        !n.isRead ? "text-white" : "text-zinc-300"
                      }`}
                    >
                      {n.title}
                    </p>
                    <span className="text-[10px] text-zinc-500 shrink-0">
                      {new Date(n.createdAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-400 line-clamp-2 mt-0.5">
                    {n.body}
                  </p>
                </div>

                {/* Unread indicator dot */}
                {!n.isRead && (
                  <span className="h-2 w-2 rounded-full bg-indigo-500 shrink-0 mt-2" />
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
