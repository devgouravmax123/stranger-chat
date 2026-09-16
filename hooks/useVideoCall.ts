"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Socket } from "socket.io-client";

export type CallState =
  | "idle"
  | "calling"
  | "incoming"
  | "accepting"
  | "connecting"
  | "connected"
  | "declined"
  | "cancelled"
  | "failed"
  | "busy"
  | "ended";

export interface ConnectionFailureInfo {
  failed: boolean;
  message: string;
  subtext: string;
}

export const DEFAULT_RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
  ],
};

interface UseVideoCallOptions {
  socket: Socket | null;
  roomId: string | null;
  userId: string | null;
  strangerUserId: string | null;
  onNotification?: (message: string) => void;
  rtcConfig?: RTCConfiguration;
}

export function useVideoCall({
  socket,
  roomId,
  userId,
  strangerUserId,
  onNotification,
  rtcConfig = DEFAULT_RTC_CONFIG,
}: UseVideoCallOptions) {
  const [callState, setCallState] = useState<CallState>("idle");
  const [callId, setCallId] = useState<string | null>(null);
  const [callerInfo, setCallerInfo] = useState<{ callerName?: string | null; callerAvatar?: string | null } | null>(null);

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  const [isMicMuted, setIsMicMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [isRemoteCameraOff, setIsRemoteCameraOff] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [connectionFailure, setConnectionFailure] = useState<ConnectionFailureInfo | null>(null);

  // References to keep callbacks fresh and avoid race conditions
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const callIdRef = useRef<string | null>(null);
  const roomIdRef = useRef<string | null>(roomId);
  const callStateRef = useRef<CallState>("idle");

  // Concurrency and timeout references
  const callingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const incomingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const disconnectGraceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isStartingRef = useRef<boolean>(false);
  const isAcceptingRef = useRef<boolean>(false);

  // Keep refs in sync with state
  roomIdRef.current = roomId;
  callStateRef.current = callState;
  callIdRef.current = callId;

  // Complete hardware & WebRTC teardown helper
  const teardownCall = useCallback(() => {
    // Clear all pending timeouts & grace periods
    if (callingTimeoutRef.current) {
      clearTimeout(callingTimeoutRef.current);
      callingTimeoutRef.current = null;
    }
    if (incomingTimeoutRef.current) {
      clearTimeout(incomingTimeoutRef.current);
      incomingTimeoutRef.current = null;
    }
    if (disconnectGraceTimerRef.current) {
      clearTimeout(disconnectGraceTimerRef.current);
      disconnectGraceTimerRef.current = null;
    }

    isStartingRef.current = false;
    isAcceptingRef.current = false;

    // 1. Stop all tracks in local media stream immediately
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
          track.enabled = false;
        } catch (e) {
          console.warn("[VideoCall] Track stop error:", e);
        }
      });
      localStreamRef.current = null;
    }

    // 2. Close and destroy RTCPeerConnection
    if (peerConnectionRef.current) {
      try {
        peerConnectionRef.current.onicecandidate = null;
        peerConnectionRef.current.ontrack = null;
        peerConnectionRef.current.onconnectionstatechange = null;
        peerConnectionRef.current.oniceconnectionstatechange = null;
        peerConnectionRef.current.close();
      } catch (e) {
        console.warn("[VideoCall] PeerConnection close error:", e);
      }
      peerConnectionRef.current = null;
    }

    // 3. Clear pending candidates and streams
    pendingCandidatesRef.current = [];
    setLocalStream(null);
    setRemoteStream(null);
    setCallId(null);
    callIdRef.current = null;
    setCallerInfo(null);
    setIsMicMuted(false);
    setIsCameraOff(false);
    setIsRemoteCameraOff(false);
    setCallState("idle");
  }, []);

  // Graceful connection failure handler with user-friendly ChatBuddy copy
  const handleConnectionFailure = useCallback(
    (
      message = "Couldn't establish the video connection.",
      subtext = "You can continue chatting by text and try the call again."
    ) => {
      teardownCall();
      setConnectionFailure({
        failed: true,
        message,
        subtext,
      });
      setCallState("failed");
      onNotification?.(message);
    },
    [teardownCall, onNotification]
  );

  // Clear connection failure modal/banner
  const dismissFailure = useCallback(() => {
    setConnectionFailure(null);
    if (callStateRef.current === "failed") {
      setCallState("idle");
    }
  }, []);

  // Request browser camera and microphone permissions ONLY when explicitly called
  const acquireMedia = useCallback(async (): Promise<MediaStream | null> => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      const friendlyErr = "Your browser does not support camera or microphone access.";
      setErrorMessage(friendlyErr);
      onNotification?.(`⚠️ ${friendlyErr}`);
      return null;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: "user",
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      // Listen for hardware track disconnects / device changes
      stream.getVideoTracks().forEach((track) => {
        track.onended = () => {
          console.warn("[VideoCall] Camera track ended unexpectedly");
          setIsCameraOff(true);
          onNotification?.("Camera was disconnected or stopped.");
        };
      });

      stream.getAudioTracks().forEach((track) => {
        track.onended = () => {
          console.warn("[VideoCall] Audio track ended unexpectedly");
          setIsMicMuted(true);
          onNotification?.("Microphone was disconnected.");
        };
      });

      localStreamRef.current = stream;
      setLocalStream(stream);
      setIsMicMuted(false);
      setIsCameraOff(false);
      setErrorMessage(null);
      return stream;
    } catch (err: any) {
      console.warn("[VideoCall] getUserMedia error:", err);
      let friendlyMsg = "Camera and microphone access is required for video calling.";
      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        friendlyMsg = "Camera and microphone access is required for video calling.";
      } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
        friendlyMsg = "No camera or microphone device was found on your system.";
      } else if (err.name === "NotReadableError" || err.name === "TrackStartError") {
        friendlyMsg = "Your camera or microphone isn't available right now. You can continue chatting by text.";
      }
      setErrorMessage(friendlyMsg);
      onNotification?.(friendlyMsg);
      return null;
    }
  }, [onNotification]);

  // Create RTCPeerConnection and bind event handlers
  const createPeerConnection = useCallback(
    (stream: MediaStream, targetCallId: string): RTCPeerConnection => {
      // Ensure previous connection is cleanly destroyed
      if (peerConnectionRef.current) {
        try {
          peerConnectionRef.current.close();
        } catch {}
      }

      const pc = new RTCPeerConnection(rtcConfig);
      peerConnectionRef.current = pc;

      // Add local media tracks to peer connection
      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });

      // Handle ICE candidates generated by browser
      pc.onicecandidate = (event) => {
        if (event.candidate && socket && roomIdRef.current) {
          socket.emit("video_ice_candidate", {
            roomId: roomIdRef.current,
            callId: targetCallId,
            candidate: event.candidate.toJSON(),
          });
        }
      };

      // Handle receiving remote tracks
      pc.ontrack = (event) => {
        console.log("[VideoCall] Received remote track:", event.track.kind);
        if (event.streams && event.streams[0]) {
          setRemoteStream(event.streams[0]);
        } else {
          setRemoteStream((prev) => {
            const newStream = prev || new MediaStream();
            newStream.addTrack(event.track);
            return newStream;
          });
        }

        if (event.track.kind === "video") {
          event.track.onmute = () => setIsRemoteCameraOff(true);
          event.track.onunmute = () => setIsRemoteCameraOff(false);
        }
      };

      // Connection state changes with 6-second recovery grace period
      pc.onconnectionstatechange = () => {
        console.log("[VideoCall] Connection state:", pc.connectionState);
        if (pc.connectionState === "connected") {
          if (disconnectGraceTimerRef.current) {
            clearTimeout(disconnectGraceTimerRef.current);
            disconnectGraceTimerRef.current = null;
          }
          setCallState("connected");
        } else if (pc.connectionState === "disconnected") {
          // Allow transient network blip recovery before declaring permanent failure
          if (!disconnectGraceTimerRef.current) {
            disconnectGraceTimerRef.current = setTimeout(() => {
              disconnectGraceTimerRef.current = null;
              if (
                peerConnectionRef.current &&
                (peerConnectionRef.current.connectionState === "disconnected" ||
                  peerConnectionRef.current.connectionState === "failed")
              ) {
                handleConnectionFailure(
                  "Couldn't establish the video connection.",
                  "You can continue chatting by text and try the call again."
                );
              }
            }, 6000);
          }
        } else if (pc.connectionState === "failed") {
          if (disconnectGraceTimerRef.current) {
            clearTimeout(disconnectGraceTimerRef.current);
            disconnectGraceTimerRef.current = null;
          }
          handleConnectionFailure(
            "Couldn't establish the video connection.",
            "You can continue chatting by text and try the call again."
          );
        }
      };

      pc.oniceconnectionstatechange = () => {
        console.log("[VideoCall] ICE state:", pc.iceConnectionState);
        if (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") {
          if (disconnectGraceTimerRef.current) {
            clearTimeout(disconnectGraceTimerRef.current);
            disconnectGraceTimerRef.current = null;
          }
          setCallState("connected");
        } else if (pc.iceConnectionState === "failed") {
          if (disconnectGraceTimerRef.current) {
            clearTimeout(disconnectGraceTimerRef.current);
            disconnectGraceTimerRef.current = null;
          }
          handleConnectionFailure(
            "Couldn't establish the video connection.",
            "You can continue chatting by text and try the call again."
          );
        }
      };

      return pc;
    },
    [rtcConfig, socket, handleConnectionFailure]
  );

  // Helper to drain queued ICE candidates once remote description is set
  const drainPendingCandidates = useCallback(async (pc: RTCPeerConnection) => {
    if (pendingCandidatesRef.current.length > 0) {
      console.log(`[VideoCall] Draining ${pendingCandidatesRef.current.length} queued ICE candidates`);
      for (const cand of pendingCandidatesRef.current) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(cand));
        } catch (e) {
          console.warn("[VideoCall] Error adding queued ICE candidate:", e);
        }
      }
      pendingCandidatesRef.current = [];
    }
  }, []);

  // ==========================================
  // CALLER ACTIONS
  // ==========================================

  // Caller clicks "Video Call"
  const startCall = useCallback(async () => {
    if (isStartingRef.current) return;
    if (!socket || !roomIdRef.current) {
      onNotification?.("You must be in an active chat to start a video call.");
      return;
    }

    if (callStateRef.current !== "idle") {
      onNotification?.("A video call is already in progress or connecting.");
      return;
    }

    isStartingRef.current = true;
    setConnectionFailure(null);

    try {
      // Step 1: Request camera + mic permissions
      const stream = await acquireMedia();
      if (!stream) {
        return;
      }

      // Step 2: Generate stable call identifier
      const newCallId = `call-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
      setCallId(newCallId);
      callIdRef.current = newCallId;
      setCallState("calling");

      // Step 3: Start 35-second caller timeout
      if (callingTimeoutRef.current) clearTimeout(callingTimeoutRef.current);
      callingTimeoutRef.current = setTimeout(() => {
        if (callStateRef.current === "calling") {
          if (socket && roomIdRef.current && callIdRef.current) {
            socket.emit("video_call_cancelled", {
              roomId: roomIdRef.current,
              callId: callIdRef.current,
            });
          }
          handleConnectionFailure(
            "No response from the other user.",
            "You can continue chatting by text and try the call again."
          );
        }
      }, 35000);

      // Step 4: Emit video_call_request to remote peer
      socket.emit("video_call_request", {
        roomId: roomIdRef.current,
        callId: newCallId,
      });
    } finally {
      isStartingRef.current = false;
    }
  }, [socket, acquireMedia, onNotification, handleConnectionFailure]);

  // Caller clicks "Cancel" while waiting
  const cancelCall = useCallback(() => {
    if (callingTimeoutRef.current) {
      clearTimeout(callingTimeoutRef.current);
      callingTimeoutRef.current = null;
    }
    if (callStateRef.current === "calling" && socket && roomIdRef.current && callIdRef.current) {
      socket.emit("video_call_cancelled", {
        roomId: roomIdRef.current,
        callId: callIdRef.current,
      });
    }
    teardownCall();
  }, [socket, teardownCall]);

  // Retry calling with a clean new callId and fresh peer connection
  const retryCall = useCallback(() => {
    dismissFailure();
    startCall();
  }, [dismissFailure, startCall]);

  // ==========================================
  // RECEIVER ACTIONS
  // ==========================================

  // Receiver clicks "Accept" on incoming call modal
  const acceptCall = useCallback(
    async (overrideData?: { roomId: string; callId: string }) => {
      if (isAcceptingRef.current) return;

      const targetRoomId = overrideData?.roomId || roomIdRef.current;
      const targetCallId = overrideData?.callId || callIdRef.current;

      if (!socket || !targetRoomId || !targetCallId) {
        teardownCall();
        return;
      }

      if (!overrideData && callStateRef.current !== "incoming") {
        return;
      }

      isAcceptingRef.current = true;
      if (incomingTimeoutRef.current) {
        clearTimeout(incomingTimeoutRef.current);
        incomingTimeoutRef.current = null;
      }

      // Enter accepting state immediately to lock UI and prevent double clicks
      setCallState("accepting");

      try {
        if (overrideData) {
          roomIdRef.current = targetRoomId;
          callIdRef.current = targetCallId;
          setCallId(targetCallId);
        }

        // Step 1: Prompt camera & mic permission ONLY AFTER clicking Accept
        const stream = await acquireMedia();
        if (!stream) {
          socket.emit("video_call_declined", {
            roomId: targetRoomId,
            callId: targetCallId,
            reason: "permission_denied",
          });
          teardownCall();
          return;
        }

        setCallState("connecting");

        // Step 2: Emit acceptance to caller
        socket.emit("video_call_accepted", {
          roomId: targetRoomId,
          callId: targetCallId,
        });

        // Step 3: Create receiver's peer connection ready for offer
        createPeerConnection(stream, targetCallId);
      } finally {
        isAcceptingRef.current = false;
      }
    },
    [socket, acquireMedia, createPeerConnection, teardownCall]
  );

  // Receiver clicks "Decline" on incoming call modal
  const declineCall = useCallback(() => {
    if (incomingTimeoutRef.current) {
      clearTimeout(incomingTimeoutRef.current);
      incomingTimeoutRef.current = null;
    }
    if (callStateRef.current === "incoming" && socket && roomIdRef.current && callIdRef.current) {
      socket.emit("video_call_declined", {
        roomId: roomIdRef.current,
        callId: callIdRef.current,
        reason: "user_declined",
      });
    }
    teardownCall();
  }, [socket, teardownCall]);

  // ==========================================
  // IN-CALL CONTROLS
  // ==========================================

  // End Call (by either caller or receiver)
  const endCall = useCallback(() => {
    if (socket && roomIdRef.current && callIdRef.current) {
      socket.emit("video_call_ended", {
        roomId: roomIdRef.current,
        callId: callIdRef.current,
      });
    }
    teardownCall();
    onNotification?.("The video call has ended.");
  }, [socket, teardownCall, onNotification]);

  // Mute / Unmute Microphone
  const toggleMute = useCallback(() => {
    if (!localStreamRef.current) return;
    const audioTracks = localStreamRef.current.getAudioTracks();
    if (audioTracks.length === 0) return;

    const nextState = !isMicMuted;
    audioTracks.forEach((track) => {
      track.enabled = !nextState;
    });
    setIsMicMuted(nextState);
  }, [isMicMuted]);

  // Camera On / Off
  const toggleCamera = useCallback(() => {
    if (!localStreamRef.current) return;
    const videoTracks = localStreamRef.current.getVideoTracks();
    if (videoTracks.length === 0) return;

    const nextState = !isCameraOff;
    videoTracks.forEach((track) => {
      track.enabled = !nextState;
    });
    setIsCameraOff(nextState);
  }, [isCameraOff]);

  // ==========================================
  // SOCKET SIGNALING LISTENERS
  // ==========================================

  useEffect(() => {
    if (!socket) return;

    // 1. Incoming Call Request (Receiver)
    const handleIncomingRequest = (data: {
      roomId: string;
      callId: string;
      callerUserId?: string;
      callerName?: string;
      callerAvatar?: string;
      chatType?: string;
    }) => {
      if (roomIdRef.current && data.roomId !== roomIdRef.current) return;

      // Deduplicate: ignore duplicate packet for the same ongoing call attempt
      if (callIdRef.current === data.callId) return;

      // If user is genuinely on an active connected/connecting call, decline as busy
      if (callStateRef.current === "connected" || callStateRef.current === "connecting") {
        socket.emit("video_call_declined", {
          roomId: data.roomId,
          callId: data.callId,
          reason: "busy",
        });
        return;
      }

      // If previous call was ended/idle/stale, clean up before adopting new call
      if (callStateRef.current !== "idle") {
        teardownCall();
      }

      setCallId(data.callId);
      callIdRef.current = data.callId;
      setCallerInfo({
        callerName: data.callerName || null,
        callerAvatar: data.callerAvatar || null,
      });
      setCallState("incoming");

      // 40-second incoming call expiration timer
      if (incomingTimeoutRef.current) clearTimeout(incomingTimeoutRef.current);
      incomingTimeoutRef.current = setTimeout(() => {
        if (callStateRef.current === "incoming") {
          teardownCall();
        }
      }, 40000);
    };

    // 2. Call Accepted (Caller)
    const handleCallAccepted = async (data: { roomId: string; callId: string }) => {
      if (data.roomId !== roomIdRef.current || data.callId !== callIdRef.current) return;
      if (callStateRef.current !== "calling") return;

      if (callingTimeoutRef.current) {
        clearTimeout(callingTimeoutRef.current);
        callingTimeoutRef.current = null;
      }

      setCallState("connecting");

      const stream = localStreamRef.current;
      if (!stream) {
        teardownCall();
        return;
      }

      try {
        const pc = createPeerConnection(stream, data.callId);

        // Caller creates SDP offer
        const offer = await pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: true,
        });
        await pc.setLocalDescription(offer);

        socket.emit("video_offer", {
          roomId: data.roomId,
          callId: data.callId,
          sdp: offer,
        });
      } catch (err) {
        console.error("[VideoCall] Error creating offer:", err);
        handleConnectionFailure(
          "Couldn't establish the video connection.",
          "You can continue chatting by text and try the call again."
        );
      }
    };

    // 3. Receive SDP Offer (Receiver)
    const handleVideoOffer = async (data: { roomId: string; callId: string; sdp: RTCSessionDescriptionInit }) => {
      if (data.roomId !== roomIdRef.current || data.callId !== callIdRef.current) return;

      let pc = peerConnectionRef.current;
      if (!pc && localStreamRef.current) {
        pc = createPeerConnection(localStreamRef.current, data.callId);
      }
      if (!pc) return;

      try {
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        await drainPendingCandidates(pc);

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        socket.emit("video_answer", {
          roomId: data.roomId,
          callId: data.callId,
          sdp: answer,
        });
      } catch (err) {
        console.error("[VideoCall] Error handling offer & creating answer:", err);
        handleConnectionFailure(
          "Couldn't establish the video connection.",
          "You can continue chatting by text and try the call again."
        );
      }
    };

    // 4. Receive SDP Answer (Caller)
    const handleVideoAnswer = async (data: { roomId: string; callId: string; sdp: RTCSessionDescriptionInit }) => {
      if (data.roomId !== roomIdRef.current || data.callId !== callIdRef.current) return;

      const pc = peerConnectionRef.current;
      if (!pc) return;

      try {
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        await drainPendingCandidates(pc);
      } catch (err) {
        console.error("[VideoCall] Error setting remote answer:", err);
        handleConnectionFailure(
          "Couldn't establish the video connection.",
          "You can continue chatting by text and try the call again."
        );
      }
    };

    // 5. Receive ICE Candidate (Both)
    const handleIceCandidate = async (data: { roomId: string; callId: string; candidate: RTCIceCandidateInit }) => {
      if (data.roomId !== roomIdRef.current || data.callId !== callIdRef.current) return;

      const pc = peerConnectionRef.current;
      if (pc && pc.remoteDescription && pc.remoteDescription.type) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (err) {
          console.warn("[VideoCall] Error adding ICE candidate:", err);
        }
      } else {
        pendingCandidatesRef.current.push(data.candidate);
      }
    };

    // 6. Call Declined (Caller)
    const handleCallDeclined = (data: { roomId: string; callId?: string; reason?: string }) => {
      if (data.roomId !== roomIdRef.current) return;
      if (data.callId && callIdRef.current && data.callId !== callIdRef.current) return;
      teardownCall();
      if (data.reason === "busy") {
        onNotification?.("That person is currently on another video call.");
      } else if (data.reason === "permission_denied") {
        onNotification?.("The other user could not access their camera or microphone.");
      } else {
        onNotification?.("Video call was declined.");
      }
    };

    // 7. Call Cancelled (Receiver)
    const handleCallCancelled = (data: { roomId: string; callId?: string }) => {
      if (data.roomId !== roomIdRef.current) return;
      if (data.callId && callIdRef.current && data.callId !== callIdRef.current) return;
      teardownCall();
      onNotification?.("The video call was cancelled.");
    };

    // 8. Call Ended (Both)
    const handleCallEnded = (data: { roomId: string; callId?: string }) => {
      if (data.roomId !== roomIdRef.current) return;
      if (data.callId && callIdRef.current && data.callId !== callIdRef.current) return;
      teardownCall();
      onNotification?.("The video call has ended.");
    };

    // 9. Call Error
    const handleCallError = (data: { message: string }) => {
      handleConnectionFailure(
        "Couldn't establish the video connection.",
        "You can continue chatting by text and try the call again."
      );
    };

    // Bind event listeners
    socket.on("video_call_request", handleIncomingRequest);
    socket.on("video_call_accepted", handleCallAccepted);
    socket.on("video_offer", handleVideoOffer);
    socket.on("video_answer", handleVideoAnswer);
    socket.on("video_ice_candidate", handleIceCandidate);
    socket.on("video_call_declined", handleCallDeclined);
    socket.on("video_call_cancelled", handleCallCancelled);
    socket.on("video_call_ended", handleCallEnded);
    socket.on("video_call_error", handleCallError);

    return () => {
      socket.off("video_call_request", handleIncomingRequest);
      socket.off("video_call_accepted", handleCallAccepted);
      socket.off("video_offer", handleVideoOffer);
      socket.off("video_answer", handleVideoAnswer);
      socket.off("video_ice_candidate", handleIceCandidate);
      socket.off("video_call_declined", handleCallDeclined);
      socket.off("video_call_cancelled", handleCallCancelled);
      socket.off("video_call_ended", handleCallEnded);
      socket.off("video_call_error", handleCallError);
    };
  }, [socket, createPeerConnection, drainPendingCandidates, onNotification, teardownCall, handleConnectionFailure]);

  // Handle screen/tab close and page unload gracefully
  useEffect(() => {
    const handleUnload = () => {
      if (
        callStateRef.current === "connecting" ||
        callStateRef.current === "connected" ||
        callStateRef.current === "calling"
      ) {
        if (socket && roomIdRef.current && callIdRef.current) {
          socket.emit("video_call_ended", {
            roomId: roomIdRef.current,
            callId: callIdRef.current,
          });
        }
        if (localStreamRef.current) {
          localStreamRef.current.getTracks().forEach((track) => {
            try {
              track.stop();
            } catch {}
          });
        }
      }
    };

    window.addEventListener("beforeunload", handleUnload);
    window.addEventListener("pagehide", handleUnload);
    return () => {
      window.removeEventListener("beforeunload", handleUnload);
      window.removeEventListener("pagehide", handleUnload);
    };
  }, [socket]);

  // Teardown when unmounted or when roomId changes to a different chat
  const prevRoomIdRef = useRef<string | null>(roomId);
  useEffect(() => {
    if (prevRoomIdRef.current && roomId && prevRoomIdRef.current !== roomId) {
      teardownCall();
    } else if (prevRoomIdRef.current && !roomId) {
      teardownCall();
    }
    prevRoomIdRef.current = roomId;
  }, [roomId, teardownCall]);

  return {
    callState,
    callId,
    callerInfo,
    localStream,
    remoteStream,
    isMicMuted,
    isCameraOff,
    isRemoteCameraOff,
    errorMessage,
    connectionFailure,
    startCall,
    cancelCall,
    acceptCall,
    declineCall,
    endCall,
    toggleMute,
    toggleCamera,
    teardownCall,
    retryCall,
    dismissFailure,
  };
}
