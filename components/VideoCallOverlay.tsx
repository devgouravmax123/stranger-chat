"use client";

import React, { useEffect, useRef, useState } from "react";
import { ConnectionFailureInfo } from "@/hooks/useVideoCall";

interface VideoCallOverlayProps {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  isMicMuted: boolean;
  isCameraOff: boolean;
  isRemoteCameraOff: boolean;
  callState: "connecting" | "connected" | "failed" | string;
  connectionFailure?: ConnectionFailureInfo | null;
  onRetryCall?: () => void;
  onDismissFailure?: () => void;
  strangerAvatar?: string | null;
  strangerUsername?: string | null;
  onToggleMute: () => void;
  onToggleCamera: () => void;
  onEndCall: () => void;
  isChatOpen: boolean;
  onToggleChat: () => void;
  unreadChatCount?: number;
  children?: React.ReactNode;
}

export default function VideoCallOverlay({
  localStream,
  remoteStream,
  isMicMuted,
  isCameraOff,
  isRemoteCameraOff,
  callState,
  connectionFailure,
  onRetryCall,
  onDismissFailure,
  strangerAvatar,
  strangerUsername,
  onToggleMute,
  onToggleCamera,
  onEndCall,
  isChatOpen,
  onToggleChat,
  unreadChatCount = 0,
  children,
}: VideoCallOverlayProps) {
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const [isRetryCoolingDown, setIsRetryCoolingDown] = useState(false);

  // Attach local media stream to local video element
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
      localVideoRef.current.play().catch((err) => {
        console.warn("[VideoCallOverlay] Local video play error:", err);
      });
    }
  }, [localStream]);

  // Attach remote media stream to remote video element
  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
      remoteVideoRef.current.play().catch((err) => {
        console.warn("[VideoCallOverlay] Remote video play error:", err);
      });
    }
  }, [remoteStream]);

  const handleRetryClick = () => {
    if (isRetryCoolingDown || !onRetryCall) return;
    setIsRetryCoolingDown(true);
    setTimeout(() => setIsRetryCoolingDown(false), 2000);
    onRetryCall();
  };

  const isConnecting = callState !== "connected" && !connectionFailure?.failed;

  return (
    <div className="relative flex-1 w-full h-full min-h-0 bg-zinc-950 flex flex-col sm:flex-row overflow-hidden select-none">
      {/* ==========================================
          PRIMARY VIDEO AREA
          ========================================== */}
      <div className="relative flex-1 h-full min-h-0 w-full bg-zinc-950 flex flex-col justify-between overflow-hidden">
        {/* Remote Video Container */}
        <div className="relative flex-1 w-full h-full flex items-center justify-center bg-[#05050c] overflow-hidden">
          {/* Remote Video Element */}
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className={`w-full h-full object-cover transition-opacity duration-300 ${
              isConnecting || isRemoteCameraOff || connectionFailure?.failed
                ? "opacity-0 pointer-events-none"
                : "opacity-100"
            }`}
          />

          {/* Remote Connecting or Camera-off Placeholder */}
          {(isConnecting || isRemoteCameraOff) && !connectionFailure?.failed && (
            <div className="absolute inset-0 flex flex-col items-center justify-center p-4 bg-zinc-950/85 backdrop-blur-xs text-center z-10">
              {isConnecting ? (
                <div className="flex flex-col items-center gap-3 animate-fadeIn">
                  <div className="relative flex h-16 w-16 items-center justify-center rounded-3xl bg-indigo-600/20 border border-indigo-500/40 text-3xl shadow-lg shadow-indigo-600/20">
                    <span>📹</span>
                    <div className="animate-spin absolute -inset-1.5 rounded-3xl border-2 border-indigo-400 border-t-transparent" />
                  </div>
                  <p className="text-sm font-semibold text-white tracking-wide mt-1">
                    Connecting video & audio...
                  </p>
                  <p className="text-xs text-zinc-400">
                    Establishing direct peer-to-peer connection
                  </p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2.5 animate-fadeIn">
                  <div className="h-20 w-20 rounded-3xl bg-zinc-800/90 border border-zinc-700/70 flex items-center justify-center text-4xl shadow-xl">
                    {strangerAvatar || "👤"}
                  </div>
                  <p className="text-sm font-bold text-white">
                    {strangerUsername || "Stranger"}
                  </p>
                  <span className="text-xs px-3 py-1 rounded-full bg-zinc-800/90 text-zinc-400 border border-zinc-700/60 font-medium">
                    Stranger&apos;s camera is off
                  </span>
                </div>
              )}
            </div>
          )}

          {/* ==========================================
              CONNECTION FAILURE STATE CARD
              ========================================== */}
          {connectionFailure?.failed && (
            <div className="absolute inset-0 z-30 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
              <div className="w-full max-w-sm rounded-3xl bg-zinc-900/95 border border-zinc-700/80 p-6 shadow-2xl text-center relative overflow-hidden">
                <div className="absolute -top-10 -left-10 w-32 h-32 bg-indigo-500/15 rounded-full blur-3xl pointer-events-none" />

                <div className="relative mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-zinc-800/90 border border-zinc-700/80 text-3xl text-zinc-300 shadow-lg">
                  <span>📡</span>
                </div>

                <h2 className="text-base font-bold text-white tracking-tight">
                  {connectionFailure.message}
                </h2>
                <p className="text-xs text-zinc-400 mt-2 leading-relaxed">
                  {connectionFailure.subtext}
                </p>

                <div className="mt-6 flex flex-col gap-2.5">
                  {onRetryCall && (
                    <button
                      type="button"
                      onClick={handleRetryClick}
                      disabled={isRetryCoolingDown}
                      className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/25 transition active:scale-95 flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <span>🔄</span>
                      <span>{isRetryCoolingDown ? "Please wait..." : "Try Again"}</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      if (onDismissFailure) onDismissFailure();
                      onEndCall();
                    }}
                    className="w-full py-2.5 px-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white border border-zinc-700/60 text-xs font-semibold transition active:scale-95 flex items-center justify-center gap-1.5"
                  >
                    <span>💬</span>
                    <span>Back to Chat</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ==========================================
              FLOATING LOCAL VIDEO PREVIEW (PiP)
              ========================================== */}
          <div className="absolute top-4 right-4 w-28 h-36 sm:w-36 sm:h-48 rounded-2xl overflow-hidden shadow-2xl border-2 border-zinc-700/80 bg-zinc-900 z-20 transition-all hover:scale-105">
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className={`w-full h-full object-cover transform -scale-x-100 ${
                isCameraOff ? "opacity-0" : "opacity-100"
              }`}
            />
            {isCameraOff && (
              <div className="absolute inset-0 bg-zinc-900 flex flex-col items-center justify-center p-2 text-center">
                <span className="text-2xl">📷</span>
                <span className="text-[10px] text-zinc-400 mt-1.5 font-medium">Camera off</span>
              </div>
            )}
            {/* Audio muted indicator on preview */}
            {isMicMuted && (
              <div className="absolute top-2 left-2 bg-rose-600/90 text-white rounded-md px-1.5 py-0.5 text-[10px] font-semibold flex items-center gap-1 shadow-md">
                <span>🔇</span>
                <span className="text-[9px]">Muted</span>
              </div>
            )}
            <span className="absolute bottom-1.5 right-1.5 px-2 py-0.5 rounded-md bg-black/70 text-[10px] font-medium text-zinc-300 backdrop-blur-xs">
              You
            </span>
          </div>

          {/* Status Indicator Pill */}
          <div className="absolute top-4 left-4 px-3 py-1.5 rounded-full bg-black/70 border border-zinc-700/50 backdrop-blur-md text-xs font-semibold text-zinc-200 flex items-center gap-2 z-20 shadow-lg">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                callState === "connected"
                  ? "bg-emerald-400 animate-pulse"
                  : connectionFailure?.failed
                  ? "bg-rose-400"
                  : "bg-amber-400 animate-ping"
              }`}
            />
            <span>
              {callState === "connected"
                ? "Live Video Call"
                : connectionFailure?.failed
                ? "Connection Failed"
                : "Connecting..."}
            </span>
          </div>
        </div>

        {/* ==========================================
            FLOATING VIDEO CONTROLS BAR
            ========================================== */}
        <div className="w-full px-4 py-3 bg-zinc-900/95 border-t border-zinc-800/90 backdrop-blur-md flex items-center justify-center gap-3 shrink-0 z-20">
          {/* Microphone Toggle */}
          <button
            type="button"
            onClick={onToggleMute}
            aria-label={isMicMuted ? "Unmute microphone" : "Mute microphone"}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold border transition active:scale-95 shadow-sm ${
              isMicMuted
                ? "bg-rose-950/80 border-rose-800 text-rose-300 hover:bg-rose-900"
                : "bg-zinc-800/90 border-zinc-700 text-zinc-200 hover:bg-zinc-700 hover:text-white"
            }`}
            title={isMicMuted ? "Unmute microphone" : "Mute microphone"}
          >
            <span className="text-sm">{isMicMuted ? "🔇" : "🎤"}</span>
            <span className="hidden xs:inline">{isMicMuted ? "Muted" : "Mute"}</span>
          </button>

          {/* Camera Toggle */}
          <button
            type="button"
            onClick={onToggleCamera}
            aria-label={isCameraOff ? "Turn camera on" : "Turn camera off"}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold border transition active:scale-95 shadow-sm ${
              isCameraOff
                ? "bg-rose-950/80 border-rose-800 text-rose-300 hover:bg-rose-900"
                : "bg-zinc-800/90 border-zinc-700 text-zinc-200 hover:bg-zinc-700 hover:text-white"
            }`}
            title={isCameraOff ? "Turn camera on" : "Turn camera off"}
          >
            <span className="text-sm">{isCameraOff ? "🚫" : "📹"}</span>
            <span className="hidden xs:inline">{isCameraOff ? "Camera Off" : "Camera On"}</span>
          </button>

          {/* Text Chat Drawer Toggle */}
          <button
            type="button"
            onClick={onToggleChat}
            aria-label={isChatOpen ? "Close text chat" : "Open text chat"}
            className={`relative flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold border transition active:scale-95 shadow-sm ${
              isChatOpen
                ? "bg-indigo-600 border-indigo-500 text-white shadow-indigo-600/30"
                : "bg-zinc-800/90 border-zinc-700 text-zinc-200 hover:bg-zinc-700 hover:text-white"
            }`}
            title={isChatOpen ? "Hide chat panel" : "Open chat panel"}
          >
            <span className="text-sm">💬</span>
            <span className="hidden xs:inline">Chat</span>
            {unreadChatCount > 0 && !isChatOpen && (
              <span className="absolute -top-1.5 -right-1.5 px-1.5 py-0.5 rounded-full bg-rose-500 text-white text-[10px] font-extrabold shadow-sm animate-bounce">
                {unreadChatCount}
              </span>
            )}
          </button>

          {/* End Call Button */}
          <button
            type="button"
            onClick={onEndCall}
            aria-label="End video call"
            className="flex items-center gap-2 px-5 py-2 rounded-xl bg-gradient-to-r from-rose-600 to-red-700 hover:from-rose-500 hover:to-red-600 text-white text-xs font-bold shadow-lg shadow-rose-600/30 transition active:scale-95"
            title="End video call and return to text chat"
          >
            <span className="text-sm">📞</span>
            <span>End Call</span>
          </button>
        </div>
      </div>

      {/* ==========================================
          SECONDARY TEXT CHAT DRAWER / PANEL
          ========================================== */}
      {isChatOpen && (
        <aside
          aria-label="Stranger text chat panel"
          className="w-full sm:w-80 md:w-96 h-1/2 sm:h-full shrink-0 border-t sm:border-t-0 sm:border-l border-zinc-800/90 bg-zinc-900/95 backdrop-blur-md flex flex-col z-30 shadow-2xl animate-fadeIn transition-all"
        >
          {/* Drawer Header */}
          <div className="px-4 py-2.5 border-b border-zinc-800/80 bg-zinc-950/60 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sm">💬</span>
              <h2 className="text-xs font-bold text-white truncate">
                {strangerUsername ? `${strangerUsername} Chat` : "Stranger Chat"}
              </h2>
            </div>
            <button
              type="button"
              onClick={onToggleChat}
              className="h-7 w-7 rounded-lg bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 hover:text-white flex items-center justify-center text-xs font-bold transition active:scale-95"
              title="Close chat panel (keep video active)"
            >
              ✕
            </button>
          </div>

          {/* Drawer Content: Full MessageList & MessageInput */}
          <div className="flex-1 flex flex-col min-h-0 bg-zinc-950">
            {children}
          </div>
        </aside>
      )}
    </div>
  );
}
