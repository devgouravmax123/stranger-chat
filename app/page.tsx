"use client";

import { useEffect, useState } from "react";
import { io, Socket } from "socket.io-client";

import ChatHeader from "@/components/ChatHeader";
import MessageInput from "@/components/MessageInput";
import MessageList from "@/components/MessageList";

export type Message = {
  text: string;
  sender: "me" | "stranger";
  timestamp: number;
};

type ReceivedMessage = {
  text: string;
  sender: string;
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
};

export default function Home() {
  const [socket, setSocket] = useState<Socket | null>(null);

  const [matched, setMatched] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [typing, setTyping] = useState(false);

  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);

  const [userId, setUserId] = useState<string | null>(null);

  // ==========================================
  // SOCKET CONNECTION
  // ==========================================

  useEffect(() => {
    const newSocket = io("http://localhost:3001");

    setSocket(newSocket);

    newSocket.on("connect", () => {
      console.log("Connected to backend:", newSocket.id);
    });

    // ==========================================
    // WAITING
    // ==========================================

    newSocket.on("waiting", () => {
      setWaiting(true);
    });

    // ==========================================
    // CHAT HISTORY
    // ==========================================

    newSocket.on("chat_history", (data: ChatHistoryData) => {
      console.log("Chat history received:", data.messages);

      setUserId(data.userId);

      const history: Message[] = data.messages.map((item) => ({
        text: item.content,

        sender:
          item.senderId === data.userId
            ? "me"
            : "stranger",

        timestamp: new Date(item.createdAt).getTime(),
      }));

      setMessages(history);
    });

    // ==========================================
    // MATCHED
    // ==========================================

    newSocket.on("matched", (data: MatchedData) => {
      console.log("Matched!");
      console.log("Room ID:", data.roomId);
      console.log("My database User ID:", data.userId);

      setWaiting(false);
      setMatched(true);
      setUserId(data.userId);
    });

    // ==========================================
    // RECEIVE MESSAGE
    // ==========================================

    newSocket.on(
      "receive_message",
      (data: ReceivedMessage) => {
        setMessages((previousMessages) => [
          ...previousMessages,
          {
            text: data.text,

            sender:
              data.sender === newSocket.id
                ? "me"
                : "stranger",

            timestamp: data.timestamp,
          },
        ]);
      },
    );

    // ==========================================
    // STRANGER TYPING
    // ==========================================

    newSocket.on("stranger_typing", () => {
      setTyping(true);
    });

    // ==========================================
    // STRANGER STOPPED TYPING
    // ==========================================

    newSocket.on("stranger_stopped_typing", () => {
      setTyping(false);
    });

    // ==========================================
    // STRANGER LEFT
    // ==========================================

    newSocket.on("stranger_left", () => {
      setMatched(false);
      setWaiting(false);
      setTyping(false);
      setMessages([]);
      setUserId(null);
    });

    // ==========================================
    // DISCONNECT
    // ==========================================

    newSocket.on("disconnect", () => {
      console.log("Disconnected from backend");
    });

    return () => {
      newSocket.disconnect();
    };
  }, []);

  // ==========================================
  // FIND STRANGER
  // ==========================================

  const findStranger = () => {
    if (!socket) {
      return;
    }

    setMessages([]);
    setWaiting(true);
    setTyping(false);

    socket.emit("find_stranger");
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

    socket.emit("next_stranger");
  };

  // ==========================================
  // END CHAT
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
    setUserId(null);
  };

  // ==========================================
  // SEND MESSAGE
  // ==========================================

  const sendMessage = () => {
    if (!socket || message.trim() === "") {
      return;
    }

    socket.emit("send_message", {
      text: message,
    });

    socket.emit("stop_typing");

    setMessage("");
  };

  // ==========================================
  // TYPING
  // ==========================================

  const handleTyping = (value: string) => {
    setMessage(value);

    if (!socket) {
      return;
    }

    if (value.trim() === "") {
      socket.emit("stop_typing");
      return;
    }

    socket.emit("typing");
  };

  // ==========================================
  // UI
  // ==========================================

  return (
    <main className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">

      {!matched ? (
        <div className="w-full max-w-md bg-white rounded-2xl p-8 text-center">

          <h1 className="text-2xl font-bold text-zinc-900">
            Stranger Chat
          </h1>

          <p className="text-zinc-500 mt-2">
            Talk to someone new.
          </p>

          {!waiting ? (
            <button
              onClick={findStranger}
              className="mt-6 bg-zinc-900 text-white px-6 py-3 rounded-xl font-medium hover:bg-zinc-700"
            >
              Find a Stranger
            </button>
          ) : (
            <div className="mt-6">

              <p className="text-zinc-700 font-medium">
                Looking for a stranger...
              </p>

              <p className="mt-3 text-sm text-zinc-400">
                Waiting for someone to join
              </p>

            </div>
          )}

        </div>
      ) : (
        <div className="w-full max-w-lg h-[650px] bg-white rounded-2xl overflow-hidden flex flex-col">

          <ChatHeader />

          <MessageList messages={messages} />

          {typing && (
            <div className="px-6 pb-2 text-sm text-zinc-400">
              Stranger is typing...
            </div>
          )}

          <MessageInput
            message={message}
            setMessage={handleTyping}
            sendMessage={sendMessage}
          />

          <button
            onClick={nextStranger}
            className="border-t py-3 text-sm font-medium text-blue-600 hover:bg-blue-50"
          >
            Next Stranger
          </button>

          <button
            onClick={endChat}
            className="border-t py-3 text-sm font-medium text-red-600 hover:bg-red-50"
          >
            End Chat
          </button>

        </div>
      )}

    </main>
  );
}