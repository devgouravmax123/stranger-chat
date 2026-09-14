"use client";

import {
  useEffect,
  useRef,
  useState,
} from "react";

import { io, Socket } from "socket.io-client";

import ChatHeader from "@/components/ChatHeader";
import MessageInput from "@/components/MessageInput";
import MessageList from "@/components/MessageList";
import ProfileSetup from "@/components/ProfileSetup";
import UserProfileModal from "@/components/UserProfileModal";

// ==========================================
// MESSAGE TYPES
// ==========================================

export type Message = {
  text: string;
  sender: "me" | "stranger";
  timestamp: number;
};

type MatchPreferences = {
  language: string;
  interests: string[];
  goal: string;
};

type ReceivedMessage = {
  text: string;
  senderId: string;
  timestamp: number;
};

type ChatHistoryItem = {
  id: string;
  content: string;
  senderId: string;
  chatId: string;
  createdAt: string;
};

type ChatHistoryData = {
  messages: ChatHistoryItem[];
  userId: string;
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
};

type FriendRoomOpenedData = {
  roomId: string;
  friendId: string;
  messages: FriendRoomMessage[];
};

type ReceivedFriendMessage = {
  id: string;
  text: string;
  senderId: string;
  timestamp: number;
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
  // SOCKET
  // ==========================================

  const [socket, setSocket] =
    useState<Socket | null>(null);

  // ==========================================
  // USER ID
  // ==========================================

  const [userId, setUserId] =
    useState<string | null>(null);

  /*
   * IMPORTANT:
   * Socket.IO listeners created inside useEffect([])
   * can otherwise capture an old userId value.
   *
   * This ref always contains the latest user ID.
   */
  const userIdRef =
    useRef<string | null>(null);

  // ==========================================
  // STRANGER CHAT STATE
  // ==========================================

  const [matched, setMatched] =
    useState(false);

  const [waiting, setWaiting] =
    useState(false);

  const [typing, setTyping] =
    useState(false);

  const [message, setMessage] =
    useState("");

  const [messages, setMessages] =
    useState<Message[]>([]);

  const [strangerUserId, setStrangerUserId] =
    useState<string | null>(null);

  const [matchScore, setMatchScore] =
    useState<number | null>(null);

  const [profileCompleted, setProfileCompleted] =
    useState(false);

  // ==========================================
  // VIEW PROFILE STATE
  // ==========================================

  const [viewProfile, setViewProfile] =
    useState<UserProfile | null>(null);

  const [profileLoading, setProfileLoading] =
    useState(false);

  const [profileError, setProfileError] =
    useState("");

  // ==========================================
  // FRIEND REQUEST STATE
  // ==========================================

  const [friendRequestSent, setFriendRequestSent] =
    useState(false);

  const [friendRequestMessage, setFriendRequestMessage] =
    useState("");

  // ==========================================
  // FRIENDS STATE
  // ==========================================

  const [showFriends, setShowFriends] =
    useState(false);

  const [friends, setFriends] =
    useState<Friendship[]>([]);

  const [friendRequests, setFriendRequests] =
    useState<FriendRequest[]>([]);

  const [friendsLoading, setFriendsLoading] =
    useState(false);

  const [friendsError, setFriendsError] =
    useState("");

  // ==========================================
  // PRIVATE FRIEND CHAT STATE
  // ==========================================

  const [friendChatOpen, setFriendChatOpen] =
    useState(false);

  const [selectedFriend, setSelectedFriend] =
    useState<Friend | null>(null);

  const [friendRoomId, setFriendRoomId] =
    useState<string | null>(null);

  const [friendMessages, setFriendMessages] =
    useState<Message[]>([]);

  const [friendMessage, setFriendMessage] =
    useState("");

  const [friendChatLoading, setFriendChatLoading] =
    useState(false);

  // ==========================================
  // MATCHING PREFERENCES
  // ==========================================

  const [language, setLanguage] =
    useState("English");

  const [interests, setInterests] =
    useState<string[]>([]);

  const [goal, setGoal] =
    useState("casual-chat");

  const availableInterests = [
    "Coding",
    "Gaming",
    "Music",
    "Movies",
    "Sports",
    "Travel",
  ];

  const toggleInterest = (
    interest: string,
  ) => {
    setInterests((previous) =>
      previous.includes(interest)
        ? previous.filter(
            (item) => item !== interest,
          )
        : [...previous, interest],
    );
  };

  // ==========================================
  // SOCKET CONNECTION
  // ==========================================

  useEffect(() => {
    const newSocket = io(
      "http://localhost:3001",
    );

    setSocket(newSocket);

    // ==========================================
    // CONNECT
    // ==========================================

    newSocket.on("connect", () => {
      console.log(
        "Connected to backend:",
        newSocket.id,
      );
    });

    // ==========================================
    // USER READY
    // ==========================================

    newSocket.on(
      "user_ready",
      (data: UserReadyData) => {
        console.log(
          "Database user ready:",
          data.userId,
        );

        setUserId(data.userId);

        // IMPORTANT
        userIdRef.current =
          data.userId;

        newSocket.emit(
          "friend_online",
          {
            userId: data.userId,
          },
        );
      },
    );

    // ==========================================
    // WAITING
    // ==========================================

    newSocket.on("waiting", () => {
      setWaiting(true);
    });

    // ==========================================
    // STRANGER CHAT HISTORY
    // ==========================================

    newSocket.on(
      "chat_history",
      (data: ChatHistoryData) => {
        console.log(
          "Chat history received:",
          data.messages,
        );

        setUserId(data.userId);

        // IMPORTANT
        userIdRef.current =
          data.userId;

        const history: Message[] =
          data.messages.map(
            (item) => ({
              text: item.content,

              sender:
                item.senderId ===
                data.userId
                  ? "me"
                  : "stranger",

              timestamp:
                new Date(
                  item.createdAt,
                ).getTime(),
            }),
          );

        setMessages(history);
      },
    );

    // ==========================================
    // STRANGER MATCHED
    // ==========================================

    newSocket.on(
      "matched",
      (data: MatchedData) => {
        console.log(
          "Matched!",
        );

        console.log(
          "Room ID:",
          data.roomId,
        );

        console.log(
          "My database ID:",
          data.userId,
        );

        console.log(
          "Stranger database ID:",
          data.strangerUserId,
        );

        console.log(
          "Match score:",
          data.score,
        );

        setWaiting(false);
        setMatched(true);

        setUserId(data.userId);

        // IMPORTANT
        userIdRef.current =
          data.userId;

        setStrangerUserId(
          data.strangerUserId,
        );

        setMatchScore(data.score);

        setFriendRequestSent(false);
        setFriendRequestMessage("");
      },
    );

    // ==========================================
    // STRANGER MESSAGE
    // ==========================================

newSocket.on(
  "receive_message",
  (data: ReceivedMessage) => {
    console.log(
      "Stranger message received:",
      data,
    );

    setMessages(
      (previousMessages) => [
        ...previousMessages,
        {
          text: data.text,

          sender:
            data.senderId ===
            userIdRef.current
              ? "me"
              : "stranger",

          timestamp:
            data.timestamp,
        },
      ],
    );
  },
);

    // ==========================================
    // STRANGER TYPING
    // ==========================================

    newSocket.on(
      "stranger_typing",
      () => {
        setTyping(true);
      },
    );

    // ==========================================
    // STRANGER STOPPED TYPING
    // ==========================================

    newSocket.on(
      "stranger_stopped_typing",
      () => {
        setTyping(false);
      },
    );

    // ==========================================
    // STRANGER LEFT
    // ==========================================

    newSocket.on(
      "stranger_left",
      () => {
        setMatched(false);
        setWaiting(false);
        setTyping(false);

        setMessages([]);

        setMatchScore(null);

        setStrangerUserId(null);

        setFriendRequestSent(false);
        setFriendRequestMessage("");

        setViewProfile(null);
      },
    );

    // ==========================================
    // FRIEND ROOM OPENED
    // ==========================================

    newSocket.on(
      "friend_room_opened",
      (
        data: FriendRoomOpenedData,
      ) => {
        console.log(
          "Friend room opened:",
          data,
        );

        setFriendRoomId(
          data.roomId,
        );

        /*
         * Use userIdRef here.
         * This guarantees that the current
         * user's ID is available.
         */

        const currentUserId =
          userIdRef.current;

        const history: Message[] =
          data.messages.map(
            (item) => ({
              text: item.content,

              sender:
                item.senderId ===
                currentUserId
                  ? "me"
                  : "stranger",

              timestamp:
                new Date(
                  item.createdAt,
                ).getTime(),
            }),
          );

        setFriendMessages(history);

        setFriendChatLoading(false);
        setFriendChatOpen(true);
      },
    );

    // ==========================================
    // FRIEND MESSAGE
    // ==========================================

    newSocket.on(
      "receive_friend_message",
      (
        data: ReceivedFriendMessage,
      ) => {
        console.log(
          "Friend message received:",
          data,
        );

        setFriendMessages(
          (previousMessages) => [
            ...previousMessages,
            {
              text: data.text,

              /*
               * IMPORTANT FIX
               *
               * Always compare the database
               * senderId with the current user's
               * database ID.
               */
              sender:
                data.senderId ===
                userIdRef.current
                  ? "me"
                  : "stranger",

              timestamp:
                data.timestamp,
            },
          ],
        );
      },
    );

    // ==========================================
    // FRIEND ROOM ERROR
    // ==========================================

    newSocket.on(
      "friend_room_error",
      (data: {
        message: string;
      }) => {
        console.error(
          "Friend room error:",
          data.message,
        );

        setFriendChatLoading(false);

        setFriendsError(
          data.message ||
            "Could not open private chat",
        );
      },
    );

    // ==========================================
    // DISCONNECT
    // ==========================================

    newSocket.on(
      "disconnect",
      () => {
        console.log(
          "Disconnected from backend",
        );
      },
    );

    return () => {
      newSocket.disconnect();
    };
  }, []);

  // ==========================================
  // LOAD FRIENDS
  // ==========================================

  const loadFriends = async () => {
    if (!userId) {
      return;
    }

    try {
      setFriendsLoading(true);
      setFriendsError("");

      const response =
        await fetch(
          `http://localhost:3001/friends/${userId}`,
        );

      if (!response.ok) {
        throw new Error(
          "Failed to load friends",
        );
      }

      const data: Friendship[] =
        await response.json();

      setFriends(data);
    } catch (error) {
      console.error(
        "Error loading friends:",
        error,
      );

      setFriendsError(
        "Could not load friends",
      );
    } finally {
      setFriendsLoading(false);
    }
  };

  // ==========================================
  // LOAD FRIEND REQUESTS
  // ==========================================

  const loadFriendRequests =
    async () => {
      if (!userId) {
        return;
      }

      try {
        const response =
          await fetch(
            `http://localhost:3001/friends/requests/${userId}`,
          );

        if (!response.ok) {
          throw new Error(
            "Failed to load friend requests",
          );
        }

        const data: FriendRequest[] =
          await response.json();

        setFriendRequests(data);
      } catch (error) {
        console.error(
          "Error loading friend requests:",
          error,
        );

        setFriendsError(
          "Could not load friend requests",
        );
      }
    };

  // ==========================================
  // OPEN FRIENDS
  // ==========================================

  const openFriends = async () => {
    setShowFriends(true);
    setFriendsError("");

    await Promise.all([
      loadFriends(),
      loadFriendRequests(),
    ]);
  };

  // ==========================================
  // SEND FRIEND REQUEST
  // ==========================================

  const sendFriendRequest =
    async () => {
      if (
        !userId ||
        !strangerUserId
      ) {
        console.log(
          "Missing user IDs",
        );

        return;
      }

      try {
        setFriendRequestMessage("");

        const response =
          await fetch(
            "http://localhost:3001/friends/request",
            {
              method: "POST",

              headers: {
                "Content-Type":
                  "application/json",
              },

              body: JSON.stringify({
                senderId: userId,
                receiverId:
                  strangerUserId,
              }),
            },
          );

        const data =
          await response.json();

        if (!response.ok) {
          throw new Error(
            data.message ||
              "Failed to send friend request",
          );
        }

        console.log(
          "Friend request response:",
          data,
        );

        setFriendRequestSent(
          true,
        );

        setFriendRequestMessage(
          "Friend request sent",
        );
      } catch (error) {
        console.error(
          "Friend request error:",
          error,
        );

        setFriendRequestMessage(
          error instanceof Error
            ? error.message
            : "Failed to send friend request",
        );
      }
    };

  // ==========================================
  // ACCEPT FRIEND REQUEST
  // ==========================================

  const acceptFriendRequest =
    async (
      requestId: string,
    ) => {
      if (!userId) {
        return;
      }

      try {
        const response =
          await fetch(
            `http://localhost:3001/friends/request/${requestId}/accept`,
            {
              method: "PUT",

              headers: {
                "Content-Type":
                  "application/json",
              },

              body: JSON.stringify({
                userId,
              }),
            },
          );

        const data =
          await response.json();

        if (!response.ok) {
          throw new Error(
            data.message ||
              "Failed to accept request",
          );
        }

        console.log(
          "Friend request accepted:",
          data,
        );

        await Promise.all([
          loadFriends(),
          loadFriendRequests(),
        ]);
      } catch (error) {
        console.error(
          "Accept request error:",
          error,
        );

        setFriendsError(
          error instanceof Error
            ? error.message
            : "Failed to accept request",
        );
      }
    };

  // ==========================================
  // REJECT FRIEND REQUEST
  // ==========================================

  const rejectFriendRequest =
    async (
      requestId: string,
    ) => {
      if (!userId) {
        return;
      }

      try {
        const response =
          await fetch(
            `http://localhost:3001/friends/request/${requestId}/reject`,
            {
              method: "PUT",

              headers: {
                "Content-Type":
                  "application/json",
              },

              body: JSON.stringify({
                userId,
              }),
            },
          );

        const data =
          await response.json();

        if (!response.ok) {
          throw new Error(
            data.message ||
              "Failed to reject request",
          );
        }

        console.log(
          "Friend request rejected:",
          data,
        );

        await loadFriendRequests();
      } catch (error) {
        console.error(
          "Reject request error:",
          error,
        );

        setFriendsError(
          error instanceof Error
            ? error.message
            : "Failed to reject request",
        );
      }
    };

  // ==========================================
  // REMOVE FRIEND
  // ==========================================

  const removeFriend = async (
    friendId: string,
  ) => {
    if (!userId) {
      return;
    }

    try {
      const response =
        await fetch(
          `http://localhost:3001/friends/${userId}/${friendId}`,
          {
            method: "DELETE",
          },
        );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.message ||
            "Failed to remove friend",
        );
      }

      console.log(
        "Friend removed:",
        data,
      );

      await loadFriends();
    } catch (error) {
      console.error(
        "Remove friend error:",
        error,
      );

      setFriendsError(
        error instanceof Error
          ? error.message
          : "Failed to remove friend",
      );
    }
  };

  // ==========================================
  // OPEN PRIVATE FRIEND CHAT
  // ==========================================

  const openFriendChat = (
    friendship: Friendship,
  ) => {
    if (
      !socket ||
      !userId
    ) {
      return;
    }

    const friend =
      friendship.friend;

    console.log(
      "Opening private chat with:",
      friend,
    );

    setSelectedFriend(
      friend,
    );

    setFriendMessages([]);

    setFriendRoomId(null);

    setFriendChatLoading(
      true,
    );

    setFriendsError("");

    socket.emit(
      "open_friend_room",
      {
        userId,
        friendId: friend.id,
      },
    );
  };

  // ==========================================
  // CLOSE PRIVATE FRIEND CHAT
  // ==========================================

  const closeFriendChat = () => {
    if (
      socket &&
      friendRoomId
    ) {
      socket.emit(
        "leave_friend_room",
        {
          roomId: friendRoomId,
        },
      );
    }

    setFriendChatOpen(false);

    setSelectedFriend(null);

    setFriendRoomId(null);

    setFriendMessages([]);

    setFriendMessage("");

    setViewProfile(null);
  };

  // ==========================================
  // SEND FRIEND MESSAGE
  // ==========================================

  const sendFriendMessage =
    () => {
      if (
        !socket ||
        !userId ||
        !friendRoomId ||
        friendMessage.trim() === ""
      ) {
        return;
      }

      const text =
        friendMessage.trim();

      socket.emit(
        "send_friend_message",
        {
          roomId:
            friendRoomId,

          senderId:
            userId,

          text,
        },
      );

      setFriendMessage("");
    };

  // ==========================================
  // VIEW USER PROFILE
  // ==========================================

  const openUserProfile =
    async (
      targetUserId: string | null,
    ) => {
      if (!targetUserId) {
        return;
      }

      try {
        setProfileLoading(true);
        setProfileError("");
        setViewProfile(null);

        const response =
          await fetch(
            `http://localhost:3001/users/${targetUserId}/profile`,
          );

        const data =
          await response.json();

        if (!response.ok) {
          throw new Error(
            data.message ||
              "Failed to load profile",
          );
        }

        setViewProfile(data);
      } catch (error) {
        console.error(
          "Profile loading error:",
          error,
        );

        setProfileError(
          error instanceof Error
            ? error.message
            : "Could not load profile",
        );
      } finally {
        setProfileLoading(false);
      }
    };

  // ==========================================
  // CLOSE PROFILE
  // ==========================================

  const closeUserProfile =
    () => {
      setViewProfile(null);
      setProfileError("");
    };

  // ==========================================
  // PROFILE COMPLETE
  // ==========================================

  const handleProfileComplete =
    () => {
      console.log(
        "Profile completed",
      );

      setProfileCompleted(
        true,
      );
    };

  // ==========================================
  // FIND STRANGER
  // ==========================================

  const findStranger = () => {
    if (!socket) {
      return;
    }

    const preferences: MatchPreferences =
      {
        language,
        interests,
        goal,
      };

    console.log(
      "Sending preferences:",
      preferences,
    );

    setMessages([]);

    setWaiting(true);

    setTyping(false);

    setFriendRequestSent(
      false,
    );

    setFriendRequestMessage(
      "",
    );

    setStrangerUserId(null);

    socket.emit(
      "find_stranger",
      preferences,
    );
  };

  // ==========================================
  // NEXT STRANGER
  // ==========================================

  const nextStranger = () => {
    if (!socket) {
      return;
    }

    setMessages([]);

    setTyping(false);

    setMatched(false);

    setWaiting(true);

    setMatchScore(null);

    setStrangerUserId(null);

    setFriendRequestSent(
      false,
    );

    setFriendRequestMessage(
      "",
    );

    setMessage("");

    setViewProfile(null);

    socket.emit(
      "next_stranger",
    );
  };

  // ==========================================
  // END STRANGER CHAT
  // ==========================================

  const endChat = () => {
    if (!socket) {
      return;
    }

    socket.emit("end_chat");

    setMatched(false);

    setWaiting(false);

    setTyping(false);

    setMessages([]);

    setMatchScore(null);

    setStrangerUserId(null);

    setFriendRequestSent(
      false,
    );

    setFriendRequestMessage(
      "",
    );

    setMessage("");

    setViewProfile(null);
  };

  // ==========================================
  // SEND STRANGER MESSAGE
  // ==========================================

  const sendMessage = () => {
    if (
      !socket ||
      message.trim() === ""
    ) {
      return;
    }

    socket.emit(
      "send_message",
      {
        text: message,
      },
    );

    socket.emit(
      "stop_typing",
    );

    setMessage("");
  };

  // ==========================================
  // STRANGER TYPING
  // ==========================================

  const handleTyping = (
    value: string,
  ) => {
    setMessage(value);

    if (!socket) {
      return;
    }

    if (
      value.trim() === ""
    ) {
      socket.emit(
        "stop_typing",
      );

      return;
    }

    socket.emit("typing");
  };

  // ==========================================
  // WAITING FOR USER ID
  // ==========================================

  if (!userId) {
    return (
      <main className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white rounded-2xl p-8 shadow-xl text-center">

          <h1 className="text-2xl font-bold text-zinc-900">
            Stranger Chat
          </h1>

          <p className="mt-3 text-zinc-500">
            Connecting to server...
          </p>

          <div className="mt-6">
            <div className="animate-spin h-8 w-8 border-4 border-zinc-300 border-t-zinc-900 rounded-full mx-auto" />
          </div>

        </div>
      </main>
    );
  }

  // ==========================================
  // PROFILE SCREEN
  // ==========================================

  if (!profileCompleted) {
    return (
      <main className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">

        <ProfileSetup
          userId={userId}
          onComplete={
            handleProfileComplete
          }
        />

      </main>
    );
  }

  // ==========================================
  // PRIVATE FRIEND CHAT SCREEN
  // ==========================================

  if (friendChatOpen) {
    return (
      <main className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">

        <div className="w-full max-w-lg h-[650px] bg-white rounded-2xl overflow-hidden flex flex-col shadow-xl">

          {/* HEADER */}

          <div className="flex items-center gap-3 px-5 py-4 border-b">

            <button
              onClick={
                closeFriendChat
              }
              className="px-3 py-2 rounded-lg bg-zinc-100 text-zinc-800 text-sm hover:bg-zinc-200"
            >
              ← Back
            </button>

            <div className="flex-1">

              <h1 className="font-semibold text-zinc-900">

                {selectedFriend?.avatar && (
                  <span className="mr-2">
                    {
                      selectedFriend.avatar
                    }
                  </span>
                )}

                {selectedFriend?.username ||
                  "Friend"}

              </h1>

              <p className="text-xs text-zinc-500">
                Private 1-to-1 chat
              </p>

            </div>

            {/* VIEW FRIEND PROFILE */}

            <button
              type="button"
              onClick={() =>
                openUserProfile(
                  selectedFriend?.id ||
                    null,
                )
              }
              disabled={
                !selectedFriend?.id
              }
              className="px-3 py-2 rounded-lg bg-zinc-100 text-zinc-700 text-sm font-medium hover:bg-zinc-200 disabled:opacity-50"
            >
              👤 Profile
            </button>

          </div>

          {/* LOADING */}

          {friendChatLoading ? (
            <div className="flex-1 flex items-center justify-center">

              <div className="text-center">

                <div className="animate-spin h-8 w-8 border-4 border-zinc-300 border-t-zinc-900 rounded-full mx-auto" />

                <p className="mt-4 text-sm text-zinc-500">
                  Opening private chat...
                </p>

              </div>

            </div>
          ) : (
            <>
              {/* MESSAGES */}

              <MessageList
                messages={
                  friendMessages
                }
              />

              {/* INPUT */}

              <MessageInput
                message={
                  friendMessage
                }
                setMessage={
                  setFriendMessage
                }
                sendMessage={
                  sendFriendMessage
                }
              />
            </>
          )}

        </div>

        {/* PROFILE LOADING */}

        {profileLoading && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">

            <div className="rounded-xl bg-white px-6 py-5 shadow-xl">

              <p className="text-sm text-zinc-600">
                Loading profile...
              </p>

            </div>

          </div>
        )}

        {/* PROFILE ERROR */}

        {profileError && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">

            <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl text-center">

              <p className="text-sm text-red-600">
                {profileError}
              </p>

              <button
                type="button"
                onClick={
                  closeUserProfile
                }
                className="mt-4 rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white"
              >
                Close
              </button>

            </div>

          </div>
        )}

        <UserProfileModal
          user={viewProfile}
          onClose={
            closeUserProfile
          }
        />

      </main>
    );
  }

  // ==========================================
  // FRIENDS PANEL
  // ==========================================

  if (showFriends) {
    return (
      <main className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">

        <div className="w-full max-w-lg bg-white rounded-2xl overflow-hidden shadow-xl">

          {/* HEADER */}

          <div className="flex items-center justify-between px-6 py-5 border-b">

            <div>
              <h1 className="text-2xl font-bold text-zinc-900">
                Friends
              </h1>

              <p className="text-sm text-zinc-500 mt-1">
                Manage your friends and requests
              </p>
            </div>

            <button
              onClick={() => {
                setShowFriends(
                  false,
                );

                setFriendsError("");
              }}
              className="px-4 py-2 rounded-lg bg-zinc-900 text-white text-sm hover:bg-zinc-700"
            >
              Back
            </button>

          </div>

          <div className="p-6">

            {/* ERROR */}

            {friendsError && (
              <div className="mb-4 rounded-lg bg-red-50 text-red-600 px-4 py-3 text-sm">
                {friendsError}
              </div>
            )}

            {/* FRIEND REQUESTS */}

            <section>

              <h2 className="text-lg font-semibold text-zinc-900">
                Friend Requests
              </h2>

              <div className="mt-3 space-y-3">

                {friendRequests.length ===
                0 ? (
                  <p className="text-sm text-zinc-500">
                    No pending requests.
                  </p>
                ) : (
                  friendRequests.map(
                    (request) => (
                      <div
                        key={
                          request.id
                        }
                        className="border rounded-xl p-4"
                      >

                        <div className="flex items-center justify-between gap-3">

                          <div>

                            <p className="font-medium text-zinc-900">

                              {request
                                .sender
                                .avatar && (
                                <span className="mr-2">
                                  {
                                    request
                                      .sender
                                      .avatar
                                  }
                                </span>
                              )}

                              {request
                                .sender
                                .username ||
                                "Stranger"}

                            </p>

                            <p className="text-xs text-zinc-500 mt-1">
                              Wants to be your friend
                            </p>

                          </div>

                          <div className="flex gap-2">

                            <button
                              onClick={() =>
                                acceptFriendRequest(
                                  request.id,
                                )
                              }
                              className="px-3 py-2 rounded-lg bg-green-600 text-white text-sm hover:bg-green-700"
                            >
                              Accept
                            </button>

                            <button
                              onClick={() =>
                                rejectFriendRequest(
                                  request.id,
                                )
                              }
                              className="px-3 py-2 rounded-lg bg-zinc-200 text-zinc-700 text-sm hover:bg-zinc-300"
                            >
                              Reject
                            </button>

                          </div>

                        </div>

                      </div>
                    ),
                  )
                )}

              </div>

            </section>

            <div className="my-7 border-t" />

            {/* MY FRIENDS */}

            <section>

              <h2 className="text-lg font-semibold text-zinc-900">
                My Friends
              </h2>

              <div className="mt-3 space-y-3">

                {friendsLoading ? (
                  <p className="text-sm text-zinc-500">
                    Loading friends...
                  </p>
                ) : friends.length ===
                  0 ? (
                  <p className="text-sm text-zinc-500">
                    You don't have any friends yet.
                  </p>
                ) : (
                  friends.map(
                    (item) => (
                      <div
                        key={
                          item.friendshipId
                        }
                        className="border rounded-xl p-4"
                      >

                        <div className="flex items-center justify-between gap-3">

                          {/* FRIEND INFO */}

                          <div className="flex items-center gap-3">

                            <div className="text-2xl">
                              {item.friend
                                .avatar ||
                                "👤"}
                            </div>

                            <div>

                              <p className="font-medium text-zinc-900">
                                {item.friend
                                  .username ||
                                  "Friend"}
                              </p>

                              {item.friend
                                .age !==
                                null && (
                                <p className="text-xs text-zinc-500">
                                  Age:{" "}
                                  {
                                    item
                                      .friend
                                      .age
                                  }
                                </p>
                              )}

                            </div>

                          </div>

                          {/* ACTIONS */}

                          <div className="flex gap-2">

                            {/* CHAT */}

                            <button
                              onClick={() =>
                                openFriendChat(
                                  item,
                                )
                              }
                              className="px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
                            >
                              💬 Chat
                            </button>

                            {/* REMOVE */}

                            <button
                              onClick={() =>
                                removeFriend(
                                  item
                                    .friend
                                    .id,
                                )
                              }
                              className="px-3 py-2 rounded-lg bg-red-50 text-red-600 text-sm hover:bg-red-100"
                            >
                              Remove
                            </button>

                          </div>

                        </div>

                      </div>
                    ),
                  )
                )}

              </div>

            </section>

          </div>

        </div>

      </main>
    );
  }

  // ==========================================
  // MAIN UI
  // ==========================================

  return (
    <main className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">

      {!matched ? (

        <div className="w-full max-w-md bg-white rounded-2xl p-8">

          <h1 className="text-2xl font-bold text-zinc-900 text-center">
            Stranger Chat
          </h1>

          <p className="text-zinc-500 mt-2 text-center">
            Find someone who matches your interests.
          </p>

          {/* FRIENDS BUTTON */}

          <button
            onClick={
              openFriends
            }
            className="mt-6 w-full border border-zinc-300 text-zinc-800 px-6 py-3 rounded-xl font-medium hover:bg-zinc-100"
          >
            👥 Friends
          </button>

          {/* LANGUAGE */}

          <div className="mt-6">

            <label className="block text-sm font-medium text-zinc-700 mb-2">
              Language
            </label>

            <select
              value={language}
              onChange={(
                event,
              ) =>
                setLanguage(
                  event.target
                    .value,
                )
              }
              className="w-full border border-zinc-300 rounded-xl px-4 py-3"
            >
              <option>
                English
              </option>

              <option>
                Hindi
              </option>

              <option>
                Kannada
              </option>

              <option>
                Telugu
              </option>

              <option>
                Tamil
              </option>
            </select>

          </div>

          {/* INTERESTS */}

          <div className="mt-5">

            <label className="block text-sm font-medium text-zinc-700 mb-2">
              Interests
            </label>

            <div className="flex flex-wrap gap-2">

              {availableInterests.map(
                (interest) => (
                  <button
                    key={
                      interest
                    }
                    type="button"
                    onClick={() =>
                      toggleInterest(
                        interest,
                      )
                    }
                    className={`px-3 py-2 rounded-lg text-sm border ${
                      interests.includes(
                        interest,
                      )
                        ? "bg-zinc-900 text-white"
                        : "bg-white text-zinc-700"
                    }`}
                  >
                    {interest}
                  </button>
                ),
              )}

            </div>

          </div>

          {/* GOAL */}

          <div className="mt-5">

            <label className="block text-sm font-medium text-zinc-700 mb-2">
              What are you looking for?
            </label>

            <select
              value={goal}
              onChange={(
                event,
              ) =>
                setGoal(
                  event.target
                    .value,
                )
              }
              className="w-full border border-zinc-300 rounded-xl px-4 py-3"
            >
              <option value="casual-chat">
                Casual Chat
              </option>

              <option value="friendship">
                Friendship
              </option>

              <option value="learning">
                Learning
              </option>

              <option value="networking">
                Networking
              </option>
            </select>

          </div>

          {/* FIND STRANGER */}

          {!waiting ? (

            <button
              onClick={
                findStranger
              }
              className="mt-6 w-full bg-zinc-900 text-white px-6 py-3 rounded-xl font-medium hover:bg-zinc-700"
            >
              Find a Stranger
            </button>

          ) : (

            <div className="mt-6 text-center">

              <p className="text-zinc-700 font-medium">
                Looking for a stranger...
              </p>

              <p className="mt-2 text-sm text-zinc-400">
                Finding your best match
              </p>

            </div>

          )}

        </div>

      ) : (

        <div className="w-full max-w-lg h-[650px] bg-white rounded-2xl overflow-hidden flex flex-col">

          {/* HEADER */}

          <ChatHeader
            onViewProfile={() =>
              openUserProfile(
                strangerUserId,
              )
            }
          />

          {/* MATCH SCORE */}

          {matchScore !==
            null && (
            <div className="text-center py-2 bg-zinc-100 text-sm text-zinc-600">
              Match compatibility:{" "}
              <strong>
                {matchScore.toFixed(
                  0,
                )}
                %
              </strong>
            </div>
          )}

          {/* ADD FRIEND */}

          <div className="px-4 py-3 border-b">

            {!friendRequestSent ? (

              <button
                onClick={
                  sendFriendRequest
                }
                disabled={
                  !strangerUserId
                }
                className="w-full bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:bg-zinc-300 disabled:cursor-not-allowed"
              >
                👥 Add Friend
              </button>

            ) : (

              <div className="w-full text-center bg-green-50 text-green-700 px-4 py-2 rounded-lg text-sm font-medium">
                ✓ Friend request sent
              </div>

            )}

            {friendRequestMessage &&
              !friendRequestSent && (
                <p className="mt-2 text-center text-sm text-red-600">
                  {
                    friendRequestMessage
                  }
                </p>
              )}

          </div>

          {/* MESSAGES */}

          <MessageList
            messages={
              messages
            }
          />

          {/* TYPING */}

          {typing && (
            <div className="px-6 pb-2 text-sm text-zinc-400">
              Stranger is typing...
            </div>
          )}

          {/* MESSAGE INPUT */}

          <MessageInput
            message={message}
            setMessage={
              handleTyping
            }
            sendMessage={
              sendMessage
            }
          />

          {/* NEXT */}

          <button
            onClick={
              nextStranger
            }
            className="border-t py-3 text-sm font-medium text-blue-600 hover:bg-blue-50"
          >
            Next Stranger
          </button>

          {/* END */}

          <button
            onClick={endChat}
            className="border-t py-3 text-sm font-medium text-red-600 hover:bg-red-50"
          >
            End Chat
          </button>

        </div>

      )}

      {/* PROFILE LOADING */}

      {profileLoading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">

          <div className="rounded-xl bg-white px-6 py-5 shadow-xl">

            <p className="text-sm text-zinc-600">
              Loading profile...
            </p>

          </div>

        </div>
      )}

      {/* PROFILE ERROR */}

      {profileError && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">

          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl text-center">

            <p className="text-sm text-red-600">
              {profileError}
            </p>

            <button
              type="button"
              onClick={
                closeUserProfile
              }
              className="mt-4 rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white"
            >
              Close
            </button>

          </div>

        </div>
      )}

      {/* PROFILE MODAL */}

      <UserProfileModal
        user={viewProfile}
        onClose={
          closeUserProfile
        }
      />

    </main>
  );
}