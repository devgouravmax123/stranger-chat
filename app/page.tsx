"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { io, Socket } from "socket.io-client";

import ChatHeader from "@/components/ChatHeader";
import MessageInput from "@/components/MessageInput";
import MessageList, { Message } from "@/components/MessageList";
import ProfileSetup from "@/components/ProfileSetup";
import UserProfileModal from "@/components/UserProfileModal";
import ReportModal from "@/components/ReportModal";

// ==========================================
// NAVIGATION & VIEW TYPES
// ==========================================

export type AppView =
  | "profile-setup"
  | "matching"
  | "stranger-chat"
  | "friends"
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

// ==========================================
// USER PROFILE TYPE
// ==========================================

type UserProfile = {
  id: string;
  username: string | null;
  age: number | null;
  gender: string | null;
  avatar: string | null;
  language: string | null;
  interests: string[];
  goal: string | null;
};

export default function Home() {
  // ==========================================
  // CORE STATE
  // ==========================================

  const [socket, setSocket] = useState<Socket | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const userIdRef = useRef<string | null>(null);

  const [currentView, setCurrentView] = useState<AppView>("profile-setup");
  const [profileCompleted, setProfileCompleted] = useState(false);

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
  const [friendMessages, setFriendMessages] = useState<Message[]>([]);
  const [friendMessage, setFriendMessage] = useState("");
  const [friendChatLoading, setFriendChatLoading] = useState(false);
  const [friendReplyingTo, setFriendReplyingTo] = useState<Message | null>(null);

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
  // BROWSER HISTORY & NAVIGATION MANAGEMENT
  // ==========================================

  const navigateTo = useCallback(
    (view: AppView, pushToHistory = true) => {
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
          // Leaving stranger chat via browser back
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

      // Check if user already has a completed profile in DB
      try {
        const res = await fetch(`http://localhost:3001/users/${data.userId}/profile`);
        if (res.ok) {
          const profile = await res.json();
          if (profile && profile.username) {
            setProfileCompleted(true);
            setCurrentView("matching");
            if (profile.language) setLanguage(profile.language);
            if (profile.interests && Array.isArray(profile.interests)) setInterests(profile.interests);
            if (profile.goal) setGoal(profile.goal);
          }
        }
      } catch (e) {
        console.warn("Could not check existing profile:", e);
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
      setWaiting(false);
      setUserId(data.userId);
      userIdRef.current = data.userId;
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
      }
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

        // Acknowledge seen if active in stranger-chat
        newSocket.emit("mark_seen", { messageIds: [data.id] });
      }
    );

    newSocket.on("message_seen", (data: { chatId: string; messageIds?: string[] }) => {
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
    });

    newSocket.on("message_deleted", (data: { messageId: string }) => {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === data.messageId
            ? { ...msg, deletedAt: new Date().toISOString() }
            : msg
        )
      );
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
    });

    newSocket.on("friend_room_error", (data: { message: string }) => {
      setFriendChatLoading(false);
      setFriendsError(data.message || "Could not open private chat");
    });

    return () => {
      newSocket.disconnect();
    };
  }, [navigateTo, showNotification]);

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

  const findStranger = async () => {
    if (!socket || !userId) return;

    const preferences: MatchPreferences = {
      language,
      interests,
      goal,
    };

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
    } catch (error) {
      console.error("Preference save error:", error);
      setWaiting(false);
      showNotification("Could not save matching preferences.");
    }
  };

  // FEATURE 1: Skip / Next Stranger
  const handleNextStranger = () => {
    if (!socket) return;

    setMessages([]);
    setReplyingTo(null);
    setStrangerTyping(false);
    setMatchScore(null);
    setStrangerUserId(null);
    setFriendRequestSent(false);
    setFriendRequestMessage("");
    setMessage("");
    setViewProfile(null);
    setWaiting(true);

    socket.emit("next_stranger");
  };

  // FEATURE 7: Exit Stranger Chat Safely
  const handleExitStrangerChat = () => {
    if (socket) {
      socket.emit("end_chat");
    }
    setMessages([]);
    setReplyingTo(null);
    setStrangerTyping(false);
    setMatchScore(null);
    setStrangerUserId(null);
    setFriendRequestSent(false);
    setFriendRequestMessage("");
    setMessage("");
    setViewProfile(null);
    setWaiting(false);

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
  // RENDER: LOADING CONNECTION
  // ==========================================

  if (!userId) {
    return (
      <main className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white rounded-2xl p-8 shadow-xl text-center">
          <h1 className="text-2xl font-bold text-zinc-900">Stranger Chat</h1>
          <p className="mt-3 text-zinc-500">Connecting to server...</p>
          <div className="mt-6">
            <div className="animate-spin h-8 w-8 border-4 border-zinc-300 border-t-zinc-900 rounded-full mx-auto" />
          </div>
        </div>
      </main>
    );
  }

  // ==========================================
  // RENDER: PROFILE SETUP
  // ==========================================

  if (!profileCompleted) {
    return (
      <main className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
        <ProfileSetup
          userId={userId}
          onComplete={() => {
            setProfileCompleted(true);
            navigateTo("matching");
          }}
        />
      </main>
    );
  }

  // ==========================================
  // RENDER: NOTIFICATION BANNER
  // ==========================================

  const notificationBanner = notification && (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white shadow-2xl flex items-center gap-2 animate-bounce">
      <span>💬</span>
      <span>{notification}</span>
    </div>
  );

  // ==========================================
  // RENDER: PRIVATE FRIEND CHAT
  // ==========================================

  if (currentView === "friend-chat") {
    return (
      <main className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
        {notificationBanner}
        <div className="w-full max-w-lg h-[650px] bg-white rounded-2xl overflow-hidden flex flex-col shadow-2xl">
          {/* Header */}
          <div className="flex items-center gap-3 px-5 py-4 border-b">
            <button
              onClick={closeFriendChat}
              className="px-3 py-2 rounded-lg bg-zinc-100 text-zinc-800 text-sm font-medium hover:bg-zinc-200 transition"
            >
              ← Back to Friends
            </button>

            <div className="flex-1 min-w-0">
              <h1 className="font-semibold text-zinc-900 truncate">
                {selectedFriend?.avatar && <span className="mr-2">{selectedFriend.avatar}</span>}
                {selectedFriend?.username || "Friend"}
              </h1>
              <p className="text-xs text-zinc-500">Private 1-to-1 chat</p>
            </div>

            <button
              type="button"
              onClick={() => openUserProfile(selectedFriend?.id || null)}
              disabled={!selectedFriend?.id}
              className="px-3 py-2 rounded-lg bg-zinc-100 text-zinc-700 text-sm font-medium hover:bg-zinc-200 disabled:opacity-50"
            >
              👤 Profile
            </button>
          </div>

          {friendChatLoading ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <div className="animate-spin h-8 w-8 border-4 border-zinc-300 border-t-zinc-900 rounded-full mx-auto" />
                <p className="mt-4 text-sm text-zinc-500">Opening private chat...</p>
              </div>
            </div>
          ) : (
            <>
              <MessageList
                messages={friendMessages}
                onReplyMessage={(msg) => setFriendReplyingTo(msg)}
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
            </>
          )}
        </div>

        <UserProfileModal user={viewProfile} onClose={() => setViewProfile(null)} />
      </main>
    );
  }

  // ==========================================
  // RENDER: FRIENDS PANEL
  // ==========================================

  if (currentView === "friends") {
    return (
      <main className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
        {notificationBanner}
        <div className="w-full max-w-lg bg-white rounded-2xl overflow-hidden shadow-2xl">
          <div className="flex items-center justify-between px-6 py-5 border-b">
            <div>
              <h1 className="text-2xl font-bold text-zinc-900">Friends</h1>
              <p className="text-sm text-zinc-500 mt-1">Manage your friends and requests</p>
            </div>
            <button
              onClick={() => {
                setFriendsError("");
                navigateTo("matching");
              }}
              className="px-4 py-2 rounded-lg bg-zinc-900 text-white text-sm font-medium hover:bg-zinc-700 transition"
            >
              ← Back
            </button>
          </div>

          <div className="p-6 max-h-[500px] overflow-y-auto">
            {friendsError && (
              <div className="mb-4 rounded-lg bg-red-50 text-red-600 px-4 py-3 text-sm">
                {friendsError}
              </div>
            )}

            {/* Requests */}
            <section>
              <h2 className="text-lg font-semibold text-zinc-900">Friend Requests</h2>
              <div className="mt-3 space-y-3">
                {friendRequests.length === 0 ? (
                  <p className="text-sm text-zinc-500">No pending requests.</p>
                ) : (
                  friendRequests.map((request) => (
                    <div key={request.id} className="border rounded-xl p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="font-medium text-zinc-900">
                            {request.sender.avatar && (
                              <span className="mr-2">{request.sender.avatar}</span>
                            )}
                            {request.sender.username || "Anonymous"}
                          </p>
                          {request.sender.age && (
                            <p className="text-xs text-zinc-500">Age: {request.sender.age}</p>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => acceptFriendRequest(request.id)}
                            className="px-3 py-1.5 rounded-lg bg-zinc-900 text-white text-xs font-medium hover:bg-zinc-700"
                          >
                            Accept
                          </button>
                          <button
                            onClick={() => rejectFriendRequest(request.id)}
                            className="px-3 py-1.5 rounded-lg bg-zinc-100 text-zinc-700 text-xs hover:bg-zinc-200"
                          >
                            Decline
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>

            {/* Friend List */}
            <section className="mt-6">
              <h2 className="text-lg font-semibold text-zinc-900">Your Friends</h2>
              <div className="mt-3 space-y-3">
                {friendsLoading ? (
                  <p className="text-sm text-zinc-500">Loading friends...</p>
                ) : friends.length === 0 ? (
                  <p className="text-sm text-zinc-500">No friends yet. Add strangers during chat!</p>
                ) : (
                  friends.map((item) => (
                    <div key={item.friendshipId} className="border rounded-xl p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="font-medium text-zinc-900">
                            {item.friend.avatar && (
                              <span className="mr-2">{item.friend.avatar}</span>
                            )}
                            {item.friend.username || "Anonymous"}
                          </p>
                          {item.friend.age && (
                            <p className="text-xs text-zinc-500">Age: {item.friend.age}</p>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => openFriendChat(item)}
                            className="px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
                          >
                            💬 Chat
                          </button>
                          <button
                            onClick={() => removeFriend(item.friend.id)}
                            className="px-3 py-2 rounded-lg bg-red-50 text-red-600 text-sm hover:bg-red-100"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        </div>
      </main>
    );
  }

  // ==========================================
  // RENDER: STRANGER CHAT SCREEN
  // ==========================================

  if (currentView === "stranger-chat") {
    return (
      <main className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
        {notificationBanner}
        <div className="w-full max-w-lg h-[680px] bg-white rounded-2xl overflow-hidden flex flex-col shadow-2xl">
          {/* Enhanced Chat Header with Back, Status, Report, Block */}
          <ChatHeader
            onViewProfile={() => openUserProfile(strangerUserId)}
            onBack={handleExitStrangerChat}
            onReport={() => setIsReportOpen(true)}
            onBlock={handleBlockStranger}
            status={strangerStatus}
          />

          {/* Compatibility score */}
          {matchScore !== null && (
            <div className="text-center py-1.5 bg-zinc-50 text-xs font-semibold text-zinc-600 border-b">
              Match compatibility:{" "}
              <span className="text-zinc-900 font-bold">{matchScore.toFixed(0)}%</span>
            </div>
          )}

          {/* Add Friend Banner */}
          <div className="px-4 py-2 border-b bg-zinc-50/50 flex items-center justify-between">
            {!friendRequestSent ? (
              <button
                onClick={sendFriendRequest}
                disabled={!strangerUserId}
                className="w-full bg-blue-600 text-white py-1.5 rounded-lg text-xs font-medium hover:bg-blue-700 transition disabled:bg-zinc-300 disabled:cursor-not-allowed"
              >
                👥 Add Stranger as Friend
              </button>
            ) : (
              <div className="w-full text-center bg-green-50 text-green-700 py-1.5 rounded-lg text-xs font-semibold">
                ✓ Friend request sent
              </div>
            )}
          </div>

          {/* Message List with Delivery, Reactions, Replies, Soft-Delete */}
          <MessageList
            messages={messages}
            onToggleReaction={handleToggleReaction}
            onDeleteMessage={handleDeleteMessage}
            onReplyMessage={handleReplyMessage}
          />

          {/* Real-time typing indicator */}
          {strangerTyping && (
            <div className="px-6 py-1.5 text-xs text-zinc-400 animate-pulse bg-white flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-zinc-400 animate-ping" />
              Stranger is typing...
            </div>
          )}

          {/* Input bar supporting text, voice, image, replies, debounced typing */}
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

          {/* Action Footer: Next Stranger & End Chat */}
          <div className="grid grid-cols-2 border-t divide-x">
            <button
              onClick={handleNextStranger}
              className="py-3 text-sm font-semibold text-blue-600 hover:bg-blue-50 transition"
            >
              ⏭️ Next Stranger
            </button>
            <button
              onClick={handleExitStrangerChat}
              className="py-3 text-sm font-semibold text-red-600 hover:bg-red-50 transition"
            >
              ✕ End Chat
            </button>
          </div>
        </div>

        {/* Report Modal */}
        <ReportModal
          isOpen={isReportOpen}
          onClose={() => setIsReportOpen(false)}
          onSubmit={handleReportSubmit}
        />

        {/* User Profile Modal */}
        <UserProfileModal user={viewProfile} onClose={() => setViewProfile(null)} />
      </main>
    );
  }

  // ==========================================
  // RENDER: MAIN MATCHING SCREEN
  // ==========================================

  return (
    <main className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
      {notificationBanner}
      <div className="w-full max-w-md bg-white rounded-2xl p-8 shadow-2xl">
        <h1 className="text-3xl font-extrabold text-zinc-900 text-center tracking-tight">
          Stranger Chat
        </h1>
        <p className="text-zinc-500 mt-2 text-center text-sm">
          Connect anonymously with people worldwide.
        </p>

        <button
          onClick={openFriends}
          className="mt-6 w-full border border-zinc-300 text-zinc-800 px-6 py-3 rounded-xl font-medium hover:bg-zinc-50 transition flex items-center justify-center gap-2"
        >
          <span>👥</span>
          <span>Friends & Requests</span>
        </button>

        <div className="mt-6">
          <label className="block text-sm font-medium text-zinc-700 mb-2">Language</label>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="w-full border border-zinc-300 rounded-xl px-4 py-3 text-sm focus:border-zinc-500 outline-none"
          >
            <option>English</option>
            <option>Hindi</option>
            <option>Kannada</option>
            <option>Telugu</option>
            <option>Tamil</option>
            <option>Spanish</option>
          </select>
        </div>

        <div className="mt-5">
          <label className="block text-sm font-medium text-zinc-700 mb-2">Interests</label>
          <div className="flex flex-wrap gap-2">
            {availableInterests.map((interest) => (
              <button
                key={interest}
                type="button"
                onClick={() => toggleInterest(interest)}
                className={`px-3.5 py-2 rounded-xl text-xs font-semibold border transition ${
                  interests.includes(interest)
                    ? "bg-zinc-900 text-white border-zinc-900"
                    : "bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-50"
                }`}
              >
                {interest}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5">
          <label className="block text-sm font-medium text-zinc-700 mb-2">
            What are you looking for?
          </label>
          <select
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            className="w-full border border-zinc-300 rounded-xl px-4 py-3 text-sm focus:border-zinc-500 outline-none"
          >
            <option value="casual-chat">Casual Chat</option>
            <option value="friendship">Friendship</option>
            <option value="learning">Language & Learning</option>
            <option value="networking">Networking</option>
          </select>
        </div>

        {!waiting ? (
          <button
            onClick={findStranger}
            className="mt-6 w-full bg-zinc-900 text-white px-6 py-3.5 rounded-xl font-medium hover:bg-zinc-800 transition shadow-lg"
          >
            ⚡ Find a Stranger
          </button>
        ) : (
          <div className="mt-6 text-center py-4 bg-zinc-50 rounded-xl border border-zinc-100 animate-pulse">
            <div className="animate-spin h-6 w-6 border-2 border-zinc-400 border-t-zinc-900 rounded-full mx-auto" />
            <p className="mt-3 text-zinc-800 font-semibold text-sm">Searching for someone...</p>
            <p className="mt-1 text-xs text-zinc-400">Finding your best match</p>
            <button
              onClick={() => {
                setWaiting(false);
                if (socket) socket.emit("end_chat");
              }}
              className="mt-3 text-xs text-red-500 hover:underline"
            >
              Cancel search
            </button>
          </div>
        )}
      </div>

      <UserProfileModal user={viewProfile} onClose={() => setViewProfile(null)} />
    </main>
  );
}