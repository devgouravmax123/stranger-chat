"use client";

import { useEffect, useRef, useState } from "react";

type MessageLike = {
  sender: string;
  text?: string;
  type?: string;
};

type AiSuggestionsProps = {
  conversationId?: string | null;
  messages: MessageLike[];
  currentUserId?: string;
  onSelectSuggestion: (suggestionText: string) => void;
  disabled?: boolean;
};

export default function AiSuggestions({
  conversationId,
  messages,
  currentUserId,
  onSelectSuggestion,
  disabled = false,
}: AiSuggestionsProps) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [isExpanded, setIsExpanded] = useState(false);

  // References to protect against async race conditions and track per-match repetition
  const conversationIdRef = useRef(conversationId);
  conversationIdRef.current = conversationId;

  const previousSuggestionsRef = useRef<string[]>([]);
  const cooldownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ==========================================
  // CONVERSATION ISOLATION: RESET ON NEW MATCH
  // ==========================================
  useEffect(() => {
    setSuggestions([]);
    setIsExpanded(false);
    setIsLoading(false);
    setErrorMessage(null);
    setInfoMessage(null);
    setCooldownSeconds(0);
    previousSuggestionsRef.current = [];

    if (cooldownTimerRef.current) {
      clearInterval(cooldownTimerRef.current);
    }
  }, [conversationId]);

  // ==========================================
  // COOLDOWN COUNTDOWN TIMER
  // ==========================================
  useEffect(() => {
    if (cooldownSeconds > 0) {
      cooldownTimerRef.current = setInterval(() => {
        setCooldownSeconds((prev) => {
          if (prev <= 1) {
            if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
    };
  }, [cooldownSeconds]);

  // Filter meaningful text messages (ignores audio, image, placeholder texts)
  const getMeaningfulTextMessages = () => {
    return (messages || []).filter((m) => {
      if (!m || !m.text) return false;
      if (m.type === "audio" || m.type === "image") return false;
      const t = m.text.trim();
      return (
        t.length > 0 &&
        t !== "📷 Photo message" &&
        t !== "🎙️ Voice message"
      );
    });
  };

  // ==========================================
  // EXPLICIT USER ACTION: REFRESH IDEAS
  // ==========================================
  const handleFetchSuggestions = async () => {
    if (isLoading || cooldownSeconds > 0 || disabled) return;

    const meaningfulTextMessages = getMeaningfulTextMessages();

    // STATE 1: Empty chat (0 messages)
    if (meaningfulTextMessages.length === 0) {
      setErrorMessage(null);
      setInfoMessage("Start chatting first, then I can suggest topics based on your conversation.");
      return;
    }

    // STATE 2: Not enough context (1 or 2 messages)
    if (meaningfulTextMessages.length < 3) {
      setErrorMessage(null);
      setInfoMessage("Chat a little more and I'll find some ideas for you.");
      return;
    }

    // Capture match ID to guard against async race conditions
    const activeMatchId = conversationId;

    // Resolve authentic user ID (prefer prop, fallback to sessionStorage)
    const activeUserId =
      currentUserId && currentUserId !== "me" && currentUserId !== "anonymous"
        ? currentUserId
        : typeof window !== "undefined"
        ? sessionStorage.getItem("sc_user_id") || sessionStorage.getItem("sc_session_user_id") || undefined
        : undefined;

    // STATE 4: Generating...
    setIsLoading(true);
    setErrorMessage(null);
    setInfoMessage(null);

    const cleanedContext = meaningfulTextMessages.slice(-15).map((m) => ({
      sender:
        m.sender === "me" || (activeUserId && m.sender === activeUserId)
          ? "me"
          : "stranger",
      text: m.text!.trim().slice(0, 300),
    }));

    try {
      const response = await fetch(
        "http://localhost:3001/ai/conversation-suggestions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            conversationId: activeMatchId || undefined,
            messages: cleanedContext,
            userId: activeUserId,
            previousSuggestions: previousSuggestionsRef.current,
          }),
        }
      );

      const data = await response.json();

      // ASYNC RACE CONDITION GUARD:
      // If user switched to another stranger match while request was in flight, discard response!
      if (activeMatchId !== conversationIdRef.current) {
        return;
      }

      // FAILURE: If request fails, show error and do NOT start cooldown
      if (!response.ok) {
        setIsLoading(false);
        if (response.status === 429 && data.cooldownRemaining) {
          setCooldownSeconds(data.cooldownRemaining);
          setErrorMessage(
            data.error || "Please wait before requesting new suggestions."
          );
        } else {
          // Failure: NO cooldown, user can retry
          setCooldownSeconds(0);
          setErrorMessage(
            data.error || "Couldn't generate suggestions right now. Please try again."
          );
        }
        return;
      }

      if (data.message && (!data.suggestions || data.suggestions.length === 0)) {
        setIsLoading(false);
        setInfoMessage(data.message);
        return;
      }

      // SUCCESS: Valid suggestions received!
      if (Array.isArray(data.suggestions) && data.suggestions.length === 3) {
        setSuggestions(data.suggestions);
        setIsExpanded(true);
        // Track suggestions to avoid repetition within this match
        previousSuggestionsRef.current = [
          ...previousSuggestionsRef.current,
          ...data.suggestions,
        ].slice(-9);

        // ONLY START COOLDOWN ON SUCCESS (10s)
        setCooldownSeconds(data.cooldownSeconds || 10);
      } else {
        setCooldownSeconds(0);
        setErrorMessage("Couldn't generate suggestions right now. Please try again.");
      }
    } catch (err) {
      if (activeMatchId === conversationIdRef.current) {
        setCooldownSeconds(0);
        setErrorMessage("Couldn't generate suggestions right now. Please try again.");
      }
    } finally {
      if (activeMatchId === conversationIdRef.current) {
        setIsLoading(false);
      }
    }
  };

  const handleSuggestionClick = (text: string) => {
    onSelectSuggestion(text);
  };

  return (
    <div className="border-t border-zinc-800/80 bg-zinc-900/95 px-3 py-2 text-xs backdrop-blur-md transition-all duration-200">
      {/* Top action bar */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-tr from-purple-600 to-indigo-600 text-[10px] text-white shadow-xs">
            ✨
          </span>
          <span className="font-medium text-zinc-300 truncate">
            {suggestions.length > 0
              ? "Conversation ideas"
              : "Need something to talk about?"}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {cooldownSeconds > 0 && (
            <span className="text-[11px] font-mono font-medium text-amber-400 bg-amber-950/40 px-2 py-0.5 rounded-md border border-amber-800/50">
              ⏳ {cooldownSeconds}s
            </span>
          )}

          <button
            type="button"
            onClick={handleFetchSuggestions}
            disabled={isLoading || cooldownSeconds > 0 || disabled}
            className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 px-3 py-1 font-medium text-white shadow-sm transition hover:from-indigo-500 hover:to-purple-500 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100"
            title={
              cooldownSeconds > 0
                ? `Wait ${cooldownSeconds}s`
                : "Get suggestions based on your conversation"
            }
          >
            {isLoading ? (
              <>
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                <span>Generating...</span>
              </>
            ) : cooldownSeconds > 0 ? (
              <span>Wait {cooldownSeconds}s</span>
            ) : (
              <>
                <span>✨</span>
                <span>Refresh ideas</span>
              </>
            )}
          </button>

          {suggestions.length > 0 && (
            <button
              type="button"
              onClick={() => setIsExpanded(!isExpanded)}
              className="rounded-md p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              title={isExpanded ? "Collapse suggestions" : "Expand suggestions"}
              aria-label="Toggle suggestions"
            >
              {isExpanded ? "▲" : "▼"}
            </button>
          )}
        </div>
      </div>

      {/* Info message: e.g. "Start chatting first..." or "Chat a little more..." */}
      {infoMessage && (
        <div className="mt-2 flex items-center justify-between rounded-lg bg-indigo-950/40 border border-indigo-800/60 px-2.5 py-1.5 text-[11px] text-indigo-300 animate-fadeIn">
          <span>💬 {infoMessage}</span>
          <button
            type="button"
            onClick={() => setInfoMessage(null)}
            className="ml-2 font-bold text-indigo-400 hover:text-indigo-200"
          >
            ✕
          </button>
        </div>
      )}

      {/* Error message: e.g. "Couldn't generate suggestions right now. Please try again." */}
      {errorMessage && (
        <div className="mt-2 flex items-center justify-between rounded-lg bg-red-950/40 border border-red-800/60 px-2.5 py-1.5 text-[11px] text-red-300 animate-fadeIn">
          <span>⚠️ {errorMessage}</span>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="ml-2 font-bold text-red-400 hover:text-red-200"
          >
            ✕
          </button>
        </div>
      )}

      {/* Suggestions List */}
      {isExpanded && suggestions.length > 0 && (
        <div className="mt-2 space-y-1.5 animate-fadeIn">
          <p className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold px-0.5">
            Conversation ideas (click to use):
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
            {suggestions.map((item, index) => (
              <button
                key={index}
                type="button"
                onClick={() => handleSuggestionClick(item)}
                disabled={disabled}
                className="group relative flex items-start gap-1.5 rounded-xl border border-zinc-700/70 bg-zinc-800/80 p-2.5 text-left text-xs text-zinc-200 shadow-sm transition hover:border-indigo-500/70 hover:bg-zinc-800 hover:text-white active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
                title="Click to insert into message input"
              >
                <span className="mt-0.5 text-indigo-400 group-hover:scale-110 transition-transform">
                  💡
                </span>
                <span className="flex-1 line-clamp-3 leading-snug font-normal">
                  {item}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
