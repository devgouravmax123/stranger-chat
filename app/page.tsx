"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { io, Socket } from "socket.io-client";

import ChatHeader from "@/components/ChatHeader";
import MessageInput from "@/components/MessageInput";
import MessageList, { Message } from "@/components/MessageList";
import ProfileSetup from "@/components/ProfileSetup";
import UserProfileModal from "@/components/UserProfileModal";
import ReportModal from "@/components/ReportModal";
import AppHeader from "@/components/AppHeader";
import AppSidebar, { SidebarTab } from "@/components/AppSidebar";
import EditProfileModal, { UserProfile } from "@/components/EditProfileModal";
import { AppNotification } from "@/components/NotificationDropdown";
import AiSuggestions from "@/components/AiSuggestions";
import GalaxyBackground from "@/components/GalaxyBackground";
import SearchFriendsView from "@/components/SearchFriendsView";
import DiscoverPeopleView from "@/components/DiscoverPeopleView";
import IncomingCallModal from "@/components/IncomingCallModal";
import CallingModal from "@/components/CallingModal";
import VideoCallOverlay from "@/components/VideoCallOverlay";
import { useVideoCall } from "@/hooks/useVideoCall";

// ==========================================
// NAVIGATION & VIEW TYPES
// ==========================================

export type AppView =
  | "profile-setup"
  | "matching"
  | "stranger-chat"
  | "friends"
  | "discover"
  | "search-friends"
  | "friend-chat";

type MatchPreferences = {
  language: string;
  interests: string[];
  goal: string;
};

type MatchedData = {
  roomId: string;
  userId: string;
  strangerUserId: string;
  score: number;
};

type UserReadyData = {
  userId: string;
};

// ==========================================
// FRIEND TYPES
// ==========================================

type Friend = {
  id: string;
  username: string | null;
  age: number | null;
  gender: string | null;
  avatar: string | null;
  lastSeenAt?: string | null;
  isOnline?: boolean;
};

type Friendship = {
  friendshipId: string;
  createdAt: string;
  friend: Friend;
};

type FriendRequest = {
  id: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  senderId: string;
  receiverId: string;
  sender: Friend;
};

type FriendRoomMessage = {
  id: string;
  content: string;
  senderId: string;
  chatId: string;
  createdAt: string;
  status?: "sending" | "sent" | "delivered" | "seen";
  replyTo?: {
    id: string;
    text: string;
    type?: "text" | "audio" | "image";
  } | null;
  deletedAt?: string | null;
};

type FriendRoomOpenedData = {
  roomId: string;
  friendId: string;
  messages: FriendRoomMessage[];
};


function formatLastSeen(timestamp: string): string {
  try {
    const d = new Date(timestamp);
    const diffMs = Date.now() - d.getTime();
    if (diffMs < 60000) return "just now";
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return d.toLocaleDateString();
  } catch {
    return "recently";
  }
}

