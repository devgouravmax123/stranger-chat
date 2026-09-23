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
import { blobToDataUrl } from "@/lib/audioConverter";
import { CANONICAL_INTERESTS, CANONICAL_GOALS } from "@/lib/interests";
import { BACKEND_URL } from "@/lib/api-config";
import {
  clearIdentityKeys,
  syncIdentityKeyLifecycle,
  encryptTextMessage,
  decryptTextMessage,
  isE2EEMessageEnvelope,
  unpackE2EEMessage,
  clearConversationKeyCache,
  E2EEMessageEnvelope,
  E2EEMediaType,
  E2EEMediaEnvelope,
  isE2EEMediaEnvelope,
  packE2EEMedia,
  unpackE2EEMedia,
  encryptMediaBlob,
  decryptMediaEnvelope,
  MAX_E2EE_IMAGE_BYTES,
  MAX_E2EE_AUDIO_BYTES,
  MAX_VOICE_DURATION_SECONDS,
} from "@/lib/crypto";

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
  chatId: string;
  userId: string;
  strangerUserId: string;
  score: number;
  strangerProfile?: {
    id?: string;
    username?: string | null;
    avatar?: string | null;
    publicKey?: string | null;
  } | null;
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
  publicKey?: string | null;
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

function getPersistedAuth(): { token: string | null; userId: string | null } {
  if (typeof window === "undefined") return { token: null, userId: null };
  const token =
    localStorage.getItem("sc_auth_token") ||
    sessionStorage.getItem("sc_session_token") ||
    localStorage.getItem("sc_session_token");
  const userId =
    localStorage.getItem("sc_auth_user_id") ||
    localStorage.getItem("sc_last_user_id") ||
    sessionStorage.getItem("sc_user_id") ||
    sessionStorage.getItem("sc_session_user_id");
  return { token, userId };
}

function savePersistedAuth(token: string, userId: string) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem("sc_auth_token", token);
    localStorage.setItem("sc_auth_user_id", userId);
    localStorage.setItem("sc_last_user_id", userId);
    sessionStorage.setItem("sc_session_token", token);
    sessionStorage.setItem("sc_session_user_id", userId);
    sessionStorage.setItem("sc_user_id", userId);
  } catch (err) {
    console.warn("Could not save persisted auth:", err);
  }
}