export default function Home() {
  // ==========================================
  // CORE STATE
  // ==========================================

  const [socket, setSocket] = useState<Socket | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const userIdRef = useRef<string | null>(null);
  const [sessionKey, setSessionKey] = useState(0);

  const [currentView, setCurrentView] = useState<AppView>("profile-setup");
  const [profileCompleted, setProfileCompleted] = useState(false);
  const [checkingProfile, setCheckingProfile] = useState(true);

  // Global user profile state (single source of truth)
  const [currentUserProfile, setCurrentUserProfile] = useState<UserProfile | null>(null);

  // Layout states: Sidebar & Edit Profile Modal
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isEditProfileOpen, setIsEditProfileOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Match preferences
  const [language, setLanguage] = useState("English");
  const [interests, setInterests] = useState<string[]>([]);
  const [goal, setGoal] = useState("casual-chat");

  const availableInterests = [
    "Coding",
    "Gaming",
    "Music",
    "Movies",
    "Sports",
    "Travel",
  ];

  // ==========================================
  // STRANGER CHAT STATE
  // ==========================================

  const [waiting, setWaiting] = useState(false);
  const [matchingMode, setMatchingMode] = useState<"idle" | "searching" | "no-one-live" | "keep-waiting">("idle");
  const [searchElapsedSeconds, setSearchElapsedSeconds] = useState(0);
  const searchTimerRef = useRef<NodeJS.Timeout | null>(null);
  const noLiveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const [strangerRoomId, setStrangerRoomId] = useState<string | null>(null);
  const [strangerUserId, setStrangerUserId] = useState<string | null>(null);
  const [matchScore, setMatchScore] = useState<number | null>(null);
  const [strangerStatus, setStrangerStatus] = useState<
    "online" | "disconnected" | "connecting"
  >("connecting");
  const [strangerTyping, setStrangerTyping] = useState(false);

  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);

  // Stranger friend request state
  const [friendRequestSent, setFriendRequestSent] = useState(false);
  const [friendRequestMessage, setFriendRequestMessage] = useState("");

  // Safety & Modals
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [viewProfile, setViewProfile] = useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [notification, setNotification] = useState<string | null>(null);

  // ==========================================
  // FRIENDS & PRIVATE CHAT STATE
  // ==========================================

  const [friends, setFriends] = useState<Friendship[]>([]);
  const [friendRequests, setFriendRequests] = useState<FriendRequest[]>([]);
  const [friendsLoading, setFriendsLoading] = useState(false);
  const [friendsError, setFriendsError] = useState("");

  const [selectedFriend, setSelectedFriend] = useState<Friend | null>(null);
  const [friendRoomId, setFriendRoomId] = useState<string | null>(null);
  const [friendChatId, setFriendChatId] = useState<string | null>(null);
  const [friendMessages, setFriendMessages] = useState<Message[]>([]);
  const [friendMessage, setFriendMessage] = useState("");
  const [friendChatLoading, setFriendChatLoading] = useState(false);
  const [friendReplyingTo, setFriendReplyingTo] = useState<Message | null>(null);

  // In-App Notifications state
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadNotificationsCount, setUnreadNotificationsCount] = useState(0);

  const selectedFriendRef = useRef<Friend | null>(null);
  selectedFriendRef.current = selectedFriend;

  const currentViewRef = useRef<AppView>(currentView);
  currentViewRef.current = currentView;

  const friendRoomIdRef = useRef<string | null>(null);
  friendRoomIdRef.current = friendRoomId;

  const friendChatIdRef = useRef<string | null>(null);
  friendChatIdRef.current = friendChatId;

  const strangerRoomIdRef = useRef<string | null>(null);
  strangerRoomIdRef.current = strangerRoomId;

  // ==========================================
  // NOTIFICATION BANNER
  // ==========================================

  const showNotification = useCallback((msg: string) => {
    setNotification(msg);
    setTimeout(() => {
      setNotification((prev) => (prev === msg ? null : prev));
    }, 4000);
  }, []);

  // ==========================================
  // WEBRTC VIDEO CHAT HOOK & DRAWER STATE
  // ==========================================

  const videoCall = useVideoCall({
    socket,
    roomId: strangerRoomId,
    userId,
    strangerUserId,
    onNotification: showNotification,
  });

  const [isVideoChatOpen, setIsVideoChatOpen] = useState(false);
  const [unreadVideoChatCount, setUnreadVideoChatCount] = useState(0);
  const isVideoChatOpenRef = useRef(false);
  isVideoChatOpenRef.current = isVideoChatOpen;
  const isVideoCallActiveRef = useRef(false);
  isVideoCallActiveRef.current = videoCall.callState === "connecting" || videoCall.callState === "connected";

  // Friend Private Chat Video Call
  const friendVideoCall = useVideoCall({
    socket,
    roomId: friendRoomId,
    userId,
    strangerUserId: selectedFriend?.id || null,
    onNotification: showNotification,
  });

  const [isFriendVideoChatOpen, setIsFriendVideoChatOpen] = useState(false);
  const [unreadFriendVideoChatCount, setUnreadFriendVideoChatCount] = useState(0);
  const isFriendVideoChatOpenRef = useRef(false);
  isFriendVideoChatOpenRef.current = isFriendVideoChatOpen;
  const isFriendVideoCallActiveRef = useRef(false);
  isFriendVideoCallActiveRef.current = friendVideoCall.callState === "connecting" || friendVideoCall.callState === "connected";

  const [globalIncomingFriendCall, setGlobalIncomingFriendCall] = useState<{
    roomId: string;
    callId: string;
    callerUserId: string;
    callerName: string;
    callerAvatar: string;
  } | null>(null);

  // ==========================================
  // BROWSER HISTORY & NAVIGATION MANAGEMENT
  // ==========================================

  const navigateTo = useCallback(
    (view: AppView, pushToHistory = true) => {
      // If leaving stranger chat or friend chat, safely tear down any active video calls
      if (view !== "stranger-chat") {
        videoCall.teardownCall();
      }
      if (view !== "friend-chat") {
        friendVideoCall.teardownCall();
      }
      setCurrentView(view);
      if (typeof window !== "undefined" && pushToHistory) {
        window.history.pushState({ view }, "", `?view=${view}`);
      }
    },
    [videoCall, friendVideoCall]
  );

  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      if (event.state && event.state.view) {
        const targetView = event.state.view as AppView;
        if (currentView === "stranger-chat" && targetView !== "stranger-chat") {
          // Leaving stranger chat via browser back
          videoCall.teardownCall();
          if (socket) {
            socket.emit("end_chat");
          }
          setMessages([]);
          setReplyingTo(null);
          setStrangerTyping(false);
          setStrangerUserId(null);
          setWaiting(false);
        } else if (currentView === "friend-chat" && targetView !== "friend-chat") {
          // Leaving friend chat via browser back
          friendVideoCall.teardownCall();
          setIsFriendVideoChatOpen(false);
          setUnreadFriendVideoChatCount(0);
          if (socket && friendRoomId) {
            socket.emit("leave_friend_room", { roomId: friendRoomId });
          }
          setFriendRoomId(null);
          setSelectedFriend(null);
          setFriendMessages([]);
          setFriendReplyingTo(null);
        }
        setCurrentView(targetView);
      } else {
        setCurrentView("matching");
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [currentView, socket, friendRoomId]);

  // ==========================================
  // SOCKET INITIALIZATION & LIFECYCLE
  // ==========================================

  useEffect(() => {
    // Use sessionStorage per tab so multiple tabs have distinct identities for testing/chatting,
    // while falling back to localStorage if available.
    let savedUserId: string | null = null;
    if (typeof window !== "undefined") {
      savedUserId = sessionStorage.getItem("sc_user_id");
      if (!savedUserId) {
        // If there's a stored ID in localStorage, only borrow it if not already in use in another tab,
        // or generate fresh per-tab session
        savedUserId = sessionStorage.getItem("sc_session_user_id");
      }
    }

    const newSocket = io("http://localhost:3001", {
      auth: { userId: savedUserId },
    });

    setSocket(newSocket);

    // ==========================================
    // USER READY & SESSION
    // ==========================================

    newSocket.on("user_ready", async (data: UserReadyData) => {
      setUserId(data.userId);
      userIdRef.current = data.userId;
      if (typeof window !== "undefined") {
        sessionStorage.setItem("sc_user_id", data.userId);
        sessionStorage.setItem("sc_session_user_id", data.userId);
      }
      newSocket.emit("friend_online", { userId: data.userId });

      // Load persistent notifications for user
      try {
        const [resNotifs, resCount] = await Promise.all([
          fetch(`http://localhost:3001/notifications/${data.userId}`),
          fetch(`http://localhost:3001/notifications/${data.userId}/unread-count`),
        ]);
        if (resNotifs.ok) {
          const notifs = await resNotifs.json();
          setNotifications(notifs);
        }
        if (resCount.ok) {
          const countData = await resCount.json();
          setUnreadNotificationsCount(countData.count || 0);
        }
      } catch (err) {
        console.warn("Could not initial load notifications:", err);
      }

      // Check if user already has a completed profile in DB
      try {
        const res = await fetch(`http://localhost:3001/users/${data.userId}/profile`);
        if (res.ok) {
          const profile = await res.json();
          if (profile && profile.username) {
            setCurrentUserProfile(profile);
            setProfileCompleted(true);
            setCurrentView("matching");
            if (profile.language) setLanguage(profile.language);
            if (profile.interests && Array.isArray(profile.interests)) setInterests(profile.interests);
            if (profile.goal) setGoal(profile.goal);
          } else {
            setProfileCompleted(false);
          }
        } else {
          setProfileCompleted(false);
        }
      } catch (e) {
        console.warn("Could not check existing profile:", e);
        setProfileCompleted(false);
      } finally {
        setCheckingProfile(false);
      }
    });

    // ==========================================
    // STRANGER MATCHING
    // ==========================================

    newSocket.on("waiting", () => {
      setWaiting(true);
      navigateTo("matching", false);
    });

    newSocket.on("matched", (data: MatchedData) => {
      // Clear timers
      if (noLiveTimeoutRef.current) {
        clearTimeout(noLiveTimeoutRef.current);
        noLiveTimeoutRef.current = null;
      }
      if (searchTimerRef.current) {
        clearInterval(searchTimerRef.current);
        searchTimerRef.current = null;
      }
      setMatchingMode("idle");
      setSearchElapsedSeconds(0);
      setWaiting(false);
      setUserId(data.userId);
      userIdRef.current = data.userId;
      setStrangerRoomId(data.roomId);
      setStrangerUserId(data.strangerUserId);
      setMatchScore(data.score);
      setStrangerStatus("online");
      setStrangerTyping(false);
      setFriendRequestSent(false);
      setFriendRequestMessage("");
      setMessages([]);
      setReplyingTo(null);
      navigateTo("stranger-chat");
    });

    newSocket.on("chat_history", (data: { messages: any[]; userId: string }) => {
      const currentUserId = userIdRef.current || data.userId;
      if (Array.isArray(data?.messages)) {
        const history: Message[] = data.messages.map((item: any) => ({
          id: item.id,
          text: item.text || "",
          sender: item.sender || (item.senderId === currentUserId ? "me" : "stranger"),
          timestamp: typeof item.createdAt === "string" ? new Date(item.createdAt).getTime() : (item.createdAt ? new Date(item.createdAt).getTime() : (item.timestamp || Date.now())),
          type: item.type || "text",
          audioUrl: item.audioUrl,
          imageUrl: item.imageUrl,
          status: item.status || "delivered",
          replyTo: item.replyTo,
          deletedAt: item.deletedAt,
          reactions: item.reactions || [],
        }));
        setMessages(history);

        const unreadStranger = history
          .filter((m) => m.sender === "stranger" && m.id && m.status !== "seen")
          .map((m) => m.id as string);
        if (unreadStranger.length > 0) {
          newSocket.emit("mark_seen", {
            roomId: strangerRoomIdRef.current || undefined,
            messageIds: unreadStranger,
          });
        }
      }
    });

    newSocket.on("friend_status_changed", (data: { userId: string; isOnline: boolean; lastSeenAt?: string }) => {
      setFriends((prev) =>
        prev.map((f) => {
          if (f.friend?.id === data.userId) {
            return {
              ...f,
              friend: {
                ...f.friend,
                isOnline: data.isOnline,
                lastSeenAt: data.lastSeenAt || f.friend.lastSeenAt,
              },
            };
          }
          return f;
        })
      );
      setSelectedFriend((prev) => {
        if (prev && prev.id === data.userId) {
          return {
            ...prev,
            isOnline: data.isOnline,
            lastSeenAt: data.lastSeenAt || prev.lastSeenAt,
          };
        }
        return prev;
      });
    });

    newSocket.on("stranger_online", () => {
      setStrangerStatus("online");
    });

    newSocket.on("stranger_offline", () => {
      setStrangerStatus("disconnected");
    });

    newSocket.on("stranger_left", () => {
      setStrangerStatus("disconnected");
      showNotification("Stranger left the chat.");
    });

    newSocket.on("stranger_skipped", () => {
      setStrangerStatus("disconnected");
      showNotification("Stranger skipped to the next person.");
    });

    newSocket.on("stranger_blocked", () => {
      setStrangerStatus("disconnected");
      showNotification("Stranger has been blocked.");
      // Clean up chat view safely
      setTimeout(() => {
        setMessages([]);
        setStrangerUserId(null);
        setWaiting(false);
        navigateTo("matching");
      }, 1200);
    });

    // ==========================================
    // TYPING INDICATORS
    // ==========================================

    newSocket.on("stranger_typing", () => {
      setStrangerTyping(true);
    });

    newSocket.on("stranger_stopped_typing", () => {
      setStrangerTyping(false);
    });

    // ==========================================
    // MESSAGE RECEIVE & DELIVERY ACKS
    // ==========================================

    newSocket.on("message_sent", (data: { id: string; clientId?: string; status: string }) => {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.clientId === data.clientId
            ? { ...msg, id: data.id, status: "sent" }
            : msg
        )
      );
    });

    newSocket.on("message_delivered", (data: { id: string; clientId?: string }) => {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === data.id || (data.clientId && msg.clientId === data.clientId)
            ? { ...msg, status: "delivered" }
            : msg
        )
      );
    });

    newSocket.on(
      "receive_message",
      (data: {
        id: string;
        clientId?: string;
        text: string;
        senderId: string;
        timestamp: number;
        type?: "text" | "audio" | "image";
        audioUrl?: string;
        imageUrl?: string;
        status?: "sending" | "sent" | "delivered" | "seen";
        replyTo?: {
          id: string;
          text: string;
          type?: "text" | "audio" | "image";
        } | null;
      }) => {
        const isAudio = data.type === "audio";
        const isImage = data.type === "image";

        const newMsg: Message = {
          id: data.id,
          clientId: data.clientId,
          text: isImage
            ? data.text || "Photo message"
            : isAudio
            ? "Voice message"
            : data.text,
          sender: data.senderId === userIdRef.current ? "me" : "stranger",
          timestamp: data.timestamp,
          type: data.type || "text",
          audioUrl: data.audioUrl,
          imageUrl: data.imageUrl,
          status: "delivered",
          replyTo: data.replyTo,
        };

        setMessages((prev) => [...prev, newMsg]);

        // If in video call and chat panel is closed, increment unread counter
        if (isVideoCallActiveRef.current && !isVideoChatOpenRef.current) {
          setUnreadVideoChatCount((prev) => prev + 1);
        }

        // Acknowledge seen if active in stranger-chat
        newSocket.emit("mark_seen", {
          roomId: strangerRoomIdRef.current || undefined,
          messageIds: [data.id],
        });
      }
    );

    newSocket.on("message_seen", (data: { chatId?: string; messageIds?: string[] }) => {
      // Update stranger chat messages
      setMessages((prev) =>
        prev.map((msg) => {
          if (msg.sender === "me") {
            if (
              !data.messageIds ||
              data.messageIds.length === 0 ||
              (msg.id && data.messageIds.includes(msg.id))
            ) {
              return { ...msg, status: "seen" };
            }
          }
          return msg;
        })
      );

      // Update friend chat messages
      setFriendMessages((prev) =>
        prev.map((msg) => {
          if (msg.sender === "me") {
            if (
              !data.messageIds ||
              data.messageIds.length === 0 ||
              (msg.id && data.messageIds.includes(msg.id))
            ) {
              return { ...msg, status: "seen" };
            }
          }
          return msg;
        })
      );
    });

    // ==========================================
    // MESSAGE REACTIONS & DELETE
    // ==========================================

    newSocket.on("reaction_updated", (data: { messageId: string; reactions: { emoji: string; userId: string }[] }) => {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === data.messageId
            ? { ...msg, reactions: data.reactions }
            : msg
        )
      );

      setFriendMessages((prev) =>
        prev.map((msg) =>
          msg.id === data.messageId
            ? { ...msg, reactions: data.reactions }
            : msg
        )
      );
    });

    newSocket.on("message_deleted", (data: { messageId: string }) => {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === data.messageId
            ? { ...msg, deletedAt: new Date().toISOString() }
            : msg
        )
      );

      setFriendMessages((prev) =>
        prev.map((msg) =>
          msg.id === data.messageId
            ? { ...msg, deletedAt: new Date().toISOString() }
            : msg
        )
      );
    });

    // ==========================================
    // IN-APP NOTIFICATIONS REAL-TIME
    // ==========================================

    newSocket.on("new_notification", (notif: any) => {
      setNotifications((prev) => [
        {
          id: notif.id || `temp-${Date.now()}`,
          type: notif.type,
          title: notif.title,
          body: notif.body,
          data: typeof notif.data === "object" ? JSON.stringify(notif.data) : notif.data,
          isRead: false,
          createdAt: notif.createdAt || new Date().toISOString(),
        },
        ...prev,
      ]);
      setUnreadNotificationsCount((prev) => prev + 1);
      showNotification(`🔔 ${notif.title}: ${notif.body}`);

      if (userIdRef.current) {
        if (notif.type === "FRIEND_REQUEST") {
          fetch(`http://localhost:3001/friends/requests/${userIdRef.current}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => {
              if (data) setFriendRequests(data);
            })
            .catch(() => {});
        } else if (notif.type === "FRIEND_ACCEPTED") {
          fetch(`http://localhost:3001/friends/${userIdRef.current}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => {
              if (data) setFriends(data);
            })
            .catch(() => {});
        }
      }
    });

    // ==========================================
    // SAFETY & RATE LIMITING
    // ==========================================

    newSocket.on("report_submitted", (data: { message: string }) => {
      showNotification(data.message);
    });

    newSocket.on("rate_limit_exceeded", (data: { message: string }) => {
      showNotification(`⚠️ ${data.message}`);
    });

    // ==========================================
    // FRIEND ROOMS & PRIVATE MESSAGING
    // ==========================================

    newSocket.on("friend_room_opened", (data: any) => {
      setFriendRoomId(data.roomId);
      if (data.chatId) {
        setFriendChatId(data.chatId);
      }
      const currentUserId = userIdRef.current;

      const history: Message[] = (data.messages || []).map((item: any) => {
        // Handle pre-formatted message object (from getFormattedMessages)
        if (item.type || item.text) {
          return {
            id: item.id,
            text: item.text || "",
            sender: item.sender || (item.senderId === currentUserId ? "me" : "stranger"),
            timestamp: typeof item.createdAt === "string" ? new Date(item.createdAt).getTime() : (item.createdAt ? new Date(item.createdAt).getTime() : (item.timestamp || Date.now())),
            type: item.type || "text",
            audioUrl: item.audioUrl,
            imageUrl: item.imageUrl,
            status: item.status || "delivered",
            replyTo: item.replyTo,
            deletedAt: item.deletedAt,
            reactions: item.reactions || [],
          };
        }

        // Handle raw prisma Message entity
        const rawContent = typeof item.content === "string" ? item.content : "";
        const isAudio = rawContent.startsWith("audio:");
        const isImage = rawContent.startsWith("image:");

        return {
          id: item.id,
          text: isImage
            ? "Photo message"
            : isAudio
            ? "Voice message"
            : rawContent,
          sender: item.senderId === currentUserId ? "me" : "stranger",
          timestamp: item.createdAt ? new Date(item.createdAt).getTime() : Date.now(),
          type: isImage ? "image" : isAudio ? "audio" : "text",
          audioUrl: isAudio ? rawContent.replace("audio:", "") : undefined,
          imageUrl: isImage ? rawContent.replace("image:", "") : undefined,
          status: item.status || "delivered",
          replyTo: item.replyTo,
          deletedAt: item.deletedAt,
          reactions: item.reactions || [],
        };
      });

      setFriendMessages(history);
      setFriendChatLoading(false);
      navigateTo("friend-chat");

      // Acknowledge read for any unread friend messages upon opening room
      const unreadFriendMsgIds = history
        .filter((m) => m.sender !== "me" && m.id && m.status !== "seen")
        .map((m) => m.id as string);
      if (unreadFriendMsgIds.length > 0) {
        newSocket.emit("mark_seen", {
          roomId: data.roomId,
          chatId: data.chatId,
          messageIds: unreadFriendMsgIds,
        });
      }
    });

    newSocket.on("receive_friend_message", (data: {
      id: string;
      text: string;
      senderId: string;
      timestamp: number;
      type?: "text" | "audio" | "image";
      audioUrl?: string;
      imageUrl?: string;
      replyTo?: {
        id: string;
        text: string;
        type?: "text" | "audio" | "image";
      } | null;
    }) => {
      const isAudio = data.type === "audio";
      const isImage = data.type === "image";

      const newMsg: Message = {
        id: data.id,
        text: isImage
          ? data.text || "Photo message"
          : isAudio
          ? "Voice message"
          : data.text,
        sender: data.senderId === userIdRef.current ? "me" : "stranger",
        timestamp: data.timestamp,
        type: data.type || "text",
        audioUrl: data.audioUrl,
        imageUrl: data.imageUrl,
        status: "delivered",
        replyTo: data.replyTo,
      };

      setFriendMessages((prev) => [...prev, newMsg]);

      // If in friend video call and chat drawer is closed, increment unread counter
      if (isFriendVideoCallActiveRef.current && !isFriendVideoChatOpenRef.current) {
        setUnreadFriendVideoChatCount((prev) => prev + 1);
      }

      // Acknowledge seen if recipient is currently active in this friend chat
      if (
        currentViewRef.current === "friend-chat" &&
        selectedFriendRef.current?.id === data.senderId
      ) {
        newSocket.emit("mark_seen", {
          roomId: friendRoomIdRef.current,
          chatId: friendChatIdRef.current,
          messageIds: [data.id],
        });
      }
    });

    newSocket.on("friend_room_error", (data: { message: string }) => {
      setFriendChatLoading(false);
      setFriendsError(data.message || "Could not open private chat");
    });

    // Global friend incoming video call listener (when not currently in friend-chat for this room)
    newSocket.on("video_call_request", (data: {
      roomId: string;
      callId: string;
      callerUserId: string;
      callerName?: string;
      callerAvatar?: string;
      chatType?: string;
    }) => {
      if (data.chatType === "friend" && data.roomId.startsWith("friend-")) {
        const isBusyInCall = isVideoCallActiveRef.current || isFriendVideoCallActiveRef.current;
        if (isBusyInCall) {
          // Genuinely busy on an active video call
          newSocket.emit("video_call_declined", {
            roomId: data.roomId,
            callId: data.callId,
            reason: "busy",
          });
          return;
        }

        if (currentViewRef.current !== "friend-chat" || friendRoomIdRef.current !== data.roomId) {
          setGlobalIncomingFriendCall({
            roomId: data.roomId,
            callId: data.callId,
            callerUserId: data.callerUserId,
            callerName: data.callerName || "Friend",
            callerAvatar: data.callerAvatar || "👤",
          });
        }
      }
    });

    newSocket.on("video_call_cancelled", (data: { roomId: string; callId?: string }) => {
      setGlobalIncomingFriendCall((prev) => {
        if (prev && prev.roomId === data.roomId) return null;
        return prev;
      });
    });

    newSocket.on("video_call_declined", (data: { roomId: string; callId?: string }) => {
      setGlobalIncomingFriendCall((prev) => {
        if (prev && prev.roomId === data.roomId) return null;
        return prev;
      });
    });

    newSocket.on("video_call_ended", (data: { roomId: string; callId?: string }) => {
      setGlobalIncomingFriendCall((prev) => {
        if (prev && prev.roomId === data.roomId) return null;
        return prev;
      });
    });

    return () => {
      newSocket.disconnect();
    };
  }, [navigateTo, showNotification, sessionKey]);

  // ==========================================
  // MATCHMAKING & STRANGER CHAT ACTIONS
  // ==========================================

  const toggleInterest = (interest: string) => {
    setInterests((prev) =>
      prev.includes(interest)
        ? prev.filter((item) => item !== interest)
        : [...prev, interest]
    );
  };

  const clearMatchingTimers = useCallback(() => {
    if (noLiveTimeoutRef.current) {
      clearTimeout(noLiveTimeoutRef.current);
      noLiveTimeoutRef.current = null;
    }
    if (searchTimerRef.current) {
      clearInterval(searchTimerRef.current);
      searchTimerRef.current = null;
    }
  }, []);

  const handleCancelSearch = useCallback(() => {
    clearMatchingTimers();
    setWaiting(false);
    setMatchingMode("idle");
    setSearchElapsedSeconds(0);
    if (socket) {
      socket.emit("end_chat");
    }
  }, [socket, clearMatchingTimers]);

  const handleKeepWaiting = useCallback(() => {
    clearMatchingTimers();
    setMatchingMode("keep-waiting");
    // User is already in the Redis/Socket.IO matchmaking queue.
    // Start live search session timer
    searchTimerRef.current = setInterval(() => {
      setSearchElapsedSeconds((prev) => prev + 1);
    }, 1000);
  }, [clearMatchingTimers]);

  const findStranger = async () => {
    if (!socket || !userId) return;

    const preferences: MatchPreferences = {
      language,
      interests,
      goal,
    };

    clearMatchingTimers();
    setSearchElapsedSeconds(0);
    setMatchingMode("searching");

    try {
      await fetch(`http://localhost:3001/users/${userId}/preferences`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(preferences),
      });

      setMessages([]);
      setReplyingTo(null);
      setWaiting(true);
      setStrangerTyping(false);
      setFriendRequestSent(false);
      setFriendRequestMessage("");
      setStrangerUserId(null);

      socket.emit("find_stranger", preferences);

      // Start search elapsed seconds timer
      searchTimerRef.current = setInterval(() => {
        setSearchElapsedSeconds((prev) => prev + 1);
      }, 1000);

      // If no match arrives within 2.5 seconds, display the polished No-One-Live-Right-Now prompt
      noLiveTimeoutRef.current = setTimeout(() => {
        setMatchingMode((current) => {
          if (current === "searching") {
            return "no-one-live";
          }
          return current;
        });
      }, 2500);
    } catch (error) {
      console.error("Preference save error:", error);
      clearMatchingTimers();
      setWaiting(false);
      setMatchingMode("idle");
      showNotification("Could not save matching preferences.");
    }
  };

  // FEATURE 1: Skip / Next Stranger
  const handleNextStranger = () => {
    videoCall.teardownCall();
    setIsVideoChatOpen(false);
    setUnreadVideoChatCount(0);
    if (!socket) return;

    clearMatchingTimers();
    setMessages([]);
    setReplyingTo(null);
    setStrangerTyping(false);
    setMatchScore(null);
    setStrangerRoomId(null);
    setStrangerUserId(null);
    setFriendRequestSent(false);
    setFriendRequestMessage("");
    setMessage("");
    setViewProfile(null);
    setWaiting(true);
    setSearchElapsedSeconds(0);
    setMatchingMode("searching");

    socket.emit("next_stranger");

    searchTimerRef.current = setInterval(() => {
      setSearchElapsedSeconds((prev) => prev + 1);
    }, 1000);

    noLiveTimeoutRef.current = setTimeout(() => {
      setMatchingMode((current) => {
        if (current === "searching") {
          return "no-one-live";
        }
        return current;
      });
    }, 2500);
  };

  // FEATURE 7: Exit Stranger Chat Safely
  const handleExitStrangerChat = () => {
    videoCall.teardownCall();
    setIsVideoChatOpen(false);
    setUnreadVideoChatCount(0);
    clearMatchingTimers();
    if (socket) {
      socket.emit("end_chat");
    }
    setMessages([]);
    setReplyingTo(null);
    setStrangerTyping(false);
    setMatchScore(null);
    setStrangerRoomId(null);
    setStrangerUserId(null);
    setFriendRequestSent(false);
    setFriendRequestMessage("");
    setMessage("");
    setViewProfile(null);
    setWaiting(false);
    setMatchingMode("idle");
    setSearchElapsedSeconds(0);

    navigateTo("matching");
  };

  // ==========================================
  // FEATURE 2: TYPING INDICATORS
  // ==========================================

  const handleTypingStart = () => {
    if (socket) {
      socket.emit("typing");
    }
  };

  const handleTypingStop = () => {
    if (socket) {
      socket.emit("stop_typing");
    }
  };

  // ==========================================
  // FEATURE 4: SENDING MESSAGES & CLIENT IDS
  // ==========================================

  const sendStrangerMessage = () => {
    if (!socket || message.trim() === "") return;

    const clientId = `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const text = message.trim();

    const optimisticMsg: Message = {
      id: clientId,
      clientId,
      text,
      sender: "me",
      timestamp: Date.now(),
      type: "text",
      status: "sending",
      replyTo: replyingTo
        ? {
            id: replyingTo.id,
            text: replyingTo.text,
            type: replyingTo.type,
          }
        : null,
    };

    setMessages((prev) => [...prev, optimisticMsg]);
    setMessage("");
    setReplyingTo(null);

    socket.emit("send_message", {
      text,
      clientId,
      replyToId: replyingTo?.id,
    });
    socket.emit("stop_typing");
  };

  const sendStrangerVoice = (audioBlob: Blob) => {
    if (!socket) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result;
      if (typeof result !== "string") return;

      const clientId = `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      const optimisticMsg: Message = {
        id: clientId,
        clientId,
        text: "Voice message",
        sender: "me",
        timestamp: Date.now(),
        type: "audio",
        audioUrl: result,
        status: "sending",
        replyTo: replyingTo
          ? {
              id: replyingTo.id,
              text: replyingTo.text,
              type: replyingTo.type,
            }
          : null,
      };

      setMessages((prev) => [...prev, optimisticMsg]);
      setReplyingTo(null);

      socket.emit("send_voice_message", {
        audioData: result,
        clientId,
        replyToId: replyingTo?.id,
      });
    };
    reader.readAsDataURL(audioBlob);
  };

  const sendStrangerImage = (imageDataUrl: string) => {
    if (!socket) return;

    const clientId = `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const optimisticMsg: Message = {
      id: clientId,
      clientId,
      text: message.trim() || "Photo message",
      sender: "me",
      timestamp: Date.now(),
      type: "image",
      imageUrl: imageDataUrl,
      status: "sending",
      replyTo: replyingTo
        ? {
            id: replyingTo.id,
            text: replyingTo.text,
            type: replyingTo.type,
          }
        : null,
    };

    setMessages((prev) => [...prev, optimisticMsg]);
    setMessage("");
    setReplyingTo(null);

    socket.emit("send_image_message", {
      imageData: imageDataUrl,
      text: optimisticMsg.text,
      clientId,
      replyToId: replyingTo?.id,
    });
  };

  // ==========================================
  // FEATURE 5: REACTIONS, REPLIES, DELETE
  // ==========================================

  const handleToggleReaction = (messageId: string, emoji: string) => {
    if (!socket || !userId) return;

    const targetMsg = messages.find((m) => m.id === messageId);
    const existing = targetMsg?.reactions?.find(
      (r) => r.userId === userId && r.emoji === emoji
    );

    if (existing) {
      socket.emit("remove_reaction", { messageId, emoji });
    } else {
      socket.emit("add_reaction", { messageId, emoji });
    }
  };

  const handleToggleFriendReaction = (messageId: string, emoji: string) => {
    if (!socket || !userId) return;

    const targetMsg = friendMessages.find((m) => m.id === messageId);
    const existing = targetMsg?.reactions?.find(
      (r) => r.userId === userId && r.emoji === emoji
    );

    if (existing) {
      socket.emit("remove_reaction", {
        messageId,
        emoji,
        roomId: friendRoomIdRef.current,
      });
    } else {
      socket.emit("add_reaction", {
        messageId,
        emoji,
        roomId: friendRoomIdRef.current,
      });
    }
  };

  const handleDeleteMessage = (messageId: string) => {
    if (!socket) return;
    socket.emit("delete_message", { messageId });
    setMessages((prev) =>
      prev.map((msg) =>
        msg.id === messageId
          ? { ...msg, deletedAt: new Date().toISOString() }
          : msg
      )
    );
  };

  const handleDeleteFriendMessage = (messageId: string) => {
    if (!socket) return;
    socket.emit("delete_message", {
      messageId,
      roomId: friendRoomIdRef.current,
    });
    setFriendMessages((prev) =>
      prev.map((msg) =>
        msg.id === messageId
          ? { ...msg, deletedAt: new Date().toISOString() }
          : msg
      )
    );
  };

  const handleReplyMessage = (msg: Message) => {
    setReplyingTo(msg);
  };

  // ==========================================
  // FEATURE 6: REPORT & BLOCK
  // ==========================================

  const handleReportSubmit = (reason: string, description: string) => {
    if (!socket) return;
    socket.emit("report_stranger", {
      reportedUserId: strangerUserId,
      reason,
      description,
    });
  };

  const handleBlockStranger = () => {
    if (!socket) return;
    if (confirm("Are you sure you want to block this stranger? You will not be matched again.")) {
      videoCall.teardownCall();
      setIsVideoChatOpen(false);
      setUnreadVideoChatCount(0);
      socket.emit("block_stranger", { blockedUserId: strangerUserId });
    }
  };

  // ==========================================
  // FRIENDS & PRIVATE CHAT
  // ==========================================

  const loadFriends = async () => {
    if (!userId) return;
    try {
      setFriendsLoading(true);
      setFriendsError("");
      const res = await fetch(`http://localhost:3001/friends/${userId}`);
      if (!res.ok) throw new Error("Failed to load friends");
      const data: Friendship[] = await res.json();
      setFriends(data);
    } catch (err) {
      console.error(err);
      setFriendsError("Could not load friends");
    } finally {
      setFriendsLoading(false);
    }
  };

  const loadFriendRequests = async () => {
    if (!userId) return;
    try {
      const res = await fetch(`http://localhost:3001/friends/requests/${userId}`);
      if (!res.ok) throw new Error("Failed to load friend requests");
      const data: FriendRequest[] = await res.json();
      setFriendRequests(data);
    } catch (err) {
      console.error(err);
    }
  };

  const loadNotifications = async () => {
    if (!userId) return;
    try {
      const [resNotifs, resCount] = await Promise.all([
        fetch(`http://localhost:3001/notifications/${userId}`),
        fetch(`http://localhost:3001/notifications/${userId}/unread-count`),
      ]);
      if (resNotifs.ok) {
        const data = await resNotifs.json();
        setNotifications(data);
      }
      if (resCount.ok) {
        const countData = await resCount.json();
        setUnreadNotificationsCount(countData.count || 0);
      }
    } catch (err) {
      console.warn("Could not load notifications:", err);
    }
  };

  const markNotificationAsRead = async (id: string) => {
    if (!userId) return;
    try {
      await fetch(`http://localhost:3001/notifications/${id}/read`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, isRead: true } : n))
      );
      setUnreadNotificationsCount((prev) => Math.max(0, prev - 1));
    } catch (err) {
      console.warn("Could not mark notification as read:", err);
    }
  };

  const markAllNotificationsAsRead = async () => {
    if (!userId) return;
    try {
      await fetch(`http://localhost:3001/notifications/user/${userId}/read-all`, {
        method: "PUT",
      });
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      setUnreadNotificationsCount(0);
    } catch (err) {
      console.warn("Could not mark all notifications read:", err);
    }
  };

  const handleSelectNotification = async (notif: AppNotification) => {
    if (notif.type === "FRIEND_REQUEST") {
      openFriends();
    } else if (notif.type === "FRIEND_ACCEPTED" || notif.type === "NEW_MESSAGE") {
      try {
        let parsedData: any = {};
        if (notif.data) {
          parsedData = typeof notif.data === "string" ? JSON.parse(notif.data) : notif.data;
        }
        const friendId = parsedData.friendId || parsedData.senderId;
        if (friendId) {
          // Open friend chat directly
          if (!friends.length) {
            await loadFriends();
          }
          const targetFriendship = friends.find(
            (f) => f.friend.id === friendId
          );
          if (targetFriendship) {
            openFriendChat(targetFriendship);
          } else {
            openFriends();
          }
        } else {
          openFriends();
        }
      } catch {
        openFriends();
      }
    }
  };

  const openFriends = async () => {
    navigateTo("friends");
    await Promise.all([loadFriends(), loadFriendRequests()]);
  };

  const openFriendChat = (friendship: Friendship) => {
    if (!socket || !userId) return;
    setSelectedFriend(friendship.friend);
    setFriendMessages([]);
    setFriendRoomId(null);
    setFriendChatLoading(true);
    setFriendsError("");

    socket.emit("open_friend_room", {
      userId,
      friendId: friendship.friend.id,
    });
  };

  const closeFriendChat = () => {
    friendVideoCall.teardownCall();
    setIsFriendVideoChatOpen(false);
    setUnreadFriendVideoChatCount(0);
    if (socket && friendRoomId) {
      socket.emit("leave_friend_room", { roomId: friendRoomId });
    }
    setSelectedFriend(null);
    setFriendRoomId(null);
    setFriendMessages([]);
    setFriendMessage("");
    setFriendReplyingTo(null);
    navigateTo("friends");
  };

  const handleAcceptGlobalIncomingCall = () => {
    if (!globalIncomingFriendCall || !socket) return;
    const callData = globalIncomingFriendCall;
    setGlobalIncomingFriendCall(null);

    const targetFriendship = friends.find(
      (f) => f.friend.id === callData.callerUserId
    );

    const friendObj: Friend = targetFriendship
      ? targetFriendship.friend
      : {
          id: callData.callerUserId,
          username: callData.callerName,
          age: null,
          gender: null,
          avatar: callData.callerAvatar,
          isOnline: true,
        };

    setSelectedFriend(friendObj);
    setFriendRoomId(callData.roomId);
    setFriendMessages([]);
    navigateTo("friend-chat");

    socket.emit("open_friend_room", {
      userId,
      friendId: callData.callerUserId,
    });

    friendVideoCall.acceptCall({
      roomId: callData.roomId,
      callId: callData.callId,
    });
  };

  const handleDeclineGlobalIncomingCall = () => {
    if (!globalIncomingFriendCall || !socket) return;
    socket.emit("video_call_declined", {
      roomId: globalIncomingFriendCall.roomId,
      callId: globalIncomingFriendCall.callId,
      reason: "user_declined",
    });
    setGlobalIncomingFriendCall(null);
  };

  const sendFriendMessage = () => {
    if (!socket || !userId || !friendRoomId || friendMessage.trim() === "") return;
    const text = friendMessage.trim();

    socket.emit("send_friend_message", {
      roomId: friendRoomId,
      senderId: userId,
      text,
      replyToId: friendReplyingTo?.id,
    });

    setFriendMessage("");
    setFriendReplyingTo(null);
  };

  const sendFriendVoice = (audioBlob: Blob) => {
    if (!socket || !friendRoomId) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result;
      if (typeof result !== "string") return;

      socket.emit("send_friend_voice_message", {
        roomId: friendRoomId,
        audioData: result,
        replyToId: friendReplyingTo?.id,
      });
      setFriendReplyingTo(null);
    };
    reader.readAsDataURL(audioBlob);
  };

  const sendFriendImage = (imageDataUrl: string) => {
    if (!socket || !friendRoomId) return;
    socket.emit("send_friend_image_message", {
      roomId: friendRoomId,
      imageData: imageDataUrl,
      text: friendMessage.trim() || undefined,
      replyToId: friendReplyingTo?.id,
    });
    setFriendMessage("");
    setFriendReplyingTo(null);
  };

  const sendFriendRequest = async () => {
    if (!userId || !strangerUserId) return;
    try {
      setFriendRequestMessage("");
      const res = await fetch("http://localhost:3001/friends/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ senderId: userId, receiverId: strangerUserId }),
      });
      if (!res.ok) throw new Error("Failed to send friend request");
      setFriendRequestSent(true);
      setFriendRequestMessage("Friend request sent");
    } catch (err) {
      setFriendRequestMessage("Failed to send friend request");
    }
  };

  const acceptFriendRequest = async (requestId: string) => {
    if (!userId) return;
    try {
      await fetch(`http://localhost:3001/friends/request/${requestId}/accept`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      await Promise.all([loadFriends(), loadFriendRequests()]);
    } catch (err) {
      setFriendsError("Failed to accept request");
    }
  };

  const rejectFriendRequest = async (requestId: string) => {
    if (!userId) return;
    try {
      await fetch(`http://localhost:3001/friends/request/${requestId}/reject`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      await loadFriendRequests();
    } catch (err) {
      setFriendsError("Failed to reject request");
    }
  };

  const removeFriend = async (friendId: string) => {
    if (!userId) return;
    try {
      if (selectedFriend?.id === friendId) {
        friendVideoCall.teardownCall();
        setIsFriendVideoChatOpen(false);
        setUnreadFriendVideoChatCount(0);
      }
      await fetch(`http://localhost:3001/friends/${userId}/${friendId}`, {
        method: "DELETE",
      });
      await loadFriends();
    } catch (err) {
      setFriendsError("Failed to remove friend");
    }
  };

  const openUserProfile = async (targetUserId: string | null) => {
    if (!targetUserId) return;
    try {
      setProfileLoading(true);
      setProfileError("");
      const res = await fetch(`http://localhost:3001/users/${targetUserId}/profile`);
      if (!res.ok) throw new Error("Failed to load profile");
      const data = await res.json();
      setViewProfile(data);
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : "Could not load profile");
    } finally {
      setProfileLoading(false);
    }
  };

  // ==========================================
  // ACCOUNT DELETION & LOGOUT
  // ==========================================

  const handleDeleteAccount = async () => {
    if (!userId) return;
    try {
      videoCall.teardownCall();
      friendVideoCall.teardownCall();
      setIsVideoChatOpen(false);
      setIsFriendVideoChatOpen(false);
      setUnreadVideoChatCount(0);
      setUnreadFriendVideoChatCount(0);
      const res = await fetch(`http://localhost:3001/users/${userId}/account`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || "Failed to delete account");
      }

      // Disconnect socket cleanly
      if (socket) {
        socket.disconnect();
      }

      // Wipe all user-specific local and session storage
      if (typeof window !== "undefined") {
        sessionStorage.removeItem("sc_user_id");
        sessionStorage.removeItem("sc_session_user_id");
        localStorage.removeItem("sc_user_id");
        localStorage.removeItem("sc_session_user_id");
      }

      // Clear all frontend state
      setUserId(null);
      userIdRef.current = null;
      setCurrentUserProfile(null);
      setFriends([]);
      setFriendRequests([]);
      setNotifications([]);
      setUnreadNotificationsCount(0);
      setMessages([]);
      setFriendMessages([]);
      setSelectedFriend(null);
      setFriendRoomId(null);
      setFriendChatId(null);
      setStrangerRoomId(null);
      setStrangerUserId(null);
      setMatchScore(null);
      setStrangerStatus("connecting");
      setWaiting(false);
      setProfileCompleted(false);
      setCheckingProfile(true);
      setCurrentView("profile-setup");
      setIsSidebarOpen(false);

      // Trigger socket re-initialization to obtain a brand new valid user identity
      setSessionKey((prev) => prev + 1);

      showNotification("Account permanently deleted. You can create a new profile.");
    } catch (err: any) {
      console.error("Account deletion failed:", err);
      showNotification("Failed to delete account. Please try again.");
    }
  };

  // ==========================================
  // RENDER: LOADING CONNECTION
  // ==========================================

  if (!userId || checkingProfile) {
    return (
      <main className="min-h-screen relative flex items-center justify-center p-4 bg-[#030308] overflow-hidden">
        <GalaxyBackground />
        <div className="relative z-10 w-full max-w-md bg-zinc-900/90 backdrop-blur-md border border-zinc-800 rounded-3xl p-8 shadow-2xl text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 mx-auto text-xl font-bold shadow-lg shadow-indigo-600/20">
            ⚡
          </div>
          <h1 className="text-xl font-bold text-white mt-4">
            Chat<span className="text-indigo-400">Buddy</span>
          </h1>
          <p className="mt-2 text-xs text-zinc-400">Loading your profile & connecting...</p>
          <div className="mt-6">
            <div className="animate-spin h-7 w-7 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full mx-auto" />
          </div>
        </div>
      </main>
    );
  }

  // ==========================================
  // RENDER: FIRST-TIME PROFILE SETUP
  // ==========================================

  if (!profileCompleted) {
    return (
      <main className="min-h-screen relative flex items-center justify-center p-4 bg-[#030308] overflow-hidden">
        <GalaxyBackground />
        <div className="relative z-10 w-full flex justify-center">
          <ProfileSetup
            userId={userId}
            onComplete={(savedProfile) => {
              setCurrentUserProfile((prev) => ({
                id: userId,
                username: savedProfile.username,
                age: savedProfile.age,
                gender: savedProfile.gender,
                avatar: savedProfile.avatar,
                language: prev?.language || language,
                interests: prev?.interests || interests,
                goal: prev?.goal || goal,
              }));
              setProfileCompleted(true);
              navigateTo("matching");
            }}
          />
        </div>
      </main>
    );
  }

  // ==========================================
  // RENDER: NOTIFICATION BANNER
  // ==========================================

  const notificationBanner = notification && (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 rounded-2xl bg-zinc-900/95 border border-zinc-700/80 px-4 py-2.5 text-xs font-semibold text-white shadow-2xl flex items-center gap-2 animate-bounce backdrop-blur-md">
      <span>💬</span>
      <span>{notification}</span>
    </div>
  );

  // Filtered friends for search
  const filteredFriends = friends.filter((item) =>
    searchQuery.trim() === ""
      ? true
      : (item.friend.username || "Anonymous")
          .toLowerCase()
          .includes(searchQuery.toLowerCase().trim())
  );

  // Reusable friend text chat body for both normal mode and in-call drawer mode
  const friendChatBody = (
    <div className="flex-1 flex flex-col min-h-0 bg-zinc-950">
      <MessageList
        messages={friendMessages}
        currentUserId={userId}
        onToggleReaction={handleToggleFriendReaction}
        onDeleteMessage={handleDeleteFriendMessage}
        onReplyMessage={(msg) => setFriendReplyingTo(msg)}
      />
      <AiSuggestions
        conversationId={friendRoomId || friendChatId || selectedFriend?.id}
        messages={friendMessages}
        currentUserId={userId}
        onSelectSuggestion={(text) => setFriendMessage(text)}
      />
      <MessageInput
        message={friendMessage}
        setMessage={setFriendMessage}
        sendMessage={sendFriendMessage}
        onVoiceRecorded={sendFriendVoice}
        onImageSelected={sendFriendImage}
        replyingTo={friendReplyingTo}
        onCancelReply={() => setFriendReplyingTo(null)}
      />
    </div>
  );

  // Reusable stranger text chat body for both normal mode and in-call drawer mode
  const strangerChatBody = (
    <div className="flex-1 flex flex-col min-h-0 bg-zinc-950">
      <MessageList
        messages={messages}
        onToggleReaction={handleToggleReaction}
        onDeleteMessage={handleDeleteMessage}
        onReplyMessage={handleReplyMessage}
      />

      {/* Real-time typing indicator */}
      {strangerTyping && (
        <div className="px-6 py-1.5 text-xs text-zinc-400 animate-pulse bg-zinc-950 flex items-center gap-1.5 border-t border-zinc-900">
          <span className="h-1.5 w-1.5 rounded-full bg-indigo-400 animate-ping" />
          Stranger is typing...
        </div>
      )}

      {/* AI Conversation Suggestions */}
      <AiSuggestions
        conversationId={strangerRoomId || strangerUserId}
        messages={messages}
        currentUserId={userId || undefined}
        onSelectSuggestion={(text) => setMessage(text)}
        disabled={strangerStatus === "disconnected"}
      />

      {/* Message Input with Voice, Image, Debounced typing */}
      <MessageInput
        message={message}
        setMessage={setMessage}
        sendMessage={sendStrangerMessage}
        onVoiceRecorded={sendStrangerVoice}
        onImageSelected={sendStrangerImage}
        replyingTo={replyingTo}
        onCancelReply={() => setReplyingTo(null)}
        onTypingStart={handleTypingStart}
        onTypingStop={handleTypingStop}
        disabled={strangerStatus === "disconnected"}
      />
    </div>
  );

  // ==========================================
  // RENDER: MAIN APPLICATION (HEADER + SIDEBAR + WORKSPACE)
  // ==========================================

  return (
    <div className="min-h-screen h-screen flex flex-col relative text-zinc-100 overflow-hidden bg-[#030308]">
      {/* Background galaxy layer */}
      <GalaxyBackground />

      {notificationBanner}

      {/* TOP APPLICATION HEADER (☰ Hamburger, Brand, New Chat, Profile, Notifications, Online status) */}
      <div className="relative z-20">
        <AppHeader
          onToggleSidebar={() => setIsSidebarOpen((prev) => !prev)}
          onNewChat={() => {
            if (currentView === "stranger-chat") {
              handleNextStranger();
            } else {
              navigateTo("matching");
            }
          }}
          onOpenProfile={() => setIsEditProfileOpen(true)}
          currentUsername={currentUserProfile?.username}
          currentAvatar={currentUserProfile?.avatar}
          unreadNotificationsCount={unreadNotificationsCount}
          notifications={notifications}
          onMarkNotificationAsRead={markNotificationAsRead}
          onMarkAllNotificationsAsRead={markAllNotificationsAsRead}
          onSelectNotification={handleSelectNotification}
        />
      </div>

      {/* MAIN BODY: SIDEBAR + RIGHT WORKSPACE */}
      <div className="flex-1 flex overflow-hidden relative z-10">
        {/* LEFT NAVIGATION SIDEBAR */}
        <AppSidebar
          isOpen={isSidebarOpen}
          onClose={() => setIsSidebarOpen(false)}
          activeTab={
            currentView === "discover" || currentView === "search-friends"
              ? "discover"
              : currentView === "friends" || currentView === "friend-chat"
              ? "friends"
              : "chat"
          }
          onSelectTab={(tab) => {
            if (tab === "friends") {
              openFriends();
            } else if (tab === "discover" || tab === "search-friends") {
              navigateTo("discover");
            } else {
              if (currentView !== "stranger-chat") {
                navigateTo("matching");
              }
            }
          }}
          userProfile={currentUserProfile}
          onOpenEditProfile={() => setIsEditProfileOpen(true)}
          onStartNewChat={() => {
            setIsSidebarOpen(false);
            if (currentView === "stranger-chat") {
              handleNextStranger();
            } else {
              navigateTo("matching");
            }
          }}
          friendsCount={friends.length}
          pendingRequestsCount={friendRequests.length}
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
          onDeleteAccount={handleDeleteAccount}
        />

        {/* RIGHT WORKSPACE AREA */}
        <main className="flex-1 flex flex-col min-w-0 bg-transparent overflow-y-auto relative">
          {/* VIEW: PRIVATE FRIEND CHAT */}
          {currentView === "friend-chat" && (
            <div className="flex-1 flex flex-col h-full w-full max-w-5xl mx-auto bg-zinc-900/95 backdrop-blur-md border-x border-zinc-800/80 shadow-2xl overflow-hidden">
              {/* Header */}
              <div className="flex items-center gap-3 px-4 sm:px-6 py-3 border-b border-zinc-800/90 bg-zinc-900/95 backdrop-blur-md shrink-0">
                <button
                  onClick={closeFriendChat}
                  className="px-3 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 hover:text-white border border-zinc-700/60 text-xs font-semibold transition shadow-xs flex items-center gap-1.5 active:scale-95"
                >
                  <span>←</span>
                  <span className="hidden xs:inline">Back to Friends</span>
                </button>

                <div className="flex-1 min-w-0">
                  <h1 className="font-bold text-white text-sm truncate flex items-center gap-1.5">
                    {selectedFriend?.avatar && <span>{selectedFriend.avatar}</span>}
                    <span>{selectedFriend?.username || "Friend"}</span>
                  </h1>
                  {selectedFriend?.isOnline ? (
                    <div className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-400">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse inline-block" />
                      <span>Online</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-[11px] text-zinc-400">
                      <span className="w-2 h-2 rounded-full bg-zinc-600 inline-block" />
                      <span>
                        Offline
                        {selectedFriend?.lastSeenAt
                          ? ` • Last seen ${formatLastSeen(selectedFriend.lastSeenAt)}`
                          : ""}
                      </span>
                    </div>
                  )}
                </div>

                {/* 🎥 Video Call Button */}
                <button
                  type="button"
                  onClick={friendVideoCall.startCall}
                  disabled={
                    friendVideoCall.callState !== "idle" ||
                    !selectedFriend?.id ||
                    !selectedFriend?.isOnline
                  }
                  title={
                    !selectedFriend?.isOnline
                      ? "Friend is currently offline"
                      : friendVideoCall.callState !== "idle"
                      ? "Video call in progress"
                      : "Start Video Call"
                  }
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 active:scale-95 shadow-xs ${
                    friendVideoCall.callState === "connected" || friendVideoCall.callState === "connecting"
                      ? "bg-rose-600 text-white hover:bg-rose-500 border border-rose-500/50"
                      : "bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white border border-indigo-500/40 shadow-indigo-600/20"
                  } disabled:opacity-40 disabled:cursor-not-allowed`}
                >
                  <span>🎥</span>
                  <span className="hidden xs:inline">Video Call</span>
                </button>

                <button
                  type="button"
                  onClick={() => openUserProfile(selectedFriend?.id || null)}
                  disabled={!selectedFriend?.id}
                  className="px-3 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700/60 text-zinc-200 hover:text-white text-xs font-medium transition disabled:opacity-50 flex items-center gap-1"
                >
                  <span>👤</span>
                  <span className="hidden sm:inline">Profile</span>
                </button>
              </div>

              {/* VIDEO CALL MODALS */}
              {friendVideoCall.callState === "calling" && (
                <CallingModal
                  onCancel={friendVideoCall.cancelCall}
                  targetName={selectedFriend?.username || "Friend"}
                />
              )}

              {friendVideoCall.callState === "incoming" && (
                <IncomingCallModal
                  onAccept={friendVideoCall.acceptCall}
                  onDecline={friendVideoCall.declineCall}
                  callerName={friendVideoCall.callerInfo?.callerName || selectedFriend?.username || "Friend"}
                  callerAvatar={friendVideoCall.callerInfo?.callerAvatar || selectedFriend?.avatar || "👤"}
                />
              )}

              {/* FRIEND CHAT CONTENT: DEDICATED VIDEO OVERLAY OR NORMAL TEXT CHAT */}
              {friendChatLoading ? (
                <div className="flex-1 flex items-center justify-center bg-zinc-950">
                  <div className="text-center">
                    <div className="animate-spin h-7 w-7 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full mx-auto" />
                    <p className="mt-3 text-xs text-zinc-400">Opening private chat...</p>
                  </div>
                </div>
              ) : (friendVideoCall.callState === "connecting" || friendVideoCall.callState === "connected" || friendVideoCall.callState === "failed" || friendVideoCall.connectionFailure?.failed) ? (
                <VideoCallOverlay
                  localStream={friendVideoCall.localStream}
                  remoteStream={friendVideoCall.remoteStream}
                  isMicMuted={friendVideoCall.isMicMuted}
                  isCameraOff={friendVideoCall.isCameraOff}
                  isRemoteCameraOff={friendVideoCall.isRemoteCameraOff}
                  callState={friendVideoCall.callState}
                  connectionFailure={friendVideoCall.connectionFailure}
                  onRetryCall={friendVideoCall.retryCall}
                  onDismissFailure={friendVideoCall.dismissFailure}
                  strangerAvatar={selectedFriend?.avatar || "👤"}
                  strangerUsername={selectedFriend?.username || "Friend"}
                  onToggleMute={friendVideoCall.toggleMute}
                  onToggleCamera={friendVideoCall.toggleCamera}
                  onEndCall={() => {
                    friendVideoCall.endCall();
                    friendVideoCall.dismissFailure();
                    setIsFriendVideoChatOpen(false);
                    setUnreadFriendVideoChatCount(0);
                  }}
                  isChatOpen={isFriendVideoChatOpen}
                  onToggleChat={() => {
                    setIsFriendVideoChatOpen((prev) => !prev);
                    setUnreadFriendVideoChatCount(0);
                  }}
                  unreadChatCount={unreadFriendVideoChatCount}
                >
                  {friendChatBody}
                </VideoCallOverlay>
              ) : (
                friendChatBody
              )}
            </div>
          )}

          {/* VIEW: FRIENDS PANEL */}
          {currentView === "friends" && (
            <div className="flex-1 w-full max-w-4xl mx-auto p-4 sm:p-6 overflow-y-auto">
              <div className="w-full bg-zinc-900/90 backdrop-blur-md border border-zinc-800 rounded-3xl overflow-hidden shadow-2xl">
                <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-950/50">
                  <div>
                    <h1 className="text-lg font-bold text-white">Friends & Connections</h1>
                    <p className="text-xs text-zinc-400 mt-0.5">Manage your requests and private friends</p>
                  </div>
                  <button
                    onClick={() => {
                      setFriendsError("");
                      navigateTo("matching");
                    }}
                    className="px-3 py-1.5 rounded-xl bg-zinc-800 text-zinc-200 hover:text-white text-xs font-semibold hover:bg-zinc-700 transition"
                  >
                    ← Stranger Chat
                  </button>
                </div>

                <div className="p-6 space-y-6">
                  {friendsError && (
                    <div className="rounded-2xl bg-red-950/60 border border-red-800/80 text-red-300 px-4 py-2.5 text-xs">
                      {friendsError}
                    </div>
                  )}

                  {/* Friend Requests */}
                  <section>
                    <div className="flex items-center justify-between mb-3">
                      <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                        Pending Friend Requests ({friendRequests.length})
                      </h2>
                    </div>
                    <div className="space-y-2.5">
                      {friendRequests.length === 0 ? (
                        <p className="text-xs text-zinc-500 py-2">No pending friend requests.</p>
                      ) : (
                        friendRequests.map((request) => (
                          <div
                            key={request.id}
                            className="border border-zinc-800 rounded-2xl p-3 bg-zinc-950/40 flex items-center justify-between gap-3"
                          >
                            <div className="flex items-center gap-2.5">
                              <span className="text-2xl">{request.sender.avatar || "👤"}</span>
                              <div>
                                <p className="text-xs font-bold text-white">
                                  {request.sender.username || "Anonymous"}
                                </p>
                                {request.sender.age && (
                                  <p className="text-[11px] text-zinc-500">Age: {request.sender.age}</p>
                                )}
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={() => acceptFriendRequest(request.id)}
                                className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-xs transition"
                              >
                                Accept
                              </button>
                              <button
                                onClick={() => rejectFriendRequest(request.id)}
                                className="px-3 py-1.5 rounded-xl bg-zinc-800 text-zinc-300 hover:text-white text-xs font-medium hover:bg-zinc-700 transition"
                              >
                                Decline
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </section>

                  {/* Friend List */}
                  <section>
                    <div className="flex items-center justify-between mb-3">
                      <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                        Your Friends ({filteredFriends.length})
                      </h2>
                    </div>
                    <div className="space-y-2.5">
                      {friendsLoading ? (
                        <p className="text-xs text-zinc-500 py-2">Loading friends...</p>
                      ) : filteredFriends.length === 0 ? (
                        <p className="text-xs text-zinc-500 py-2">
                          {searchQuery
                            ? "No friends match your search query."
                            : "No friends yet. Click 'Add Stranger as Friend' during chat!"}
                        </p>
                      ) : (
                        filteredFriends.map((item) => (
                          <div
                            key={item.friendshipId}
                            className="border border-zinc-800 rounded-2xl p-3 bg-zinc-950/40 flex items-center justify-between gap-3 hover:border-zinc-700 transition"
                          >
                            <div className="flex items-center gap-2.5">
                              <div className="relative">
                                <span className="text-2xl">{item.friend.avatar || "👤"}</span>
                                <span
                                  className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-zinc-950 ${
                                    item.friend.isOnline ? "bg-emerald-500" : "bg-zinc-600"
                                  }`}
                                />
                              </div>
                              <div>
                                <p className="text-xs font-bold text-white flex items-center gap-1.5">
                                  <span>{item.friend.username || "Anonymous"}</span>
                                  {item.friend.isOnline && (
                                    <span className="text-[10px] font-normal text-emerald-400">Online</span>
                                  )}
                                </p>
                                <p className="text-[11px] text-zinc-500">
                                  {item.friend.isOnline
                                    ? item.friend.age
                                      ? `Age: ${item.friend.age}`
                                      : "Active now"
                                    : item.friend.lastSeenAt
                                    ? `Last seen ${formatLastSeen(item.friend.lastSeenAt)}`
                                    : item.friend.age
                                    ? `Age: ${item.friend.age}`
                                    : "Offline"}
                                </p>
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={() => openFriendChat(item)}
                                className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-xs transition flex items-center gap-1"
                              >
                                <span>💬</span>
                                <span>Chat</span>
                              </button>
                              <button
                                onClick={() => removeFriend(item.friend.id)}
                                className="px-3 py-1.5 rounded-xl bg-zinc-800/80 hover:bg-red-950/60 hover:text-red-400 text-zinc-400 text-xs font-medium border border-zinc-700/40 transition"
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </section>
                </div>
              </div>
            </div>
          )}

          {/* VIEW: DISCOVER PEOPLE DIRECTORY */}
          {(currentView === "discover" || currentView === "search-friends") && (
            <DiscoverPeopleView
              currentUserId={userId || ""}
              onBack={() => navigateTo("matching")}
              onOpenProfile={(targetUserId) => openUserProfile(targetUserId)}
              onOpenPrivateChat={(friendData) => {
                const targetFriendship = friends.find(
                  (f) => f.friend.id === friendData.id
                );
                if (targetFriendship) {
                  openFriendChat(targetFriendship);
                } else {
                  openFriendChat({
                    friendshipId: `temp-${friendData.id}`,
                    createdAt: new Date().toISOString(),
                    friend: {
                      id: friendData.id,
                      username: friendData.username,
                      avatar: friendData.avatar,
                      age: null,
                      gender: null,
                      isOnline: friendData.isOnline,
                      lastSeenAt: friendData.lastSeenAt,
                    },
                  });
                }
              }}
              onAcceptRequest={acceptFriendRequest}
              showNotification={showNotification}
            />
          )}

          {/* VIEW: ACTIVE STRANGER CHAT */}
          {currentView === "stranger-chat" && (
            <div className="flex-1 flex flex-col h-full w-full max-w-5xl mx-auto bg-zinc-900 border-x border-zinc-800/80 shadow-2xl overflow-hidden">
              <ChatHeader
                onViewProfile={() => openUserProfile(strangerUserId)}
                onBack={handleExitStrangerChat}
                onSkip={handleNextStranger}
                onReport={() => setIsReportOpen(true)}
                onBlock={handleBlockStranger}
                status={strangerStatus}
                onToggleSidebar={() => setIsSidebarOpen((prev) => !prev)}
                onStartVideoCall={videoCall.startCall}
                isVideoCallActive={videoCall.callState === "connected" || videoCall.callState === "connecting"}
                isVideoCallDisabled={videoCall.callState !== "idle" || strangerStatus === "disconnected"}
              />

              {/* VIDEO CALL MODALS & OVERLAY */}
              {videoCall.callState === "calling" && (
                <CallingModal onCancel={videoCall.cancelCall} />
              )}

              {videoCall.callState === "incoming" && (
                <IncomingCallModal
                  onAccept={videoCall.acceptCall}
                  onDecline={videoCall.declineCall}
                />
              )}

              {/* VIDEO CALL ACTIVE: DEDICATED PRIMARY VIDEO MODE */}
              {(videoCall.callState === "connecting" || videoCall.callState === "connected" || videoCall.callState === "failed" || videoCall.connectionFailure?.failed) ? (
                <VideoCallOverlay
                  localStream={videoCall.localStream}
                  remoteStream={videoCall.remoteStream}
                  isMicMuted={videoCall.isMicMuted}
                  isCameraOff={videoCall.isCameraOff}
                  isRemoteCameraOff={videoCall.isRemoteCameraOff}
                  callState={videoCall.callState}
                  connectionFailure={videoCall.connectionFailure}
                  onRetryCall={videoCall.retryCall}
                  onDismissFailure={videoCall.dismissFailure}
                  strangerAvatar={viewProfile?.avatar || "👤"}
                  strangerUsername={viewProfile?.username || "Stranger"}
                  onToggleMute={videoCall.toggleMute}
                  onToggleCamera={videoCall.toggleCamera}
                  onEndCall={() => {
                    videoCall.endCall();
                    videoCall.dismissFailure();
                    setIsVideoChatOpen(false);
                    setUnreadVideoChatCount(0);
                  }}
                  isChatOpen={isVideoChatOpen}
                  onToggleChat={() => {
                    setIsVideoChatOpen((prev) => !prev);
                    setUnreadVideoChatCount(0);
                  }}
                  unreadChatCount={unreadVideoChatCount}
                >
                  {strangerChatBody}
                </VideoCallOverlay>
              ) : (
                /* NORMAL FULL-SIZE TEXT CHAT MODE */
                <div className="flex-1 flex flex-col min-h-0">
                  {/* Compatibility score */}
                  {matchScore !== null && (
                    <div className="text-center py-1.5 bg-zinc-950/80 text-xs font-semibold text-zinc-400 border-b border-zinc-800/80">
                      Match compatibility:{" "}
                      <span className="text-indigo-400 font-bold">{matchScore.toFixed(0)}%</span>
                    </div>
                  )}

                  {/* Add Friend Banner */}
                  <div className="px-4 py-2 border-b border-zinc-800/80 bg-zinc-950/60 flex items-center justify-between shrink-0">
                    {!friendRequestSent ? (
                      <button
                        onClick={sendFriendRequest}
                        disabled={!strangerUserId}
                        className="w-full bg-indigo-600 hover:bg-indigo-500 text-white py-1.5 rounded-xl text-xs font-semibold transition disabled:bg-zinc-800 disabled:text-zinc-500 disabled:cursor-not-allowed shadow-xs flex items-center justify-center gap-1.5"
                      >
                        <span>👥</span>
                        <span>Add Stranger as Friend</span>
                      </button>
                    ) : (
                      <div className="w-full text-center bg-emerald-950/50 border border-emerald-800/60 text-emerald-300 py-1.5 rounded-xl text-xs font-semibold">
                        ✓ Friend request sent
                      </div>
                    )}
                  </div>

                  {/* Full size message list and composer */}
                  {strangerChatBody}

                  {/* Action Footer: Next Stranger & End Chat */}
                  <div className="grid grid-cols-2 border-t border-zinc-800/90 divide-x divide-zinc-800/90 bg-zinc-900 shrink-0">
                    <button
                      onClick={handleNextStranger}
                      className="py-3 text-xs sm:text-sm font-semibold text-indigo-400 hover:bg-zinc-800 transition flex items-center justify-center gap-1.5"
                    >
                      <span>⏭️</span>
                      <span>Next Stranger</span>
                    </button>
                    <button
                      onClick={handleExitStrangerChat}
                      className="py-3 text-xs sm:text-sm font-semibold text-rose-400 hover:bg-zinc-800 transition flex items-center justify-center gap-1.5"
                    >
                      <span>✕</span>
                      <span>End Chat</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* VIEW: MAIN MATCHING SETUP SCREEN */}
          {currentView === "matching" && (
            <div className="flex-1 flex flex-col items-center justify-center p-4 sm:p-8">
              <div className="w-full max-w-lg bg-zinc-900/90 backdrop-blur-md border border-zinc-800/90 rounded-3xl p-6 sm:p-8 shadow-2xl text-zinc-100">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-600 text-white text-xl font-bold shadow-lg shadow-indigo-600/30">
                    ⚡
                  </span>
                </div>
                <h1 className="text-2xl sm:text-3xl font-extrabold text-white text-center tracking-tight">
                  Stranger Chat
                </h1>
                <p className="text-zinc-400 mt-1.5 text-center text-xs sm:text-sm">
                  Connect anonymously with people worldwide matching your interests.
                </p>

                {/* Friends & Requests shortcut banner */}
                <button
                  onClick={openFriends}
                  className="mt-6 w-full border border-zinc-800 bg-zinc-950/60 hover:bg-zinc-800 text-zinc-200 px-5 py-3 rounded-2xl text-xs font-semibold transition flex items-center justify-between"
                >
                  <div className="flex items-center gap-2.5">
                    <span>👥</span>
                    <span>Friends & Requests</span>
                  </div>
                  {friendRequests.length > 0 && (
                    <span className="px-2 py-0.5 rounded-full bg-rose-500 text-white text-[10px] font-bold">
                      {friendRequests.length} new
                    </span>
                  )}
                </button>

                {/* Language selection */}
                <div className="mt-5">
                  <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">
                    Language
                  </label>
                  <select
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    className="w-full border border-zinc-800 bg-zinc-950 rounded-2xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-indigo-500 transition"
                  >
                    <option>English</option>
                    <option>Hindi</option>
                    <option>Kannada</option>
                    <option>Telugu</option>
                    <option>Tamil</option>
                    <option>Spanish</option>
                  </select>
                </div>

                {/* Interests selection */}
                <div className="mt-5">
                  <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">
                    Interests
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {availableInterests.map((interest) => (
                      <button
                        key={interest}
                        type="button"
                        onClick={() => toggleInterest(interest)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition ${
                          interests.includes(interest)
                            ? "bg-indigo-600 text-white border-indigo-500 shadow-sm shadow-indigo-600/30"
                            : "bg-zinc-950 text-zinc-400 border-zinc-800 hover:border-zinc-700 hover:text-zinc-200"
                        }`}
                      >
                        #{interest}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Match Goal */}
                <div className="mt-5">
                  <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">
                    What are you looking for?
                  </label>
                  <select
                    value={goal}
                    onChange={(e) => setGoal(e.target.value)}
                    className="w-full border border-zinc-800 bg-zinc-950 rounded-2xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-indigo-500 transition"
                  >
                    <option value="casual-chat">Casual Chat</option>
                    <option value="friendship">Friendship</option>
                    <option value="learning">Language & Learning</option>
                    <option value="networking">Networking</option>
                  </select>
                </div>

                {/* Action / Matchmaking States */}
                {matchingMode === "idle" && !waiting ? (
                  <button
                    onClick={findStranger}
                    className="mt-6 w-full bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white px-6 py-3.5 rounded-2xl font-bold text-sm transition shadow-lg shadow-indigo-600/30 active:scale-98 flex items-center justify-center gap-2"
                  >
                    <span>⚡</span>
                    <span>Find a Stranger</span>
                  </button>
                ) : matchingMode === "no-one-live" ? (
                  /* PART 3: NO-LIVE-STRANGER EXPERIENCE */
                  <div className="mt-6 p-5 sm:p-6 rounded-2xl bg-zinc-950/80 border border-zinc-800 text-center space-y-4 animate-fadeIn">
                    <div className="w-12 h-12 rounded-2xl bg-indigo-600/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center text-2xl mx-auto">
                      😔
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-white">
                        No one is live right now
                      </h3>
                      <p className="mt-1.5 text-xs text-zinc-400 leading-relaxed max-w-sm mx-auto">
                        There isn&apos;t a stranger available at the moment. You can keep waiting for someone to come online, or discover people already on ChatBuddy.
                      </p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                      <button
                        type="button"
                        onClick={handleKeepWaiting}
                        className="w-full py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/30 transition flex items-center justify-center gap-2 active:scale-95"
                      >
                        <span>⏳</span>
                        <span>Keep Waiting</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => navigateTo("discover")}
                        className="w-full py-2.5 px-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 hover:text-white border border-zinc-700/60 text-xs font-semibold transition flex items-center justify-center gap-2 active:scale-95"
                      >
                        <span>🌟</span>
                        <span>Discover People</span>
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={handleCancelSearch}
                      className="text-xs text-zinc-500 hover:text-rose-400 transition"
                    >
                      Cancel Search
                    </button>
                  </div>
                ) : (
                  /* PART 4: KEEP WAITING / SEARCHING QUEUE STATE */
                  <div className="mt-6 text-center py-6 px-4 bg-zinc-950/80 rounded-2xl border border-zinc-800 space-y-3 animate-fadeIn">
                    <div className="relative w-12 h-12 mx-auto flex items-center justify-center">
                      <div className="absolute inset-0 rounded-full border-2 border-indigo-500/40 animate-ping" />
                      <div className="w-10 h-10 rounded-full bg-indigo-600/20 border border-indigo-500/40 text-indigo-400 flex items-center justify-center text-lg">
                        🔎
                      </div>
                    </div>
                    <div>
                      <p className="text-white font-bold text-sm">Looking for a stranger...</p>
                      <p className="mt-1 text-xs text-zinc-400">
                        You&apos;re in the matchmaking queue. We&apos;ll connect you automatically when someone becomes available.
                      </p>
                    </div>

                    {/* Real session elapsed timer */}
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-zinc-900 border border-zinc-800 text-xs font-mono font-semibold text-indigo-400">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                      <span>
                        Searching for {String(Math.floor(searchElapsedSeconds / 60)).padStart(2, "0")}:
                        {String(searchElapsedSeconds % 60).padStart(2, "0")}
                      </span>
                    </div>

                    <div className="pt-2 flex justify-center">
                      <button
                        type="button"
                        onClick={handleCancelSearch}
                        className="px-4 py-1.5 rounded-xl bg-zinc-800/80 hover:bg-zinc-700 text-zinc-400 hover:text-rose-400 text-xs font-medium border border-zinc-700/40 transition active:scale-95"
                      >
                        Cancel Search
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* PART 5: DIRECT MAIN-SCREEN ACCESS TO DISCOVER PEOPLE */}
              <div className="w-full max-w-lg mt-4 bg-zinc-900/80 backdrop-blur-md border border-zinc-800/80 hover:border-zinc-700/80 rounded-3xl p-5 sm:p-6 shadow-xl transition">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3.5">
                    <div className="w-11 h-11 rounded-2xl bg-indigo-600/15 border border-indigo-500/25 text-indigo-400 flex items-center justify-center text-xl shrink-0 mt-0.5">
                      🌟
                    </div>
                    <div>
                      <h2 className="text-sm font-bold text-white flex items-center gap-2">
                        <span>Discover People</span>
                        <span className="text-[10px] font-semibold text-emerald-400 bg-emerald-950/60 border border-emerald-800/40 px-2 py-0.5 rounded-full">
                          Community
                        </span>
                      </h2>
                      <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                        Looking for lasting connections? Browse real ChatBuddy members, search by interests, filter by gender or online status, and chat privately anytime.
                      </p>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => navigateTo("discover")}
                  className="mt-4 w-full py-2.5 px-4 rounded-2xl bg-zinc-800/90 hover:bg-zinc-700 text-zinc-100 hover:text-white border border-zinc-700/70 text-xs font-bold transition flex items-center justify-center gap-2 shadow-xs active:scale-98"
                >
                  <span>👥</span>
                  <span>Browse Registered Members</span>
                  <span className="text-zinc-400 text-[11px] font-normal">→</span>
                </button>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Edit Profile Modal */}
      <EditProfileModal
        isOpen={isEditProfileOpen}
        user={currentUserProfile}
        onClose={() => setIsEditProfileOpen(false)}
        onSave={(updatedProfile) => {
          setCurrentUserProfile(updatedProfile);
          showNotification("Profile updated successfully!");
        }}
      />

      {/* Report Modal */}
      <ReportModal
        isOpen={isReportOpen}
        onClose={() => setIsReportOpen(false)}
        onSubmit={handleReportSubmit}
      />

      {/* Global Incoming Friend Video Call Modal */}
      {globalIncomingFriendCall && currentView !== "friend-chat" && (
        <IncomingCallModal
          onAccept={handleAcceptGlobalIncomingCall}
          onDecline={handleDeclineGlobalIncomingCall}
          callerName={globalIncomingFriendCall.callerName}
          callerAvatar={globalIncomingFriendCall.callerAvatar}
        />
      )}

      {/* User Profile Viewing Modal */}
      <UserProfileModal user={viewProfile} onClose={() => setViewProfile(null)} />
    </div>
  );
}