function clearPersistedAuth() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem("sc_auth_token");
    localStorage.removeItem("sc_auth_user_id");
    localStorage.removeItem("sc_last_user_id");
    localStorage.removeItem("sc_session_token");
    localStorage.removeItem("sc_user_id");
    localStorage.removeItem("sc_session_user_id");
    sessionStorage.removeItem("sc_session_token");
    sessionStorage.removeItem("sc_session_user_id");
    sessionStorage.removeItem("sc_user_id");
  } catch (err) {
    console.warn("Could not clear persisted auth:", err);
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
  const [authBootstrapped, setAuthBootstrapped] = useState(false);
  const [isAccountDeleted, setIsAccountDeleted] = useState(false);
  const isAccountDeletedRef = useRef(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

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
  const [savingPreferences, setSavingPreferences] = useState(false);

  const availableInterests = CANONICAL_INTERESTS;

  // ==========================================
  // STRANGER CHAT STATE
  // ==========================================

  const [waiting, setWaiting] = useState(false);
  const [matchingMode, setMatchingMode] = useState<"idle" | "searching" | "no-one-live" | "keep-waiting">("idle");
  const [searchElapsedSeconds, setSearchElapsedSeconds] = useState(0);
  const searchTimerRef = useRef<NodeJS.Timeout | null>(null);
  const noLiveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const [strangerRoomId, setStrangerRoomId] = useState<string | null>(null);
  const [strangerChatId, setStrangerChatId] = useState<string | null>(null);
  const [strangerUserId, setStrangerUserId] = useState<string | null>(null);
  const [matchScore, setMatchScore] = useState<number | null>(null);
  const [strangerStatus, setStrangerStatus] = useState<
    "online" | "disconnected" | "connecting"
  >("connecting");
  const [strangerTyping, setStrangerTyping] = useState(false);

  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);

  // Object URL memory management registry
  const objectUrlRegistryRef = useRef<Set<string>>(new Set());

  const registerObjectUrl = useCallback((url: string): string => {
    if (url && url.startsWith("blob:")) {
      objectUrlRegistryRef.current.add(url);
    }
    return url;
  }, []);

  const revokeSingleObjectUrl = useCallback((url: string | undefined | null) => {
    if (url && url.startsWith("blob:") && objectUrlRegistryRef.current.has(url)) {
      try {
        URL.revokeObjectURL(url);
      } catch {}
      objectUrlRegistryRef.current.delete(url);
    }
  }, []);

  const revokeAllObjectUrls = useCallback(() => {
    objectUrlRegistryRef.current.forEach((url) => {
      try {
        URL.revokeObjectURL(url);
      } catch {}
    });
    objectUrlRegistryRef.current.clear();
  }, []);

  // Cleanup all object URLs when Home component unmounts
  useEffect(() => {
    return () => {
      revokeAllObjectUrls();
    };
  }, [revokeAllObjectUrls]);

  // Stranger friend request state
  const [friendRequestSent, setFriendRequestSent] = useState(false);
  const [friendRequestMessage, setFriendRequestMessage] = useState("");
  const [isSendingFriendRequest, setIsSendingFriendRequest] = useState(false);
  const [isAlreadyFriend, setIsAlreadyFriend] = useState(false);

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

  const strangerChatIdRef = useRef<string | null>(null);
  strangerChatIdRef.current = strangerChatId;

  const strangerStatusRef = useRef<"online" | "disconnected" | "connecting">(strangerStatus);
  strangerStatusRef.current = strangerStatus;

  const [strangerPublicKey, setStrangerPublicKey] = useState<string | null>(null);
  const strangerPublicKeyRef = useRef<string | null>(null);
  strangerPublicKeyRef.current = strangerPublicKey;

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
    chatType: "stranger",
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
    chatType: "friend",
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

  const videoCallTeardownRef = useRef(videoCall.teardownCall);
  videoCallTeardownRef.current = videoCall.teardownCall;

  const friendVideoCallTeardownRef = useRef(friendVideoCall.teardownCall);
  friendVideoCallTeardownRef.current = friendVideoCall.teardownCall;

  const socketRef = useRef<Socket | null>(null);
  socketRef.current = socket;

  const navigateTo = useCallback(
    (view: AppView, pushToHistory = true) => {
      // If leaving stranger chat or friend chat, safely tear down any active video calls
      if (view !== "stranger-chat") {
        videoCallTeardownRef.current?.();
      }
      if (view !== "friend-chat") {
        friendVideoCallTeardownRef.current?.();
      }

      // If entering stranger-chat, mark any pending stranger notifications as read
      if (view === "stranger-chat") {
        setNotifications((prev) => {
          const strangerNotifs = prev.filter((n) => n.type === "STRANGER_MESSAGE" && !n.isRead);
          if (strangerNotifs.length > 0) {
            setUnreadNotificationsCount((c) => Math.max(0, c - strangerNotifs.length));
            return prev.map((n) => (n.type === "STRANGER_MESSAGE" ? { ...n, isRead: true } : n));
          }
          return prev;
        });

        if (socketRef.current && strangerRoomIdRef.current) {
          setMessages((prev) => {
            const unreadIds = prev
              .filter((m) => m.sender === "stranger" && m.id && m.status !== "seen")
              .map((m) => m.id as string);
            if (unreadIds.length > 0 && socketRef.current) {
              socketRef.current.emit("mark_seen", {
                roomId: strangerRoomIdRef.current,
                messageIds: unreadIds,
              });
            }
            return prev;
          });
        }
      }

      setCurrentView(view);
      if (typeof window !== "undefined" && pushToHistory) {
        window.history.pushState({ view }, "", `?view=${view}`);
      }
    },
    []
  );

  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      if (event.state && event.state.view) {
        const targetView = event.state.view as AppView;
        if (currentView === "stranger-chat" && targetView !== "stranger-chat") {
          // Leaving stranger chat view via browser back:
          // Safely tear down any active video call, but PRESERVE active stranger room and chat session
          videoCall.teardownCall();
          setIsVideoChatOpen(false);
          setUnreadVideoChatCount(0);
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
  // SESSION BOOTSTRAP (VERIFY PERSISTED AUTH)
  // ==========================================

  useEffect(() => {
    let isCancelled = false;
    let timerId: NodeJS.Timeout | null = null;

    async function bootstrapSession() {
      if (isAccountDeletedRef.current) return;
      const startTime = Date.now();
      const { token: storedToken } = getPersistedAuth();

      if (storedToken) {
        try {
          const verifyRes = await fetch(`${BACKEND_URL}/users/me`, {
            headers: {
              Authorization: `Bearer ${storedToken}`,
            },
          });

          if (isAccountDeletedRef.current) return;

          if (verifyRes.ok) {
            const userProfile = await verifyRes.json();
            if (userProfile && userProfile.id && !isCancelled && !isAccountDeletedRef.current) {
              setUserId(userProfile.id);
              userIdRef.current = userProfile.id;
              savePersistedAuth(storedToken, userProfile.id);

              if (userProfile.username) {
                setCurrentUserProfile(userProfile);
                setProfileCompleted(true);
                setCurrentView("matching");
                if (userProfile.language) setLanguage(userProfile.language);
                if (userProfile.interests && Array.isArray(userProfile.interests)) setInterests(userProfile.interests);
                if (userProfile.goal) setGoal(userProfile.goal);

                // E2EE Phase 2: Sync identity key lifecycle for returning authenticated user
                syncIdentityKeyLifecycle(userProfile.publicKey, storedToken, BACKEND_URL).catch((syncErr) => {
                  console.warn("[E2EE] Bootstrap identity key sync warning:", syncErr);
                });
              } else {
                setProfileCompleted(false);
                setCurrentView("profile-setup");
              }
            }
          } else if (verifyRes.status === 401 || verifyRes.status === 404) {
            // Token is expired or user was deleted from DB -> clear invalid stored auth
            clearPersistedAuth();
            if (!isCancelled && !isAccountDeletedRef.current) {
              setProfileCompleted(false);
              setCurrentView("profile-setup");
            }
          }
        } catch (err) {
          console.warn("Session verification warning:", err);
        }
      }

      const completeBootstrap = () => {
        if (!isCancelled && !isAccountDeletedRef.current) {
          setAuthBootstrapped(true);
        }
      };

      // For fresh visitors (no stored token), ensure the branded Chirp loading screen
      // displays for a minimum of ~2.0 seconds before transitioning to Profile Setup.
      // If returning user with valid token, transition immediately when ready.
      if (!storedToken) {
        const elapsed = Date.now() - startTime;
        const remainingDelay = Math.max(0, 2000 - elapsed);
        if (remainingDelay > 0) {
          timerId = setTimeout(completeBootstrap, remainingDelay);
        } else {
          completeBootstrap();
        }
      } else {
        completeBootstrap();
      }
    }

    bootstrapSession();

    return () => {
      isCancelled = true;
      if (timerId) {
        clearTimeout(timerId);
      }
    };
  }, [sessionKey]);

  // ==========================================
  // SOCKET INITIALIZATION & LIFECYCLE
  // ==========================================

  useEffect(() => {
    if (!authBootstrapped || isAccountDeletedRef.current) return;

    const { token: currentToken, userId: currentUserId } = getPersistedAuth();

    const newSocket = io(BACKEND_URL, {
      auth: { userId: currentUserId, token: currentToken },
    });

    setSocket(newSocket);

      // ==========================================
      // USER READY & SESSION
      // ==========================================

    newSocket.on("user_ready", async (data: UserReadyData & { token?: string }) => {
      if (isAccountDeletedRef.current) return;
      setUserId(data.userId);
      userIdRef.current = data.userId;

      if (data.token) {
        savePersistedAuth(data.token, data.userId);
      } else if (currentToken) {
        savePersistedAuth(currentToken, data.userId);
      }

      newSocket.emit("friend_online", { userId: data.userId });

        // Load persistent notifications for user
        try {
          const [resNotifs, resCount] = await Promise.all([
            fetch(`${BACKEND_URL}/notifications/${data.userId}`),
            fetch(`${BACKEND_URL}/notifications/${data.userId}/unread-count`),
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
          const res = await fetch(`${BACKEND_URL}/users/${data.userId}/profile`);
          if (res.ok) {
            const profile = await res.json();
            if (profile && profile.username) {
              setCurrentUserProfile(profile);
              setProfileCompleted(true);
              setCurrentView((prev) => (prev === "profile-setup" ? "matching" : prev));
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

      // Handle socket-level auth error (e.g., token rejected by gateway)
      newSocket.on("auth_error", () => {
        console.warn("Socket auth rejected, resetting credentials");
        clearPersistedAuth();
        setCheckingProfile(false);
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
      setStrangerChatId(data.chatId);
      strangerChatIdRef.current = data.chatId;
      setStrangerUserId(data.strangerUserId);
      const peerKey = data.strangerProfile?.publicKey || null;
      setStrangerPublicKey(peerKey);
      strangerPublicKeyRef.current = peerKey;
      setMatchScore(data.score);
      setStrangerStatus("online");
      setStrangerTyping(false);

      // Check if stranger is already a friend or has pending request
      const isFriend = friends.some((f) => f.friend.id === data.strangerUserId);
      const hasPending = friendRequests.some(
        (r) => (r.senderId === data.strangerUserId || r.receiverId === data.strangerUserId) && r.status === "PENDING"
      );
      setIsAlreadyFriend(isFriend);
      setFriendRequestSent(hasPending);
      setIsSendingFriendRequest(false);
      setFriendRequestMessage("");

      // Fetch fresh friends & requests in background
      if (data.userId) {
        fetch(`${BACKEND_URL}/friends/${data.userId}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((freshFriends: Friendship[] | null) => {
            if (freshFriends) {
              setFriends(freshFriends);
              if (freshFriends.some((f) => f.friend.id === data.strangerUserId)) {
                setIsAlreadyFriend(true);
              }
            }
          })
          .catch(() => {});

        fetch(`${BACKEND_URL}/friends/requests/${data.userId}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((freshRequests: FriendRequest[] | null) => {
            if (freshRequests) {
              setFriendRequests(freshRequests);
              if (freshRequests.some((r) => (r.senderId === data.strangerUserId || r.receiverId === data.strangerUserId) && r.status === "PENDING")) {
                setFriendRequestSent(true);
              }
            }
          })
          .catch(() => {});
      }

      setMessages([]);
      setReplyingTo(null);
      navigateTo("stranger-chat");
    });

    newSocket.on("chat_history", async (data: { messages: any[]; userId: string }) => {
      const currentUserId = userIdRef.current || data.userId;
      const activeChatId = strangerChatIdRef.current;
      const peerKey = strangerPublicKeyRef.current;

      if (Array.isArray(data?.messages)) {
        const history: Message[] = await Promise.all(
          data.messages.map(async (item: any) => {
            let textContent = item.text || "";
            let itemType = item.type || "text";
            let audioUrl = item.audioUrl;
            let imageUrl = item.imageUrl;

            // Check if message content is an E2EE envelope
            if (item.envelope) {
              if (activeChatId && peerKey) {
                try {
                  if (isE2EEMediaEnvelope(item.envelope)) {
                    const decryptedBlob = await decryptMediaEnvelope(
                      item.envelope,
                      activeChatId,
                      item.senderId,
                      peerKey
                    );
                    const objectUrl = registerObjectUrl(URL.createObjectURL(decryptedBlob));
                    itemType = item.envelope.type;
                    if (item.envelope.type === "image") {
                      imageUrl = objectUrl;
                      textContent = "Photo message";
                    } else {
                      audioUrl = objectUrl;
                      textContent = "Voice message";
                    }
                  } else {
                    const envStr = JSON.stringify(item.envelope);
                    textContent = await decryptTextMessage(
                      envStr,
                      activeChatId,
                      item.senderId,
                      peerKey
                    );
                    itemType = "text";
                  }
                } catch (decErr) {
                  console.warn("[E2EE] Failed to decrypt stranger history message:", decErr);
                  textContent = item.envelope.type === "image" ? "Unable to decrypt this photo" : "Unable to decrypt this message";
                }
              } else {
                textContent = item.envelope.type === "image" ? "Unable to decrypt this photo" : "Unable to decrypt this message";
              }
            } else if (typeof item.content === "string") {
              const unpackedMedia = unpackE2EEMedia(item.content);
              const unpackedText = !unpackedMedia ? unpackE2EEMessage(item.content) : null;

              if (activeChatId && peerKey) {
                try {
                  if (unpackedMedia) {
                    const decryptedBlob = await decryptMediaEnvelope(
                      unpackedMedia,
                      activeChatId,
                      item.senderId,
                      peerKey
                    );
                    const objectUrl = registerObjectUrl(URL.createObjectURL(decryptedBlob));
                    itemType = unpackedMedia.type;
                    if (unpackedMedia.type === "image") {
                      imageUrl = objectUrl;
                      textContent = "Photo message";
                    } else {
                      audioUrl = objectUrl;
                      textContent = "Voice message";
                    }
                  } else if (unpackedText) {
                    textContent = await decryptTextMessage(
                      item.content,
                      activeChatId,
                      item.senderId,
                      peerKey
                    );
                    itemType = "text";
                  }
                } catch (decErr) {
                  console.warn("[E2EE] Failed to decrypt stranger history content:", decErr);
                  textContent = "Unable to decrypt this message";
                }
              } else if (unpackedMedia || unpackedText) {
                textContent = "Unable to decrypt this message";
              }
            }

            // Also check replyTo preview if present
            let replyToPayload = item.replyTo;
            if (replyToPayload) {
              if (replyToPayload.content) {
                const unpackedMediaReply = unpackE2EEMedia(replyToPayload.content);
                const unpackedTextReply = !unpackedMediaReply ? unpackE2EEMessage(replyToPayload.content) : null;
                if ((unpackedMediaReply || unpackedTextReply) && activeChatId && peerKey) {
                  try {
                    if (unpackedMediaReply) {
                      replyToPayload = {
                        ...replyToPayload,
                        text: unpackedMediaReply.type === "image" ? "Encrypted photo" : "Encrypted voice note",
                        type: unpackedMediaReply.type,
                      };
                    } else {
                      const decryptedReply = await decryptTextMessage(
                        replyToPayload.content,
                        activeChatId,
                        replyToPayload.senderId || (replyToPayload.sender === "me" ? currentUserId : data.userId),
                        peerKey
                      );
                      replyToPayload = { ...replyToPayload, text: decryptedReply };
                    }
                  } catch {
                    replyToPayload = { ...replyToPayload, text: "Encrypted reply" };
                  }
                }
              }
            }

            return {
              id: item.id,
              text: textContent,
              sender: item.sender || (item.senderId === currentUserId ? "me" : "stranger"),
              timestamp: typeof item.createdAt === "string" ? new Date(item.createdAt).getTime() : (item.createdAt ? new Date(item.createdAt).getTime() : (item.timestamp || Date.now())),
              type: itemType as 'text' | 'image' | 'audio',
              audioUrl,
              imageUrl,
              status: item.status || "delivered",
              replyTo: replyToPayload,
              deletedAt: item.deletedAt,
              reactions: item.reactions || [],
            };
          })
        );

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

    const handleStrangerDisconnection = (noticeMsg = "Stranger disconnected.") => {
      // 1. Immediately tear down any active WebRTC video call
      videoCallTeardownRef.current?.();
      setIsVideoChatOpen(false);
      setUnreadVideoChatCount(0);

      // 2. Clear matching timers & crypto key cache
      clearMatchingTimers();
      clearConversationKeyCache();
      setStrangerPublicKey(null);
      strangerPublicKeyRef.current = null;

      // 3. Clear active stranger chat state
      setMessages([]);
      setReplyingTo(null);
      setStrangerTyping(false);
      setMatchScore(null);
      setStrangerRoomId(null);
      strangerRoomIdRef.current = null;
      setStrangerChatId(null);
      strangerChatIdRef.current = null;
      setStrangerUserId(null);
      setFriendRequestSent(false);
      setFriendRequestMessage("");
      setIsSendingFriendRequest(false);
      setIsAlreadyFriend(false);
      setMessage("");
      setViewProfile(null);
      setWaiting(false);
      setMatchingMode("idle");
      setSearchElapsedSeconds(0);
      setStrangerStatus("disconnected");

      // 4. Clear pending stranger notifications
      setNotifications((prev) => {
        const remaining = prev.filter((n) => n.type !== "STRANGER_MESSAGE");
        const diff = prev.length - remaining.length;
        if (diff > 0) setUnreadNotificationsCount((c) => Math.max(0, c - diff));
        return remaining;
      });

      // 5. Show toast notification
      showNotification(noticeMsg);

      // 6. If currently on stranger-chat view, return to Find Stranger matching home state
      if (currentViewRef.current === "stranger-chat") {
        navigateTo("matching");
      }
    };

    newSocket.on("stranger_offline", (data?: { roomId?: string }) => {
      if (!strangerRoomIdRef.current) return;
      if (data?.roomId && data.roomId !== strangerRoomIdRef.current) return;
      handleStrangerDisconnection("Stranger disconnected.");
    });

    newSocket.on("stranger_left", (data?: { roomId?: string }) => {
      if (!strangerRoomIdRef.current) return;
      if (data?.roomId && data.roomId !== strangerRoomIdRef.current) return;
      handleStrangerDisconnection("Stranger disconnected.");
    });

    newSocket.on("stranger_skipped", (data?: { roomId?: string }) => {
      if (!strangerRoomIdRef.current) return;
      if (data?.roomId && data.roomId !== strangerRoomIdRef.current) return;
      if (strangerStatusRef.current === "disconnected") return;

      setStrangerStatus("disconnected");
      setStrangerRoomId(null);
      strangerRoomIdRef.current = null;
      setStrangerChatId(null);
      strangerChatIdRef.current = null;
      showNotification("Stranger skipped to the next person.");

      // Clear any pending stranger notifications for this ended chat
      setNotifications((prev) => {
        const remaining = prev.filter((n) => n.type !== "STRANGER_MESSAGE");
        const diff = prev.length - remaining.length;
        if (diff > 0) setUnreadNotificationsCount((c) => Math.max(0, c - diff));
        return remaining;
      });
    });

    newSocket.on("stranger_blocked", (data?: { roomId?: string }) => {
      if (!strangerRoomIdRef.current) return;
      if (data?.roomId && data.roomId !== strangerRoomIdRef.current) return;

      setStrangerStatus("disconnected");
      setStrangerRoomId(null);
      strangerRoomIdRef.current = null;
      setStrangerChatId(null);
      strangerChatIdRef.current = null;
      showNotification("Stranger has been blocked.");

      // Clear any pending stranger notifications for this ended chat
      setNotifications((prev) => {
        const remaining = prev.filter((n) => n.type !== "STRANGER_MESSAGE");
        const diff = prev.length - remaining.length;
        if (diff > 0) setUnreadNotificationsCount((c) => Math.max(0, c - diff));
        return remaining;
      });

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

    newSocket.on("voice_message_error", (data: { clientId?: string; message?: string }) => {
      showNotification(data.message || "Voice note couldn't be sent. Please try again.");
    });

    newSocket.on(
      "receive_message",
      async (data: {
        id: string;
        clientId?: string;
        text?: string;
        envelope?: E2EEMessageEnvelope | E2EEMediaEnvelope;
        senderId: string;
        timestamp: number;
        type?: "text" | "audio" | "image";
        audioUrl?: string;
        imageUrl?: string;
        status?: "sending" | "sent" | "delivered" | "seen";
        replyTo?: {
          id: string;
          content?: string;
          text?: string;
          type?: "text" | "audio" | "image";
        } | null;
      }) => {
        let msgType = data.type || "text";
        let audioUrl = data.audioUrl;
        let imageUrl = data.imageUrl;
        let displayText = data.text || "";

        // Handle E2EE envelope decryption
        if (data.envelope) {
          const activeChatId = strangerChatIdRef.current;
          let peerKey = strangerPublicKeyRef.current;

          // Fallback: if stranger public key not yet in ref, fetch profile
          if (!peerKey && data.senderId) {
            try {
              const pRes = await fetch(`${BACKEND_URL}/users/${data.senderId}/profile`);
              if (pRes.ok) {
                const pData = await pRes.json();
                if (pData?.publicKey) {
                  peerKey = pData.publicKey;
                  setStrangerPublicKey(pData.publicKey);
                  strangerPublicKeyRef.current = pData.publicKey;
                }
              }
            } catch {}
          }

          if (activeChatId && peerKey) {
            try {
              if (isE2EEMediaEnvelope(data.envelope)) {
                const decryptedBlob = await decryptMediaEnvelope(
                  data.envelope,
                  activeChatId,
                  data.senderId,
                  peerKey
                );
                const objectUrl = registerObjectUrl(URL.createObjectURL(decryptedBlob));
                msgType = data.envelope.type;
                if (data.envelope.type === "image") {
                  imageUrl = objectUrl;
                  displayText = "Photo message";
                } else {
                  audioUrl = objectUrl;
                  displayText = "Voice message";
                }
              } else if (isE2EEMessageEnvelope(data.envelope)) {
                const envStr = JSON.stringify(data.envelope);
                displayText = await decryptTextMessage(
                  envStr,
                  activeChatId,
                  data.senderId,
                  peerKey
                );
                msgType = "text";
              }
            } catch (decErr) {
              console.warn("[E2EE] Failed to decrypt stranger message:", decErr);
              msgType = isE2EEMediaEnvelope(data.envelope) ? data.envelope.type : "text";
              displayText = isE2EEMediaEnvelope(data.envelope)
                ? data.envelope.type === "image"
                  ? "Unable to decrypt this photo"
                  : "Unable to decrypt this voice message"
                : "Unable to decrypt this message";
            }
          } else {
            msgType = isE2EEMediaEnvelope(data.envelope) ? data.envelope.type : "text";
            displayText = isE2EEMediaEnvelope(data.envelope)
              ? data.envelope.type === "image"
                ? "Unable to decrypt this photo"
                : "Unable to decrypt this voice message"
              : "Unable to decrypt this message";
          }
        }

        // Handle replyTo text if envelope
        let processedReplyTo: { id: string; text: string; type?: "text" | "audio" | "image" } | null = null;
        if (data.replyTo) {
          let replyText = data.replyTo.text || "";
          if (data.replyTo.content) {
            const unpackedMediaReply = unpackE2EEMedia(data.replyTo.content);
            const unpackedTextReply = !unpackedMediaReply ? unpackE2EEMessage(data.replyTo.content) : null;
            if ((unpackedMediaReply || unpackedTextReply) && strangerChatIdRef.current && strangerPublicKeyRef.current) {
              try {
                if (unpackedMediaReply) {
                  replyText = unpackedMediaReply.type === "image" ? "Encrypted photo" : "Encrypted voice note";
                } else {
                  replyText = await decryptTextMessage(
                    data.replyTo.content,
                    strangerChatIdRef.current,
                    data.senderId,
                    strangerPublicKeyRef.current
                  );
                }
              } catch {
                replyText = "Encrypted reply";
              }
            } else {
              replyText = data.replyTo.content;
            }
          }
          processedReplyTo = {
            id: data.replyTo.id,
            text: replyText,
            type: data.replyTo.type,
          };
        }

        const isAudio = msgType === "audio";
        const isImage = msgType === "image";

        const newMsg: Message = {
          id: data.id,
          clientId: data.clientId,
          text: isImage
            ? displayText || "Photo message"
            : isAudio
            ? "Voice message"
            : displayText,
          sender: data.senderId === userIdRef.current ? "me" : "stranger",
          timestamp: data.timestamp,
          type: msgType as "text" | "audio" | "image",
          audioUrl,
          imageUrl,
          status: "delivered",
          replyTo: processedReplyTo,
        };

        setMessages((prev) => {
          if (data.clientId) {
            const exists = prev.some((m) => m.clientId === data.clientId);
            if (exists) {
              return prev.map((m) =>
                m.clientId === data.clientId
                  ? {
                      ...m,
                      id: data.id,
                      status: "delivered",
                      timestamp: data.timestamp,
                      audioUrl: m.audioUrl || audioUrl,
                      imageUrl: m.imageUrl || imageUrl,
                    }
                  : m
              );
            }
          }
          return [...prev, newMsg];
        });

        // If in video call and chat panel is closed, increment unread counter
        if (isVideoCallActiveRef.current && !isVideoChatOpenRef.current) {
          setUnreadVideoChatCount((prev) => prev + 1);
        }

        if (currentViewRef.current === "stranger-chat") {
          // Acknowledge seen immediately when active inside stranger-chat
          newSocket.emit("mark_seen", {
            roomId: strangerRoomIdRef.current || undefined,
            messageIds: [data.id],
          });
        } else {
          // User is elsewhere in Chirp (Discover, Friends, Profile, etc.):
          // Create an in-app notification in the notification bell and alert the user
          const previewText = isImage
            ? "📷 Sent a photo"
            : isAudio
            ? "🎤 Sent a voice message"
            : (displayText || "Sent a message");

          const newNotifItem: AppNotification = {
            id: `stranger-msg-${data.id || Date.now()}`,
            type: "STRANGER_MESSAGE",
            title: "Stranger",
            body: previewText,
            data: JSON.stringify({
              view: "stranger-chat",
              roomId: strangerRoomIdRef.current || "",
              strangerUserId: strangerUserId || "",
            }),
            isRead: false,
            createdAt: new Date().toISOString(),
          };

          setNotifications((prev) => [newNotifItem, ...prev]);
          setUnreadNotificationsCount((prev) => prev + 1);
          showNotification(`💬 Stranger: ${previewText}`);
        }
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
        prev.map((msg) => {
          if (msg.id === data.messageId) {
            if (msg.imageUrl) revokeSingleObjectUrl(msg.imageUrl);
            if (msg.audioUrl) revokeSingleObjectUrl(msg.audioUrl);
            return { ...msg, deletedAt: new Date().toISOString() };
          }
          return msg;
        })
      );

      setFriendMessages((prev) =>
        prev.map((msg) => {
          if (msg.id === data.messageId) {
            if (msg.imageUrl) revokeSingleObjectUrl(msg.imageUrl);
            if (msg.audioUrl) revokeSingleObjectUrl(msg.audioUrl);
            return { ...msg, deletedAt: new Date().toISOString() };
          }
          return msg;
        })
      );
    });

    // ==========================================
    // IN-APP NOTIFICATIONS REAL-TIME
    // ==========================================

    newSocket.on("new_notification", (notif: any) => {
      if (!notif || typeof notif !== "object" || typeof notif.type !== "string") {
        return;
      }

      // Determine if this message belongs to the currently active, visible conversation
      let parsedData: any = null;
      if (typeof notif.data === "object") {
        parsedData = notif.data;
      } else if (typeof notif.data === "string") {
        try {
          parsedData = JSON.parse(notif.data);
        } catch {}
      }

      const isCurrentFriendChatOpen =
        currentViewRef.current === "friend-chat" &&
        Boolean(
          (parsedData?.friendId && selectedFriendRef.current?.id === parsedData.friendId) ||
          (parsedData?.chatId && friendChatIdRef.current === parsedData.chatId) ||
          (parsedData?.roomId && friendRoomIdRef.current === parsedData.roomId)
        );

      const isCurrentStrangerChatOpen =
        currentViewRef.current === "stranger-chat" &&
        Boolean(parsedData?.roomId && strangerRoomIdRef.current === parsedData.roomId);

      const isActiveOpenConversation =
        notif.type === "NEW_MESSAGE" && (isCurrentFriendChatOpen || isCurrentStrangerChatOpen);

      // Add to notifications list: if active open conversation, mark already read
      const newNotifItem = {
        id: notif.id || `temp-${Date.now()}`,
        type: notif.type,
        title: notif.title || "Notification",
        body: notif.body || "",
        data: typeof notif.data === "object" ? JSON.stringify(notif.data) : notif.data,
        isRead: isActiveOpenConversation,
        createdAt: notif.createdAt || new Date().toISOString(),
      };

      setNotifications((prev) => [newNotifItem, ...prev]);

      if (isActiveOpenConversation) {
        // Active conversation: user is already reading it in real time
        // Persist read state in DB if not a temporary ID
        if (notif.id && !notif.id.startsWith("temp-") && userIdRef.current) {
          fetch(`${BACKEND_URL}/notifications/${notif.id}/read`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId: userIdRef.current }),
          }).catch(() => {});
        }
      } else {
        // Different conversation or user is on another screen: increment unread & display toast
        setUnreadNotificationsCount((prev) => prev + 1);
        showNotification(`🔔 ${notif.title || "Alert"}: ${notif.body || ""}`);
      }

      if (userIdRef.current) {
        if (notif.type === "FRIEND_REQUEST") {
          fetch(`${BACKEND_URL}/friends/requests/${userIdRef.current}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => {
              if (data) setFriendRequests(data);
            })
            .catch(() => {});
        } else if (notif.type === "FRIEND_ACCEPTED") {
          fetch(`${BACKEND_URL}/friends/${userIdRef.current}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => {
              if (data) setFriends(data);
            })
            .catch(() => {});
        }
      }
    });

    newSocket.on(
      "notifications_read",
      (data: { readIds?: string[]; unreadCount: number }) => {
        if (data.readIds && data.readIds.length > 0) {
          const idSet = new Set(data.readIds);
          setNotifications((prev) =>
            prev.map((n) => (idSet.has(n.id) ? { ...n, isRead: true } : n))
          );
        } else {
          setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
        }
        if (typeof data.unreadCount === "number") {
          setUnreadNotificationsCount(data.unreadCount);
        }
      }
    );

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

    newSocket.on("friend_room_opened", async (data: any) => {
      setFriendRoomId(data.roomId);
      if (data.chatId) {
        setFriendChatId(data.chatId);
      }
      const currentUserId = userIdRef.current;
      const activeChatId = data.chatId || friendChatIdRef.current;
      let peerKey = selectedFriendRef.current?.publicKey || null;

      // Fallback: if peerKey is missing on selectedFriend, fetch friend profile
      if (!peerKey && selectedFriendRef.current?.id) {
        try {
          const pRes = await fetch(`${BACKEND_URL}/users/${selectedFriendRef.current.id}/profile`);
          if (pRes.ok) {
            const pData = await pRes.json();
            if (pData?.publicKey) {
              peerKey = pData.publicKey;
              setSelectedFriend((prev) => (prev ? { ...prev, publicKey: pData.publicKey } : prev));
            }
          }
        } catch {}
      }

      const history: Message[] = await Promise.all(
        (data.messages || []).map(async (item: any) => {
          // Handle pre-formatted message object (from getFormattedMessages)
          if (item.type || item.text || item.envelope) {
            let textContent = item.text || "";
            let itemType = item.type || "text";
            let audioUrl = item.audioUrl;
            let imageUrl = item.imageUrl;

            if (item.envelope) {
              if (activeChatId && peerKey) {
                try {
                  if (isE2EEMediaEnvelope(item.envelope)) {
                    const decryptedBlob = await decryptMediaEnvelope(
                      item.envelope,
                      activeChatId,
                      item.senderId,
                      peerKey
                    );
                    const objectUrl = registerObjectUrl(URL.createObjectURL(decryptedBlob));
                    itemType = item.envelope.type;
                    if (item.envelope.type === "image") {
                      imageUrl = objectUrl;
                      textContent = "Photo message";
                    } else {
                      audioUrl = objectUrl;
                      textContent = "Voice message";
                    }
                  } else {
                    const envStr = JSON.stringify(item.envelope);
                    textContent = await decryptTextMessage(
                      envStr,
                      activeChatId,
                      item.senderId,
                      peerKey
                    );
                    itemType = "text";
                  }
                } catch (decErr) {
                  console.warn("[E2EE] Failed to decrypt friend room history message:", decErr);
                  textContent = isE2EEMediaEnvelope(item.envelope)
                    ? item.envelope.type === "image"
                      ? "Unable to decrypt this photo"
                      : "Unable to decrypt this voice message"
                    : "Unable to decrypt this message";
                }
              } else {
                textContent = isE2EEMediaEnvelope(item.envelope)
                  ? item.envelope.type === "image"
                    ? "Unable to decrypt this photo"
                    : "Unable to decrypt this voice message"
                  : "Unable to decrypt this message";
              }
            } else if (typeof item.content === "string") {
              const unpackedMedia = unpackE2EEMedia(item.content);
              const unpackedText = !unpackedMedia ? unpackE2EEMessage(item.content) : null;

              if (activeChatId && peerKey) {
                try {
                  if (unpackedMedia) {
                    const decryptedBlob = await decryptMediaEnvelope(
                      unpackedMedia,
                      activeChatId,
                      item.senderId,
                      peerKey
                    );
                    const objectUrl = registerObjectUrl(URL.createObjectURL(decryptedBlob));
                    itemType = unpackedMedia.type;
                    if (unpackedMedia.type === "image") {
                      imageUrl = objectUrl;
                      textContent = "Photo message";
                    } else {
                      audioUrl = objectUrl;
                      textContent = "Voice message";
                    }
                  } else if (unpackedText) {
                    textContent = await decryptTextMessage(
                      item.content,
                      activeChatId,
                      item.senderId,
                      peerKey
                    );
                    itemType = "text";
                  }
                } catch (decErr) {
                  console.warn("[E2EE] Failed to decrypt friend room history content:", decErr);
                  textContent = unpackedMedia
                    ? unpackedMedia.type === "image"
                      ? "Unable to decrypt this photo"
                      : "Unable to decrypt this voice message"
                    : "Unable to decrypt this message";
                }
              } else if (unpackedMedia || unpackedText) {
                textContent = unpackedMedia
                  ? unpackedMedia.type === "image"
                    ? "Unable to decrypt this photo"
                    : "Unable to decrypt this voice message"
                  : "Unable to decrypt this message";
              }
            }

            // Also check replyTo preview if present
            let replyToPayload = item.replyTo;
            if (replyToPayload) {
              if (replyToPayload.content) {
                const unpackedMediaReply = unpackE2EEMedia(replyToPayload.content);
                const unpackedTextReply = !unpackedMediaReply ? unpackE2EEMessage(replyToPayload.content) : null;
                if ((unpackedMediaReply || unpackedTextReply) && activeChatId && peerKey) {
                  try {
                    if (unpackedMediaReply) {
                      replyToPayload = {
                        ...replyToPayload,
                        text: unpackedMediaReply.type === "image" ? "Encrypted photo" : "Encrypted voice note",
                        type: unpackedMediaReply.type,
                      };
                    } else {
                      const decryptedReply = await decryptTextMessage(
                        replyToPayload.content,
                        activeChatId,
                        replyToPayload.senderId || (replyToPayload.sender === "me" ? currentUserId : selectedFriendRef.current?.id),
                        peerKey
                      );
                      replyToPayload = { ...replyToPayload, text: decryptedReply };
                    }
                  } catch {
                    replyToPayload = { ...replyToPayload, text: "Encrypted reply" };
                  }
                }
              }
            }

            return {
              id: item.id,
              text: textContent,
              sender: item.sender || (item.senderId === currentUserId ? "me" : "stranger"),
              timestamp: typeof item.createdAt === "string" ? new Date(item.createdAt).getTime() : (item.createdAt ? new Date(item.createdAt).getTime() : (item.timestamp || Date.now())),
              type: itemType as 'text' | 'image' | 'audio',
              audioUrl,
              imageUrl,
              status: item.status || "delivered",
              replyTo: replyToPayload,
              deletedAt: item.deletedAt,
              reactions: item.reactions || [],
            };
          }

          // Handle raw prisma Message entity
          const rawContent = typeof item.content === "string" ? item.content : "";
          const isAudio = rawContent.startsWith("audio:");
          const isImage = rawContent.startsWith("image:");
          let textContent = isImage
            ? "Photo message"
            : isAudio
            ? "Voice message"
            : rawContent;
          let itemType = isImage ? "image" : isAudio ? "audio" : "text";
          let audioUrl = isAudio ? rawContent.replace("audio:", "") : undefined;
          let imageUrl = isImage ? rawContent.replace("image:", "") : undefined;

          const unpackedMedia = !isAudio && !isImage ? unpackE2EEMedia(rawContent) : null;
          const unpackedText = !isAudio && !isImage && !unpackedMedia ? unpackE2EEMessage(rawContent) : null;

          if (unpackedMedia && activeChatId && peerKey) {
            try {
              const decryptedBlob = await decryptMediaEnvelope(
                unpackedMedia,
                activeChatId,
                item.senderId,
                peerKey
              );
              const objectUrl = registerObjectUrl(URL.createObjectURL(decryptedBlob));
              itemType = unpackedMedia.type;
              if (unpackedMedia.type === "image") {
                imageUrl = objectUrl;
                textContent = "Photo message";
              } else {
                audioUrl = objectUrl;
                textContent = "Voice message";
              }
            } catch (decErr) {
              console.warn("[E2EE] Failed to decrypt raw friend room media:", decErr);
              textContent = unpackedMedia.type === "image"
                ? "Unable to decrypt this photo"
                : "Unable to decrypt this voice message";
            }
          } else if (unpackedText && activeChatId && peerKey) {
            try {
              textContent = await decryptTextMessage(
                rawContent,
                activeChatId,
                item.senderId,
                peerKey
              );
              itemType = "text";
            } catch (decErr) {
              console.warn("[E2EE] Failed to decrypt raw friend room message:", decErr);
              textContent = "Unable to decrypt this message";
            }
          } else if (unpackedMedia || unpackedText) {
            textContent = "Unable to decrypt this message";
          }

          // Check raw entity replyTo
          let replyToPayload = item.replyTo;
          if (replyToPayload?.content) {
            const unpackedMediaReply = unpackE2EEMedia(replyToPayload.content);
            const unpackedTextReply = !unpackedMediaReply ? unpackE2EEMessage(replyToPayload.content) : null;
            if ((unpackedMediaReply || unpackedTextReply) && activeChatId && peerKey) {
              try {
                if (unpackedMediaReply) {
                  replyToPayload = {
                    ...replyToPayload,
                    text: unpackedMediaReply.type === "image" ? "Encrypted photo" : "Encrypted voice note",
                    type: unpackedMediaReply.type,
                  };
                } else {
                  const decryptedReply = await decryptTextMessage(
                    replyToPayload.content,
                    activeChatId,
                    replyToPayload.senderId || (replyToPayload.sender === "me" ? currentUserId : selectedFriendRef.current?.id),
                    peerKey
                  );
                  replyToPayload = { ...replyToPayload, text: decryptedReply };
                }
              } catch {
                replyToPayload = { ...replyToPayload, text: "Encrypted reply" };
              }
            }
          }

          return {
            id: item.id,
            text: textContent,
            sender: item.senderId === currentUserId ? "me" : "stranger",
            timestamp: item.createdAt ? new Date(item.createdAt).getTime() : Date.now(),
            type: itemType as "text" | "audio" | "image",
            audioUrl,
            imageUrl,
            status: item.status || "delivered",
            replyTo: replyToPayload,
            deletedAt: item.deletedAt,
            reactions: item.reactions || [],
          };
        })
      );

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

    newSocket.on("receive_friend_message", async (data: {
      id: string;
      clientId?: string;
      text?: string;
      envelope?: E2EEMessageEnvelope | E2EEMediaEnvelope;
      senderId: string;
      timestamp: number;
      type?: "text" | "audio" | "image";
      audioUrl?: string;
      imageUrl?: string;
      replyTo?: {
        id: string;
        content?: string;
        text?: string;
        type?: "text" | "audio" | "image";
      } | null;
    }) => {
      let msgType = data.type || "text";
      let audioUrl = data.audioUrl;
      let imageUrl = data.imageUrl;
      let displayText = data.text || "";

      // Handle E2EE envelope decryption
      if (data.envelope) {
        const activeChatId = friendChatIdRef.current;
        let peerKey = selectedFriendRef.current?.publicKey || null;

        // Fallback: fetch public key if not yet cached
        if (!peerKey && data.senderId) {
          try {
            const pRes = await fetch(`${BACKEND_URL}/users/${data.senderId}/profile`);
            if (pRes.ok) {
              const pData = await pRes.json();
              if (pData?.publicKey) {
                peerKey = pData.publicKey;
                setSelectedFriend((prev) => (prev && prev.id === data.senderId ? { ...prev, publicKey: pData.publicKey } : prev));
              }
            }
          } catch {}
        }

        if (activeChatId && peerKey) {
          try {
            if (isE2EEMediaEnvelope(data.envelope)) {
              const decryptedBlob = await decryptMediaEnvelope(
                data.envelope,
                activeChatId,
                data.senderId,
                peerKey
              );
              const objectUrl = registerObjectUrl(URL.createObjectURL(decryptedBlob));
              msgType = data.envelope.type;
              if (data.envelope.type === "image") {
                imageUrl = objectUrl;
                displayText = "Photo message";
              } else {
                audioUrl = objectUrl;
                displayText = "Voice message";
              }
            } else if (isE2EEMessageEnvelope(data.envelope)) {
              const envStr = JSON.stringify(data.envelope);
              displayText = await decryptTextMessage(
                envStr,
                activeChatId,
                data.senderId,
                peerKey
              );
              msgType = "text";
            }
          } catch (decErr) {
            console.warn("[E2EE] Failed to decrypt friend message:", decErr);
            msgType = isE2EEMediaEnvelope(data.envelope) ? data.envelope.type : "text";
            displayText = isE2EEMediaEnvelope(data.envelope)
              ? data.envelope.type === "image"
                ? "Unable to decrypt this photo"
                : "Unable to decrypt this voice message"
              : "Unable to decrypt this message";
          }
        } else {
          msgType = isE2EEMediaEnvelope(data.envelope) ? data.envelope.type : "text";
          displayText = isE2EEMediaEnvelope(data.envelope)
            ? data.envelope.type === "image"
              ? "Unable to decrypt this photo"
              : "Unable to decrypt this voice message"
            : "Unable to decrypt this message";
        }
      }

      // Handle replyTo text if envelope
      let processedReplyTo: { id: string; text: string; type?: "text" | "audio" | "image" } | null = null;
      if (data.replyTo) {
        let replyText = data.replyTo.text || "";
        if (data.replyTo.content) {
          const unpackedMediaReply = unpackE2EEMedia(data.replyTo.content);
          const unpackedTextReply = !unpackedMediaReply ? unpackE2EEMessage(data.replyTo.content) : null;
          if ((unpackedMediaReply || unpackedTextReply) && friendChatIdRef.current) {
            const peerKey = selectedFriendRef.current?.publicKey || null;
            if (peerKey) {
              try {
                if (unpackedMediaReply) {
                  replyText = unpackedMediaReply.type === "image" ? "Encrypted photo" : "Encrypted voice note";
                } else {
                  replyText = await decryptTextMessage(
                    data.replyTo.content,
                    friendChatIdRef.current,
                    data.senderId,
                    peerKey
                  );
                }
              } catch {
                replyText = "Encrypted reply";
              }
            } else {
              replyText = "Encrypted reply";
            }
          } else {
            replyText = data.replyTo.content;
          }
        }
        processedReplyTo = {
          id: data.replyTo.id,
          text: replyText,
          type: data.replyTo.type,
        };
      }

      const isAudio = msgType === "audio";
      const isImage = msgType === "image";

      const newMsg: Message = {
        id: data.id,
        clientId: data.clientId,
        text: isImage
          ? displayText || "Photo message"
          : isAudio
          ? "Voice message"
          : displayText,
        sender: data.senderId === userIdRef.current ? "me" : "stranger",
        timestamp: data.timestamp,
        type: msgType as "text" | "audio" | "image",
        audioUrl,
        imageUrl,
        status: "delivered",
        replyTo: processedReplyTo,
      };

      setFriendMessages((prev) => {
        if (data.clientId) {
          const exists = prev.some((m) => m.clientId === data.clientId);
          if (exists) {
            return prev.map((m) =>
              m.clientId === data.clientId
                ? {
                    ...m,
                    id: data.id,
                    status: "delivered",
                    timestamp: data.timestamp,
                    audioUrl: m.audioUrl || audioUrl,
                    imageUrl: m.imageUrl || imageUrl,
                  }
                : m
            );
          }
        }
        return [...prev, newMsg];
      });

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

    newSocket.on("friend_message_sent", (data: { id: string; clientId?: string; status: string }) => {
      setFriendMessages((prev) =>
        prev.map((msg) =>
          data.clientId && msg.clientId === data.clientId
            ? { ...msg, id: data.id, status: "sent" }
            : msg
        )
      );
    });

    newSocket.on("friend_voice_error", (data: { clientId?: string; message?: string }) => {
      showNotification(data.message || "Voice note couldn't be sent. Please try again.");
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
      // STRICT VALIDATION: Must be an explicit valid friend video call payload
      if (!data || typeof data !== "object") return;
      if (typeof data.roomId !== "string" || !data.roomId.startsWith("friend-")) return;
      if (typeof data.callId !== "string" || !data.callId.trim()) return;
      if (typeof data.callerUserId !== "string" || !data.callerUserId.trim()) return;
      if (data.chatType !== "friend") return;

      // Ignore calls from ourselves
      if (userIdRef.current && data.callerUserId === userIdRef.current) return;

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
  }, [navigateTo, showNotification, sessionKey, authBootstrapped]);

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
      const { token } = getPersistedAuth();
      const prefRes = await fetch(`${BACKEND_URL}/users/${userId}/preferences`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(preferences),
      });

      if (prefRes.ok) {
        const prefData = await prefRes.json();
        setCurrentUserProfile((prev) =>
          prev
            ? {
                ...prev,
                language: prefData.language || language,
                interests: prefData.interests || interests,
                goal: prefData.goal || goal,
              }
            : null
        );
      }

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

  const handleSavePreferences = async () => {
    if (!userId) return;
    setSavingPreferences(true);
    try {
      const { token } = getPersistedAuth();
      const res = await fetch(`${BACKEND_URL}/users/${userId}/preferences`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          language,
          interests,
          goal,
        }),
      });
      if (res.ok) {
        const updated = await res.json();
        setCurrentUserProfile((prev) =>
          prev
            ? {
                ...prev,
                language: updated.language || language,
                interests: updated.interests || interests,
                goal: updated.goal || goal,
              }
            : null
        );
        showNotification("Match preferences saved!");
      } else {
        showNotification("Failed to save preferences.");
      }
    } catch (e) {
      console.warn("Could not save preferences:", e);
      showNotification("Could not connect to server.");
    } finally {
      setSavingPreferences(false);
    }
  };

  // FEATURE 1: Skip / Next Stranger
  const handleNextStranger = () => {
    videoCall.teardownCall();
    setIsVideoChatOpen(false);
    setUnreadVideoChatCount(0);
    if (!socket) return;

    clearMatchingTimers();
    clearConversationKeyCache();
    setStrangerPublicKey(null);
    strangerPublicKeyRef.current = null;
    setMessages([]);
    setReplyingTo(null);
    setStrangerTyping(false);
    setMatchScore(null);
    setStrangerRoomId(null);
    setStrangerChatId(null);
    strangerChatIdRef.current = null;
    setStrangerUserId(null);
    setFriendRequestSent(false);
    setFriendRequestMessage("");
    setIsSendingFriendRequest(false);
    setIsAlreadyFriend(false);
    setNotifications((prev) => {
      const remaining = prev.filter((n) => n.type !== "STRANGER_MESSAGE");
      const removedCount = prev.length - remaining.length;
      if (removedCount > 0) {
        setUnreadNotificationsCount((c) => Math.max(0, c - removedCount));
      }
      return remaining;
    });
    setMessage("");
    setViewProfile(null);
    setWaiting(true);
    setSearchElapsedSeconds(0);
    setMatchingMode("searching");

    socket.emit("next_stranger", { language, interests, goal });

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
    clearConversationKeyCache();
    setStrangerPublicKey(null);
    strangerPublicKeyRef.current = null;
    if (socket) {
      socket.emit("end_chat");
    }
    setMessages([]);
    setReplyingTo(null);
    setStrangerTyping(false);
    setMatchScore(null);
    setStrangerRoomId(null);
    strangerRoomIdRef.current = null;
    setStrangerChatId(null);
    strangerChatIdRef.current = null;
    setStrangerUserId(null);
    setFriendRequestSent(false);
    setFriendRequestMessage("");
    setIsSendingFriendRequest(false);
    setIsAlreadyFriend(false);
    setMessage("");
    setViewProfile(null);
    setWaiting(false);
    setMatchingMode("idle");
    setSearchElapsedSeconds(0);

    // Clear any lingering stranger-message notifications for the ended chat
    setNotifications((prev) => {
      const remaining = prev.filter((n) => n.type !== "STRANGER_MESSAGE");
      const removedCount = prev.length - remaining.length;
      if (removedCount > 0) {
        setUnreadNotificationsCount((c) => Math.max(0, c - removedCount));
      }
      return remaining;
    });

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

  const sendStrangerMessage = async () => {
    if (!socket || message.trim() === "" || strangerStatus === "disconnected" || !strangerRoomIdRef.current) return;

    const activeChatId = strangerChatIdRef.current;
    const peerKey = strangerPublicKeyRef.current;
    const currentUserId = userIdRef.current;

    if (!activeChatId || !peerKey || !currentUserId) {
      showNotification("Cannot send message: waiting for secure key exchange.");
      return;
    }

    const clientId = `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const text = message.trim();
    const targetReplyingTo = replyingTo;

    // Optimistic UI display
    const optimisticMsg: Message = {
      id: clientId,
      clientId,
      text,
      sender: "me",
      timestamp: Date.now(),
      type: "text",
      status: "sending",
      replyTo: targetReplyingTo
        ? {
            id: targetReplyingTo.id,
            text: targetReplyingTo.text,
            type: targetReplyingTo.type,
          }
        : null,
    };

    setMessages((prev) => [...prev, optimisticMsg]);
    setMessage("");
    setReplyingTo(null);

    try {
      // Encrypt text message locally in browser - NEVER send plaintext
      const envelopeStr = await encryptTextMessage(
        text,
        activeChatId,
        currentUserId,
        peerKey
      );
      const envelope = unpackE2EEMessage(envelopeStr);
      if (!envelope) {
        throw new Error("Envelope packing failed");
      }

      // Transmit ONLY envelope to Socket.IO. Never send 'text' alongside envelope!
      socket.emit("send_message", {
        envelope,
        clientId,
        replyToId: targetReplyingTo?.id,
      });
      socket.emit("stop_typing");
    } catch (encErr) {
      console.error("[E2EE] Failed to encrypt stranger message:", encErr);
      // Revert optimistic message and show non-sensitive notification
      setMessages((prev) => prev.filter((m) => m.clientId !== clientId));
      showNotification("Message encryption failed. Message was not sent.");
    }
  };

  const sendStrangerVoice = async (audioBlob: Blob) => {
    if (!socket || strangerStatus === "disconnected") {
      showNotification("Voice note couldn't be sent. Please try again.");
      return;
    }

    if (!audioBlob || audioBlob.size === 0) {
      showNotification("Your voice note could not be recorded. Please try again.");
      return;
    }

    if (audioBlob.size > MAX_E2EE_AUDIO_BYTES) {
      const maxMb = (MAX_E2EE_AUDIO_BYTES / (1024 * 1024)).toFixed(1);
      showNotification(`Voice note is too large. Maximum allowed size is ${maxMb} MB.`);
      return;
    }

    const activeChatId = strangerChatIdRef.current;
    const peerKey = strangerPublicKeyRef.current;
    const currentUserId = userIdRef.current;

    if (!activeChatId || !peerKey || !currentUserId) {
      showNotification("Cannot send voice message: waiting for secure key exchange.");
      return;
    }

    let localBlobUrl: string;
    try {
      localBlobUrl = registerObjectUrl(URL.createObjectURL(audioBlob));
    } catch {
      localBlobUrl = "";
    }

    // Capture conversation context snapshot
    const targetReplyingTo = replyingTo;
    const clientId = `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const optimisticMsg: Message = {
      id: clientId,
      clientId,
      text: "Voice message",
      sender: "me",
      timestamp: Date.now(),
      type: "audio",
      audioUrl: localBlobUrl,
      status: "sending",
      replyTo: targetReplyingTo
        ? {
            id: targetReplyingTo.id,
            text: targetReplyingTo.text,
            type: targetReplyingTo.type,
          }
        : null,
    };

    setMessages((prev) => [...prev, optimisticMsg]);
    setReplyingTo(null);

    try {
      // Encrypt audio blob locally with AES-256-GCM + Media AAD - NEVER send raw audio bytes
      const envelope = await encryptMediaBlob(
        audioBlob,
        activeChatId,
        currentUserId,
        peerKey,
        "audio"
      );

      // Emit only the encrypted envelope via send_message
      socket.emit("send_message", {
        envelope,
        clientId,
        replyToId: targetReplyingTo?.id,
      });
    } catch (encErr) {
      console.error("[E2EE] Failed to encrypt stranger voice note:", encErr);
      revokeSingleObjectUrl(localBlobUrl);
      setMessages((prev) => prev.filter((m) => m.clientId !== clientId));
      showNotification("Voice note encryption failed. Message was not sent.");
    }
  };

  const sendStrangerImage = async (imageFile: File) => {
    if (!socket || strangerStatus === "disconnected") {
      showNotification("Photo couldn't be sent. Please try again.");
      return;
    }

    if (!imageFile || !imageFile.type.startsWith("image/")) {
      showNotification("Invalid image file. Please select a valid photo.");
      return;
    }

    if (imageFile.size > MAX_E2EE_IMAGE_BYTES) {
      const maxMb = (MAX_E2EE_IMAGE_BYTES / (1024 * 1024)).toFixed(1);
      showNotification(`Image is too large. Maximum allowed size is ${maxMb} MB.`);
      return;
    }

    const activeChatId = strangerChatIdRef.current;
    const peerKey = strangerPublicKeyRef.current;
    const currentUserId = userIdRef.current;

    if (!activeChatId || !peerKey || !currentUserId) {
      showNotification("Cannot send photo: waiting for secure key exchange.");
      return;
    }

    // 1. Create a browser-local object URL for instant optimistic rendering
    let localBlobUrl: string;
    try {
      localBlobUrl = registerObjectUrl(URL.createObjectURL(imageFile));
    } catch {
      localBlobUrl = "";
    }

    const clientId = `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const targetReplyingTo = replyingTo;

    const optimisticMsg: Message = {
      id: clientId,
      clientId,
      text: message.trim() || "Photo message",
      sender: "me",
      timestamp: Date.now(),
      type: "image",
      imageUrl: localBlobUrl,
      status: "sending",
      replyTo: targetReplyingTo
        ? {
            id: targetReplyingTo.id,
            text: targetReplyingTo.text,
            type: targetReplyingTo.type,
          }
        : null,
    };

    setMessages((prev) => [...prev, optimisticMsg]);
    setMessage("");
    setReplyingTo(null);

    try {
      // 2. Encrypt the original image file directly using AES-256-GCM + Media AAD
      // The browser encrypts BEFORE sending. Backend receives ONLY the envelope!
      const envelope = await encryptMediaBlob(
        imageFile,
        activeChatId,
        currentUserId,
        peerKey,
        "image"
      );

      // 3. Emit ONLY the encrypted envelope via send_message - NO raw bytes, NO data URLs, NO plaintext!
      socket.emit("send_message", {
        envelope,
        clientId,
        replyToId: targetReplyingTo?.id,
      });
    } catch (encErr) {
      console.error("[E2EE] Failed to encrypt stranger photo:", encErr);
      // Clean up optimistic object URL on failure
      revokeSingleObjectUrl(localBlobUrl);
      setMessages((prev) => prev.filter((m) => m.clientId !== clientId));
      showNotification("Photo encryption failed. Message was not sent.");
    }
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
    videoCall.teardownCall();
    setIsVideoChatOpen(false);
    setUnreadVideoChatCount(0);
    clearMatchingTimers();
    clearConversationKeyCache();
    setStrangerPublicKey(null);
    strangerPublicKeyRef.current = null;
    socket.emit("report_stranger", {
      reportedUserId: strangerUserId,
      reason,
      description,
    });
    setMessages([]);
    setReplyingTo(null);
    setStrangerTyping(false);
    setMatchScore(null);
    setStrangerRoomId(null);
    strangerRoomIdRef.current = null;
    setStrangerChatId(null);
    strangerChatIdRef.current = null;
    setStrangerUserId(null);
    setFriendRequestSent(false);
    setFriendRequestMessage("");
    setIsSendingFriendRequest(false);
    setIsAlreadyFriend(false);
    setMessage("");
    setViewProfile(null);
    setWaiting(false);
    setMatchingMode("idle");
    setSearchElapsedSeconds(0);
    navigateTo("matching");
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
      const res = await fetch(`${BACKEND_URL}/friends/${userId}`);
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
      const res = await fetch(`${BACKEND_URL}/friends/requests/${userId}`);
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
        fetch(`${BACKEND_URL}/notifications/${userId}`),
        fetch(`${BACKEND_URL}/notifications/${userId}/unread-count`),
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
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, isRead: true } : n))
    );
    setUnreadNotificationsCount((prev) => Math.max(0, prev - 1));

    if (id.startsWith("temp-") || id.startsWith("stranger-msg-")) {
      return;
    }

    try {
      await fetch(`${BACKEND_URL}/notifications/${id}/read`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
    } catch (err) {
      console.warn("Could not mark notification as read:", err);
    }
  };

  const markAllNotificationsAsRead = async () => {
    if (!userId) return;
    try {
      await fetch(`${BACKEND_URL}/notifications/user/${userId}/read-all`, {
        method: "PUT",
      });
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      setUnreadNotificationsCount(0);
    } catch (err) {
      console.warn("Could not mark all notifications read:", err);
    }
  };

  const handleOpenNotifications = async () => {
    if (!userId) return;

    // Identify currently displayed unread notifications at the moment of opening
    const unreadNotifs = notifications.filter((n) => !n.isRead);
    const unreadIds = unreadNotifs.map((n) => n.id);

    // If there are no unread notifications visible and count is 0, nothing to mark
    if (unreadIds.length === 0 && unreadNotificationsCount === 0) {
      return;
    }

    // Capture previous state snapshot for rollback on error
    const prevNotifications = [...notifications];
    const prevCount = unreadNotificationsCount;

    // 1. Immediate optimistic UI update:
    // Mark identified unread notifications as read immediately so badge clears without delay
    if (unreadIds.length > 0) {
      setNotifications((prev) =>
        prev.map((n) => (unreadIds.includes(n.id) ? { ...n, isRead: true } : n))
      );
      setUnreadNotificationsCount((prev) => Math.max(0, prev - unreadIds.length));
    } else {
      setUnreadNotificationsCount(0);
    }

    // 2. Persist to backend database via bulk endpoint
    try {
      const dbIds = unreadIds.filter((id) => id && !id.startsWith("temp-"));
      let res: Response;
      if (dbIds.length > 0) {
        res = await fetch(
          `${BACKEND_URL}/notifications/user/${userId}/read-bulk`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ notificationIds: dbIds }),
          }
        );
      } else {
        res = await fetch(
          `${BACKEND_URL}/notifications/user/${userId}/read-all`,
          {
            method: "PUT",
          }
        );
      }

      if (!res.ok) {
        throw new Error(`Failed to mark notifications read (status: ${res.status})`);
      }

      const data = await res.json();
      if (typeof data.count === "number") {
        setUnreadNotificationsCount(data.count);
      }
    } catch (err) {
      console.warn("Could not mark opened notifications as read:", err);
      // Rollback to consistent state on network failure
      setNotifications(prevNotifications);
      setUnreadNotificationsCount(prevCount);
    }
  };

  const handleSelectNotification = async (notif: AppNotification) => {
    if (notif.type === "STRANGER_MESSAGE") {
      // Mark notification as read
      markNotificationAsRead(notif.id);

      // Return to the active stranger chat without resetting room or calling find_stranger
      navigateTo("stranger-chat");

      // Mark all unread stranger messages in the room as seen
      if (socket && strangerRoomIdRef.current) {
        const unreadIds = messages
          .filter((m) => m.sender === "stranger" && m.id && m.status !== "seen")
          .map((m) => m.id as string);
        if (unreadIds.length > 0) {
          socket.emit("mark_seen", {
            roomId: strangerRoomIdRef.current,
            messageIds: unreadIds,
          });
        }
      }
    } else if (notif.type === "FRIEND_REQUEST") {
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
    clearConversationKeyCache();
    if (socket && friendRoomId) {
      socket.emit("leave_friend_room", { roomId: friendRoomId });
    }
    setSelectedFriend(null);
    setFriendRoomId(null);
    setFriendChatId(null);
    friendChatIdRef.current = null;
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

  const sendFriendMessage = async () => {
    if (!socket || !userId || !friendRoomId || friendMessage.trim() === "") return;

    const activeChatId = friendChatIdRef.current;
    let peerKey = selectedFriendRef.current?.publicKey || null;

    // Fallback: fetch public key if not yet cached on selectedFriend
    if (!peerKey && selectedFriendRef.current?.id) {
      try {
        const pRes = await fetch(`${BACKEND_URL}/users/${selectedFriendRef.current.id}/profile`);
        if (pRes.ok) {
          const pData = await pRes.json();
          if (pData?.publicKey) {
            peerKey = pData.publicKey;
            setSelectedFriend((prev) => (prev ? { ...prev, publicKey: pData.publicKey } : prev));
          }
        }
      } catch {}
    }

    if (!activeChatId || !peerKey) {
      showNotification("Cannot send message: peer encryption key not available.");
      return;
    }

    const clientId = `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const text = friendMessage.trim();
    const targetReplyingTo = friendReplyingTo;
    const targetRoomId = friendRoomId;

    // Optimistic UI display
    const optimisticMsg: Message = {
      id: clientId,
      clientId,
      text,
      sender: "me",
      timestamp: Date.now(),
      type: "text",
      status: "sending",
      replyTo: targetReplyingTo
        ? {
            id: targetReplyingTo.id,
            text: targetReplyingTo.text,
            type: targetReplyingTo.type,
          }
        : null,
    };

    setFriendMessages((prev) => [...prev, optimisticMsg]);
    setFriendMessage("");
    setFriendReplyingTo(null);

    try {
      // Encrypt text message locally in browser - NEVER send plaintext
      const envelopeStr = await encryptTextMessage(
        text,
        activeChatId,
        userId,
        peerKey
      );
      const envelope = unpackE2EEMessage(envelopeStr);
      if (!envelope) {
        throw new Error("Envelope packing failed");
      }

      // Transmit ONLY envelope to Socket.IO. Never send 'text' alongside envelope!
      socket.emit("send_friend_message", {
        roomId: targetRoomId,
        senderId: userId,
        envelope,
        replyToId: targetReplyingTo?.id,
        clientId,
      });
    } catch (encErr) {
      console.error("[E2EE] Failed to encrypt friend message:", encErr);
      // Revert optimistic message and show non-sensitive notification
      setFriendMessages((prev) => prev.filter((m) => m.clientId !== clientId));
      showNotification("Message encryption failed. Message was not sent.");
    }
  };

  const sendFriendVoice = async (audioBlob: Blob) => {
    if (!socket || !friendRoomId) {
      showNotification("Voice note couldn't be sent. Please try again.");
      return;
    }

    if (!audioBlob || audioBlob.size === 0) {
      showNotification("Your voice note could not be recorded. Please try again.");
      return;
    }

    const activeChatId = friendChatIdRef.current;
    let peerKey = selectedFriendRef.current?.publicKey || null;

    if (!peerKey && selectedFriendRef.current?.id) {
      try {
        const pRes = await fetch(`${BACKEND_URL}/users/${selectedFriendRef.current.id}/profile`);
        if (pRes.ok) {
          const pData = await pRes.json();
          if (pData?.publicKey) {
            peerKey = pData.publicKey;
            setSelectedFriend((prev) => (prev ? { ...prev, publicKey: pData.publicKey } : prev));
          }
        }
      } catch {}
    }

    if (audioBlob.size > MAX_E2EE_AUDIO_BYTES) {
      const maxMb = (MAX_E2EE_AUDIO_BYTES / (1024 * 1024)).toFixed(1);
      showNotification(`Voice note is too large. Maximum allowed size is ${maxMb} MB.`);
      return;
    }

    if (!activeChatId || !peerKey || !userId) {
      showNotification("Cannot send voice message: peer encryption key not available.");
      return;
    }

    let localBlobUrl: string;
    try {
      localBlobUrl = registerObjectUrl(URL.createObjectURL(audioBlob));
    } catch {
      localBlobUrl = "";
    }

    // Capture conversation context snapshot
    const targetReplyingTo = friendReplyingTo;
    const targetRoomId = friendRoomId;
    const clientId = `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const optimisticMsg: Message = {
      id: clientId,
      clientId,
      text: "Voice message",
      sender: "me",
      timestamp: Date.now(),
      type: "audio",
      audioUrl: localBlobUrl,
      status: "sending",
      replyTo: targetReplyingTo
        ? {
            id: targetReplyingTo.id,
            text: targetReplyingTo.text,
            type: targetReplyingTo.type,
          }
        : null,
    };

    setFriendMessages((prev) => [...prev, optimisticMsg]);
    setFriendReplyingTo(null);

    try {
      // Encrypt audio blob locally with AES-256-GCM + Media AAD - NEVER send raw audio bytes
      const envelope = await encryptMediaBlob(
        audioBlob,
        activeChatId,
        userId,
        peerKey,
        "audio"
      );

      // Emit only the encrypted envelope via send_friend_message
      socket.emit("send_friend_message", {
        roomId: targetRoomId,
        senderId: userId,
        envelope,
        replyToId: targetReplyingTo?.id,
        clientId,
      });
    } catch (encErr) {
      console.error("[E2EE] Failed to encrypt friend voice note:", encErr);
      revokeSingleObjectUrl(localBlobUrl);
      setFriendMessages((prev) => prev.filter((m) => m.clientId !== clientId));
      showNotification("Voice note encryption failed. Message was not sent.");
    }
  };

  const sendFriendImage = async (imageFile: File) => {
    if (!socket || !friendRoomId) {
      showNotification("Photo couldn't be sent. Please try again.");
      return;
    }

    if (!imageFile || !imageFile.type.startsWith("image/")) {
      showNotification("Invalid image file. Please select a valid photo.");
      return;
    }

    if (imageFile.size > MAX_E2EE_IMAGE_BYTES) {
      const maxMb = (MAX_E2EE_IMAGE_BYTES / (1024 * 1024)).toFixed(1);
      showNotification(`Image is too large. Maximum allowed size is ${maxMb} MB.`);
      return;
    }

    const activeChatId = friendChatIdRef.current;
    let peerKey = selectedFriendRef.current?.publicKey || null;

    if (!peerKey && selectedFriendRef.current?.id) {
      try {
        const pRes = await fetch(`${BACKEND_URL}/users/${selectedFriendRef.current.id}/profile`);
        if (pRes.ok) {
          const pData = await pRes.json();
          if (pData?.publicKey) {
            peerKey = pData.publicKey;
            setSelectedFriend((prev) => (prev ? { ...prev, publicKey: pData.publicKey } : prev));
          }
        }
      } catch {}
    }

    if (!activeChatId || !peerKey || !userId) {
      showNotification("Cannot send photo: peer encryption key not available.");
      return;
    }

    // 1. Create a browser-local object URL for instant optimistic rendering
    let localBlobUrl: string;
    try {
      localBlobUrl = registerObjectUrl(URL.createObjectURL(imageFile));
    } catch {
      localBlobUrl = "";
    }

    const targetReplyingTo = friendReplyingTo;
    const targetRoomId = friendRoomId;
    const clientId = `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const optimisticMsg: Message = {
      id: clientId,
      clientId,
      text: friendMessage.trim() || "Photo message",
      sender: "me",
      timestamp: Date.now(),
      type: "image",
      imageUrl: localBlobUrl,
      status: "sending",
      replyTo: targetReplyingTo
        ? {
            id: targetReplyingTo.id,
            text: targetReplyingTo.text,
            type: targetReplyingTo.type,
          }
        : null,
    };

    setFriendMessages((prev) => [...prev, optimisticMsg]);
    setFriendMessage("");
    setFriendReplyingTo(null);

    try {
      // 2. Encrypt original image file directly with AES-256-GCM + Media AAD - NEVER send raw image bytes
      const envelope = await encryptMediaBlob(
        imageFile,
        activeChatId,
        userId,
        peerKey,
        "image"
      );

      // 3. Emit ONLY the encrypted envelope via send_friend_message
      socket.emit("send_friend_message", {
        roomId: targetRoomId,
        senderId: userId,
        envelope,
        replyToId: targetReplyingTo?.id,
        clientId,
      });
    } catch (encErr) {
      console.error("[E2EE] Failed to encrypt friend photo:", encErr);
      revokeSingleObjectUrl(localBlobUrl);
      setFriendMessages((prev) => prev.filter((m) => m.clientId !== clientId));
      showNotification("Photo encryption failed. Message was not sent.");
    }
  };

  const sendFriendRequest = async () => {
    if (!userId || !strangerUserId || isSendingFriendRequest || friendRequestSent || isAlreadyFriend) return;
    setIsSendingFriendRequest(true);
    try {
      setFriendRequestMessage("");
      const res = await fetch(`${BACKEND_URL}/friends/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ senderId: userId, receiverId: strangerUserId }),
      });

      const data = await res.json().catch(() => null);

      if (res.ok) {
        setFriendRequestSent(true);
        setFriendRequestMessage("Friend request sent");
        showNotification("✓ Friend request sent!");
        loadFriendRequests();
      } else {
        const errorMsg = data?.message || "Failed to send friend request";
        if (errorMsg.includes("already friends")) {
          setIsAlreadyFriend(true);
          setFriendRequestMessage("You are already friends");
          showNotification("You are already friends with this user!");
        } else if (errorMsg.includes("already exists")) {
          setFriendRequestSent(true);
          setFriendRequestMessage("Friend request already sent");
          showNotification("Friend request already pending.");
        } else {
          setFriendRequestMessage(errorMsg);
          showNotification(errorMsg);
        }
      }
    } catch (err) {
      console.warn("Error sending friend request:", err);
      setFriendRequestMessage("Failed to send friend request");
      showNotification("Could not send friend request. Please try again.");
    } finally {
      setIsSendingFriendRequest(false);
    }
  };

  const acceptFriendRequest = async (requestId: string) => {
    if (!userId) return;
    try {
      await fetch(`${BACKEND_URL}/friends/request/${requestId}/accept`, {
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
      await fetch(`${BACKEND_URL}/friends/request/${requestId}/reject`, {
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
      await fetch(`${BACKEND_URL}/friends/${userId}/${friendId}`, {
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
      const res = await fetch(`${BACKEND_URL}/users/${targetUserId}/profile`);
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
  // LOG OUT & PERMANENT ACCOUNT DELETION
  // ==========================================

  const handleDeleteAccount = async () => {
    if (!userId) return;
    setIsDeletingAccount(true);
    try {
      videoCall.teardownCall();
      friendVideoCall.teardownCall();
      setIsVideoChatOpen(false);
      setIsFriendVideoChatOpen(false);
      setUnreadVideoChatCount(0);
      setUnreadFriendVideoChatCount(0);
      const { token } = getPersistedAuth();
      const res = await fetch(`${BACKEND_URL}/users/${userId}/account`, {
        method: "DELETE",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || "Failed to delete account");
      }

      // Disconnect socket cleanly
      if (socket) {
        socket.disconnect();
        setSocket(null);
      }

      // Wipe all user-specific local and session storage
      clearPersistedAuth();

      // Wipe local E2EE private/public keys from IndexedDB
      await clearIdentityKeys();

      // Guard all existing and pending async effects
      isAccountDeletedRef.current = true;
      setIsAccountDeleted(true);

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
      setCheckingProfile(false);
      setCurrentView("profile-setup");
      setIsSidebarOpen(false);

      showNotification("Account permanently deleted and logged out.");
    } catch (err: any) {
      console.error("Account deletion failed:", err);
      showNotification("Failed to delete account. Please try again.");
    } finally {
      setIsDeletingAccount(false);
    }
  };

  // ==========================================
  // RENDER: BRANDED CHIRP LOADING SCREEN
  // Shown during initial auth bootstrap or account deletion teardown
  // ==========================================

  if (!authBootstrapped || isDeletingAccount) {
    return (
      <main className="min-h-screen relative flex items-center justify-center p-4 bg-[#030308] overflow-hidden select-none">
        <GalaxyBackground />
        <div className="relative z-10 w-full max-w-sm mx-auto flex flex-col items-center text-center px-6 py-8 rounded-3xl bg-zinc-900/80 backdrop-blur-xl border border-zinc-800/80 shadow-[0_0_50px_-12px_rgba(99,102,241,0.25)] transition-all">
          {/* Logo & subtle ambient glow */}
          <div className="relative mb-5 flex items-center justify-center">
            <div className="absolute -inset-3 bg-indigo-500/20 rounded-full blur-xl pointer-events-none animate-pulse" />
            <div className="relative h-14 w-14 rounded-2xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-purple-500 p-[1.5px] shadow-lg shadow-indigo-500/30">
              <div className="w-full h-full bg-zinc-950 rounded-[14px] flex items-center justify-center">
                <span className="text-2xl font-black tracking-tight text-white">
                  C<span className="text-indigo-400 font-bold">h</span>
                </span>
              </div>
            </div>
          </div>

          {/* Brand Wordmark */}
          <h1 className="text-2xl font-extrabold text-white tracking-tight">
            Chi<span className="text-indigo-400">rp</span>
          </h1>

          {/* Branded Loading Message */}
          <p className="mt-2 text-sm text-zinc-300 font-medium">
            {isDeletingAccount ? "Signing out and resetting..." : "Connecting you to the world..."}
          </p>

          {/* Sleek Pulsing / Typing Activity Indicator */}
          <div className="mt-6 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-indigo-500 animate-pulse [animation-delay:-0.3s]" />
            <span className="h-2 w-2 rounded-full bg-indigo-400 animate-pulse [animation-delay:-0.15s]" />
            <span className="h-2 w-2 rounded-full bg-purple-400 animate-pulse" />
          </div>

          <p className="mt-4 text-[11px] text-zinc-500 font-mono tracking-wide">
            {isDeletingAccount ? "CLEANING UP" : "INITIALIZING CHIRP"}
          </p>
        </div>
      </main>
    );
  }

  // ==========================================
  // RENDER: FIRST-TIME PROFILE SETUP / POST-DELETION
  // ==========================================

  if (isAccountDeleted || !profileCompleted) {
    return (
      <main className="min-h-screen relative flex items-center justify-center p-4 bg-[#030308] overflow-hidden">
        <GalaxyBackground />
        <div className="relative z-10 w-full flex justify-center">
          <ProfileSetup
            userId={userId}
            onComplete={(savedProfile) => {
              const assignedUserId = savedProfile.userId || userId;
              if (assignedUserId) {
                setUserId(assignedUserId);
                userIdRef.current = assignedUserId;
              }
              isAccountDeletedRef.current = false;
              setIsAccountDeleted(false);
              setCurrentUserProfile((prev) => ({
                id: assignedUserId || prev?.id || "",
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
        currentUserId={userId || undefined}
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
        isVoiceDisabled={
          friendVideoCall.callState === "connecting" ||
          friendVideoCall.callState === "connected" ||
          videoCall.callState === "connecting" ||
          videoCall.callState === "connected"
        }
        voiceDisabledReason="Voice notes are disabled during an active video call."
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
        isVoiceDisabled={
          videoCall.callState === "connecting" ||
          videoCall.callState === "connected" ||
          friendVideoCall.callState === "connecting" ||
          friendVideoCall.callState === "connected"
        }
        voiceDisabledReason="Voice notes are disabled during an active video call."
      />
    </div>
  );

  // ==========================================
  // RENDER: MAIN APPLICATION (HEADER + SIDEBAR + WORKSPACE)
  // ==========================================

  return (
    <div className="h-full h-[100dvh] max-h-[100dvh] w-full flex flex-col relative text-zinc-100 overflow-hidden bg-[#030308]">
      {/* Background galaxy layer */}
      <GalaxyBackground />

      {notificationBanner}

      {/* TOP APPLICATION HEADER (☰ Hamburger, Brand, New Chat, Profile, Notifications, Online status) */}
      <div
        className={`relative z-20 shrink-0 ${
          currentView === "stranger-chat" || currentView === "friend-chat"
            ? "hidden md:block"
            : ""
        }`}
      >
        <AppHeader
          onToggleSidebar={() => setIsSidebarOpen((prev) => !prev)}
          onNewChat={() => {
            if (currentView === "stranger-chat") {
              handleNextStranger();
            } else {
              navigateTo("matching");
            }
          }}
          hasActiveStrangerChat={Boolean(strangerRoomId && strangerStatus !== "disconnected" && currentView !== "stranger-chat")}
          onReturnToStrangerChat={() => navigateTo("stranger-chat")}
          onOpenProfile={() => setIsEditProfileOpen(true)}
          currentUsername={currentUserProfile?.username}
          currentAvatar={currentUserProfile?.avatar}
          unreadNotificationsCount={unreadNotificationsCount}
          notifications={notifications}
          onMarkNotificationAsRead={markNotificationAsRead}
          onMarkAllNotificationsAsRead={markAllNotificationsAsRead}
          onSelectNotification={handleSelectNotification}
          onOpenNotifications={handleOpenNotifications}
        />
      </div>

      {/* MAIN BODY: SIDEBAR + RIGHT WORKSPACE */}
      <div className="flex-1 flex min-h-0 w-full overflow-hidden relative z-10">
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
              if (strangerRoomId && strangerStatus !== "disconnected") {
                navigateTo("stranger-chat");
              } else if (currentView !== "stranger-chat") {
                navigateTo("matching");
              }
            }
          }}
          hasActiveStrangerChat={Boolean(strangerRoomId && strangerStatus !== "disconnected" && currentView !== "stranger-chat")}
          onReturnToStrangerChat={() => navigateTo("stranger-chat")}
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
        <main className="flex-1 flex flex-col min-w-0 min-h-0 h-full bg-transparent overflow-hidden relative">
          {/* VIEW: PRIVATE FRIEND CHAT */}
          {currentView === "friend-chat" && (
            <div className="flex-1 flex flex-col h-full w-full max-w-5xl mx-auto bg-zinc-900/95 backdrop-blur-md sm:border-x border-zinc-800/80 shadow-2xl overflow-hidden">
              {/* Header */}
              <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-6 py-2.5 sm:py-3 border-b border-zinc-800/90 bg-zinc-900/95 backdrop-blur-md shrink-0">
                <button
                  onClick={closeFriendChat}
                  className="px-2.5 sm:px-3 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 hover:text-white border border-zinc-700/60 text-xs font-semibold transition shadow-xs flex items-center gap-1.5 active:scale-95 shrink-0"
                >
                  <span>←</span>
                  <span className="hidden sm:inline">Back to Friends</span>
                  <span className="sm:hidden">Back</span>
                </button>

                <div className="flex-1 min-w-0">
                  <h1 className="font-bold text-white text-sm truncate flex items-center gap-1.5">
                    {selectedFriend?.avatar && <span>{selectedFriend.avatar}</span>}
                    <span className="truncate">{selectedFriend?.username || "Friend"}</span>
                  </h1>
                  {selectedFriend?.isOnline ? (
                    <div className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-400">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse inline-block" />
                      <span>Online</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-[11px] text-zinc-400 truncate">
                      <span className="w-2 h-2 rounded-full bg-zinc-600 inline-block shrink-0" />
                      <span className="truncate">
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
                  className={`px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 active:scale-95 shadow-xs shrink-0 ${
                    friendVideoCall.callState === "connected" || friendVideoCall.callState === "connecting"
                      ? "bg-rose-600 text-white hover:bg-rose-500 border border-rose-500/50"
                      : "bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white border border-indigo-500/40 shadow-indigo-600/20"
                  } disabled:opacity-40 disabled:cursor-not-allowed`}
                >
                  <span>🎥</span>
                  <span className="hidden sm:inline">Video Call</span>
                </button>

                <button
                  type="button"
                  onClick={() => openUserProfile(selectedFriend?.id || null)}
                  disabled={!selectedFriend?.id}
                  className="px-2.5 sm:px-3 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700/60 text-zinc-200 hover:text-white text-xs font-medium transition disabled:opacity-50 flex items-center gap-1 shrink-0"
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
            <div className="flex-1 w-full max-w-4xl mx-auto p-3 sm:p-6 overflow-y-auto min-h-0 safe-bottom">
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
              searchQuery={searchQuery}
              onSearchQueryChange={setSearchQuery}
            />
          )}

          {/* VIEW: ACTIVE STRANGER CHAT */}
          {currentView === "stranger-chat" && (
            <div className="flex-1 flex flex-col h-full w-full max-w-5xl mx-auto bg-zinc-900 sm:border-x border-zinc-800/80 shadow-2xl overflow-hidden">
              <ChatHeader
                onViewProfile={() => openUserProfile(strangerUserId)}
                strangerAvatar={viewProfile?.avatar || "👤"}
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
                  {/* Compatibility score (moved into UserProfileModal for mobile; kept on desktop) */}
                  {matchScore !== null && (
                    <div className="hidden sm:block text-center py-1.5 bg-zinc-950/80 text-xs font-semibold text-zinc-400 border-b border-zinc-800/80">
                      Match compatibility:{" "}
                      <span className="text-indigo-400 font-bold">{Math.round(matchScore)}%</span>
                    </div>
                  )}

                  {/* Add Friend Banner (integrated into UserProfileModal for mobile; kept on desktop) */}
                  <div className="hidden sm:flex px-4 py-2 border-b border-zinc-800/80 bg-zinc-950/60 items-center justify-between shrink-0">
                    {isAlreadyFriend ? (
                      <div className="w-full text-center bg-indigo-950/40 border border-indigo-800/50 text-indigo-300 py-1.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5">
                        <span>✓</span>
                        <span>Already Friends</span>
                      </div>
                    ) : friendRequestSent ? (
                      <div className="w-full text-center bg-emerald-950/50 border border-emerald-800/60 text-emerald-300 py-1.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5">
                        <span>✓</span>
                        <span>Friend request sent</span>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={sendFriendRequest}
                        disabled={!strangerUserId || isSendingFriendRequest}
                        className="w-full bg-indigo-600 hover:bg-indigo-500 text-white py-1.5 rounded-xl text-xs font-semibold transition disabled:bg-zinc-800 disabled:text-zinc-500 disabled:cursor-not-allowed shadow-xs flex items-center justify-center gap-1.5 active:scale-98"
                      >
                        <span>👥</span>
                        <span>{isSendingFriendRequest ? "Sending request..." : "Add Stranger as Friend"}</span>
                      </button>
                    )}
                  </div>

                  {/* Full size message list and composer */}
                  {strangerChatBody}

                  {/* Action Footer: Next Stranger & End Chat (compacted to preserve vertical screen space) */}
                  <div className="grid grid-cols-2 border-t border-zinc-800/90 divide-x divide-zinc-800/90 bg-zinc-900 shrink-0 safe-bottom">
                    <button
                      onClick={handleNextStranger}
                      className="py-2 sm:py-2.5 text-xs sm:text-sm font-semibold text-indigo-400 hover:bg-zinc-800 transition flex items-center justify-center gap-1.5 active:scale-95"
                    >
                      <span>⏭️</span>
                      <span>Next Stranger</span>
                    </button>
                    <button
                      onClick={handleExitStrangerChat}
                      className="py-2 sm:py-2.5 text-xs sm:text-sm font-semibold text-rose-400 hover:bg-zinc-800 transition flex items-center justify-center gap-1.5 active:scale-95"
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
            <div className="flex-1 w-full flex flex-col items-center justify-start p-3 sm:p-6 md:p-8 overflow-y-auto min-h-0 safe-bottom">
              <div className="w-full max-w-lg bg-zinc-900/90 backdrop-blur-md border border-zinc-800/90 rounded-3xl p-4 sm:p-6 md:p-8 shadow-2xl text-zinc-100 my-auto">
                <h1 className="text-2xl sm:text-3xl font-extrabold text-white text-center tracking-tight">
                  Stranger Chat
                </h1>
                <p className="text-zinc-400 mt-1.5 text-center text-xs sm:text-sm">
                  Connect anonymously with people worldwide matching your interests.
                </p>

                {/* Active Stranger Chat Resume Banner */}
                {strangerRoomId && strangerStatus !== "disconnected" && (
                  <div className="mt-5 p-3.5 rounded-2xl bg-indigo-950/50 border border-indigo-500/40 flex items-center justify-between gap-3 animate-fadeIn">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-white truncate">Active Stranger Chat</p>
                        <p className="text-[11px] text-indigo-300 truncate">Your conversation is still active</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => navigateTo("stranger-chat")}
                      className="px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition shadow-xs shrink-0 active:scale-95"
                    >
                      Return to Chat →
                    </button>
                  </div>
                )}

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
                  <label htmlFor="pref-language" className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">
                    Language
                  </label>
                  <select
                    id="pref-language"
                    aria-label="Language"
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
                  <label htmlFor="pref-goal" className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">
                    What are you looking for?
                  </label>
                  <select
                    id="pref-goal"
                    aria-label="What are you looking for?"
                    value={goal}
                    onChange={(e) => setGoal(e.target.value)}
                    className="w-full border border-zinc-800 bg-zinc-950 rounded-2xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-indigo-500 transition"
                  >
                    {CANONICAL_GOALS.map((g) => (
                      <option key={g.value} value={g.value}>
                        {g.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Save Preferences Button */}
                <div className="mt-4 flex items-center justify-between pt-3 border-t border-zinc-800/80">
                  <span className="text-[11px] text-zinc-500">
                    Syncs to your profile &amp; sidebar
                  </span>
                  <button
                    type="button"
                    onClick={handleSavePreferences}
                    disabled={savingPreferences}
                    className="px-3.5 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 hover:text-white border border-zinc-700/60 text-xs font-semibold transition active:scale-95 disabled:opacity-50 flex items-center gap-1.5 cursor-pointer shadow-xs"
                    title="Save your current language, interests, and goal"
                  >
                    <span>💾</span>
                    <span>{savingPreferences ? "Saving..." : "Save Preferences"}</span>
                  </button>
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
                        There isn&apos;t a stranger available at the moment. You can keep waiting for someone to come online, or discover people already on Chirp.
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
                        Looking for lasting connections? Browse real Chirp members, search by interests, filter by gender or online status, and chat privately anytime.
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
          if (Array.isArray(updatedProfile.interests)) {
            setInterests(updatedProfile.interests);
          }
          if (updatedProfile.language) {
            setLanguage(updatedProfile.language);
          }
          if (updatedProfile.goal) {
            setGoal(updatedProfile.goal);
          }
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
      <UserProfileModal
        user={viewProfile}
        onClose={() => setViewProfile(null)}
        matchScore={
          currentView === "stranger-chat" && viewProfile?.id === strangerUserId
            ? matchScore
            : null
        }
        onAddFriend={
          currentView === "stranger-chat" && strangerUserId && viewProfile?.id === strangerUserId
            ? sendFriendRequest
            : undefined
        }
        isAlreadyFriend={isAlreadyFriend}
        friendRequestSent={friendRequestSent}
        isSendingFriendRequest={isSendingFriendRequest}
      />
    </div>
  );
}