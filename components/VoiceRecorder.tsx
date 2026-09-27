"use client";

import { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from "react";
import { MAX_E2EE_AUDIO_BYTES, MAX_VOICE_DURATION_SECONDS } from "@/lib/crypto";

export type VoiceRecorderHandle = {
  startRecording: () => void;
  stopAndPreview: () => void;
  cancelRecording: () => void;
};

type VoiceRecorderProps = {
  onRecorded: (audioBlob: Blob) => void;
  disabled?: boolean;
  disabledReason?: string;
  buttonClassName?: string;
  onRecordingStateChange?: (state: "idle" | "recording" | "recorded") => void;
};

const VoiceRecorder = forwardRef<VoiceRecorderHandle, VoiceRecorderProps>(function VoiceRecorder(
  {
    onRecorded,
    disabled = false,
    disabledReason,
    buttonClassName,
    onRecordingStateChange,
  },
  ref
) {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const durationRef = useRef(0);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  const [recording, setRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [recordedDuration, setRecordedDuration] = useState(0);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [previewError, setPreviewError] = useState("");
  const [isSending, setIsSending] = useState(false);

  // Notify parent of recording state
  useEffect(() => {
    if (onRecordingStateChange) {
      if (recording) {
        onRecordingStateChange("recording");
      } else if (previewUrl) {
        onRecordingStateChange("recorded");
      } else {
        onRecordingStateChange("idle");
      }
    }
  }, [recording, previewUrl, onRecordingStateChange]);

  durationRef.current = duration;

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupHardware();
      if (audioRef.current) {
        try {
          audioRef.current.pause();
        } catch {}
      }
      if (previewUrlRef.current) {
        try {
          URL.revokeObjectURL(previewUrlRef.current);
        } catch {}
        previewUrlRef.current = null;
      }
    };
  }, []);

  const cleanupHardware = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {}
      });
      streamRef.current = null;
    }

    mediaRecorderRef.current = null;
  };

  const getSupportedMimeType = () => {
    if (typeof MediaRecorder === "undefined") return "";
    const types = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4",
      "audio/ogg;codecs=opus",
      "audio/ogg",
      "audio/wav",
    ];
    for (const type of types) {
      if (typeof MediaRecorder.isTypeSupported === "function" && MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }
    return "";
  };

  const startRecording = async () => {
    if (disabled) return;

    // Reset preview if exists
    cancelRecording();

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert("Your browser does not support microphone access.");
        return;
      }

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      } catch (constraintErr: any) {
        console.warn("[VoiceRecorder] getUserMedia with constraints failed, falling back to basic audio capture", constraintErr);
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }

      stream.getAudioTracks().forEach((track) => {
        track.enabled = true;
      });

      streamRef.current = stream;
      chunksRef.current = [];

      const mimeType = getSupportedMimeType();
      const options = mimeType ? { mimeType } : undefined;

      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onerror = (e) => {
        console.error("[VoiceRecorder] Recording error:", e);
        cleanupHardware();
        setRecording(false);
        chunksRef.current = [];
        alert("Your voice note could not be recorded. Please try again.");
      };

      mediaRecorder.onstop = () => {
        const finalMime = mediaRecorder.mimeType || mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type: finalMime });
        const finalSecs = durationRef.current;
        cleanupHardware();

        if (blob.size > MAX_E2EE_AUDIO_BYTES) {
          chunksRef.current = [];
          setRecording(false);
          const maxMb = (MAX_E2EE_AUDIO_BYTES / (1024 * 1024)).toFixed(1);
          alert(`Voice note is too large. Maximum allowed size is ${maxMb} MB.`);
          return;
        }

        if (blob.size > 200) {
          setRecordedBlob(blob);
          setRecordedDuration(finalSecs);

          // Revoke any previous URL
          if (previewUrlRef.current) {
            try {
              URL.revokeObjectURL(previewUrlRef.current);
            } catch {}
          }

          const url = URL.createObjectURL(blob);
          previewUrlRef.current = url;
          setPreviewUrl(url);
          setCurrentTime(0);
          setIsPlaying(false);
          setPreviewError("");
        } else {
          chunksRef.current = [];
          setRecording(false);
          alert("Recording was too short or empty. Please speak into your microphone and try again.");
        }
      };

      mediaRecorder.start(100);
      setDuration(0);
      setRecording(true);

      timerRef.current = setInterval(() => {
        setDuration((prev) => {
          const next = prev + 1;
          if (next >= MAX_VOICE_DURATION_SECONDS) {
            // Auto-stop at max duration
            setTimeout(() => {
              stopAndPreview();
            }, 0);
          }
          return next;
        });
      }, 1000);
    } catch (err: any) {
      console.error("[VoiceRecorder] Microphone access error:", err);
      cleanupHardware();
      setRecording(false);
      let msg = "Could not access microphone. Please check browser permissions.";
      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        msg = "Microphone permission is required to send voice notes.";
      } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
        msg = "Your microphone isn't available right now.";
      }
      alert(msg);
    }
  };

  const stopAndPreview = () => {
    if (mediaRecorderRef.current && recording) {
      setRecording(false);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }

      if (mediaRecorderRef.current.state !== "inactive") {
        try {
          if (typeof mediaRecorderRef.current.requestData === "function") {
            mediaRecorderRef.current.requestData();
          }
        } catch {}
        try {
          mediaRecorderRef.current.stop();
        } catch {}
      }
    }
  };

  const cancelRecording = useCallback(() => {
    if (audioRef.current) {
      try {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      } catch {}
    }
    setIsPlaying(false);
    setCurrentTime(0);

    if (recording && mediaRecorderRef.current) {
      mediaRecorderRef.current.onstop = null;
      mediaRecorderRef.current.onerror = null;
      try {
        if (mediaRecorderRef.current.state !== "inactive") {
          mediaRecorderRef.current.stop();
        }
      } catch {}
    }
    setRecording(false);
    cleanupHardware();
    chunksRef.current = [];

    if (previewUrlRef.current) {
      try {
        URL.revokeObjectURL(previewUrlRef.current);
      } catch {}
      previewUrlRef.current = null;
    }
    setRecordedBlob(null);
    setPreviewUrl(null);
    setDuration(0);
    setRecordedDuration(0);
    setPreviewError("");
  }, [recording]);

  useImperativeHandle(ref, () => ({
    startRecording,
    stopAndPreview,
    cancelRecording,
  }));

  const sendRecordedVoice = (blobToSend?: Blob) => {
    const targetBlob = blobToSend || recordedBlob;
    if (!targetBlob || targetBlob.size === 0) return;

    if (audioRef.current) {
      try {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      } catch {}
    }
    setIsPlaying(false);
    setIsSending(true);

    try {
      onRecorded(targetBlob);
    } finally {
      if (previewUrlRef.current) {
        try {
          URL.revokeObjectURL(previewUrlRef.current);
        } catch {}
        previewUrlRef.current = null;
      }
      setRecordedBlob(null);
      setPreviewUrl(null);
      setDuration(0);
      setRecordedDuration(0);
      setIsSending(false);
      chunksRef.current = [];
      setPreviewError("");
    }
  };

  // Preview Audio Element Event Listeners
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !previewUrl) return;

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
      try {
        audio.currentTime = 0;
      } catch {}
    };
    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
    };
    const handleError = () => {
      console.warn("[VoiceRecorder] Audio preview error:", audio.error);
      setIsPlaying(false);
      setPreviewError("Unable to preview this voice note. Please try recording again.");
    };

    audio.addEventListener("play", handlePlay);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("error", handleError);

    return () => {
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("error", handleError);
    };
  }, [previewUrl]);

  // Toggle Play/Pause on Preview
  const togglePreviewPlay = async () => {
    const audio = audioRef.current;
    if (!audio || !previewUrl) return;

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      setPreviewError("");
      audio.muted = false;
      audio.volume = 1.0;

      // Unlock browser audio output sink on user interaction
      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) {
          const ctx = new AudioCtx();
          if (ctx.state === "suspended") {
            await ctx.resume();
          }
          await ctx.close();
        }
      } catch {}

      // Reset to beginning if at or near the end
      const maxDur = recordedDuration || duration || 0;
      if (audio.ended || (maxDur > 0 && Math.abs(audio.currentTime - maxDur) < 0.2)) {
        audio.currentTime = 0;
      }

      audio
        .play()
        .then(() => {
          setIsPlaying(true);
        })
        .catch((err) => {
          console.error("[VoiceRecorder] Preview play() error:", err);
          setIsPlaying(false);
          if (err.name !== "AbortError") {
            setPreviewError("Unable to preview this voice note. Please try recording again.");
          }
        });
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio) return;
    const newTime = parseFloat(e.target.value);
    audio.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const formatDuration = (seconds: number) => {
    if (!seconds || isNaN(seconds)) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const totalPreviewDuration = recordedDuration || duration || 1;
  const progressPercent =
    totalPreviewDuration > 0
      ? Math.min(100, (currentTime / totalPreviewDuration) * 100)
      : 0;

  return (
    <div className="w-full flex items-center">
      {/* Hidden audio element for preview */}
      <audio
        ref={audioRef}
        src={previewUrl || undefined}
        preload="auto"
        playsInline
      />

      {/* STATE 2: ACTIVE RECORDING INLINE INSIDE COMPOSER */}
      {recording && (
        <div className="w-full flex items-center justify-between gap-2 sm:gap-3 rounded-xl bg-zinc-950 border border-red-500/50 px-3 sm:px-4 py-2 sm:py-2.5 shadow-inner animate-fadeIn">
          {/* Left: Pulsing Red Indicator & Elapsed Timer */}
          <div className="flex items-center gap-2 shrink-0">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
            </span>
            <span className="font-mono font-bold text-xs sm:text-sm text-red-400">
              {formatDuration(duration)}
            </span>
          </div>

          {/* Center: Live Waveform Visualizer bars */}
          <div className="flex-1 flex items-center justify-center gap-1 sm:gap-1.5 overflow-hidden px-2 h-7">
            <div className="w-1 bg-red-500/80 rounded-full animate-pulse h-3" style={{ animationDuration: '0.4s' }} />
            <div className="w-1 bg-red-400 rounded-full animate-pulse h-6" style={{ animationDuration: '0.6s' }} />
            <div className="w-1 bg-red-500/90 rounded-full animate-pulse h-4" style={{ animationDuration: '0.3s' }} />
            <div className="w-1 bg-red-400 rounded-full animate-pulse h-7" style={{ animationDuration: '0.5s' }} />
            <div className="w-1 bg-red-500 rounded-full animate-pulse h-5" style={{ animationDuration: '0.45s' }} />
            <div className="w-1 bg-red-400 rounded-full animate-pulse h-3" style={{ animationDuration: '0.35s' }} />
            <div className="w-1 bg-red-500/90 rounded-full animate-pulse h-6" style={{ animationDuration: '0.55s' }} />
            <div className="w-1 bg-red-400 rounded-full animate-pulse h-4" style={{ animationDuration: '0.4s' }} />
            <div className="w-1 bg-red-500 rounded-full animate-pulse h-7" style={{ animationDuration: '0.65s' }} />
            <div className="hidden xs:block w-1 bg-red-400 rounded-full animate-pulse h-5" style={{ animationDuration: '0.42s' }} />
            <div className="hidden xs:block w-1 bg-red-500/80 rounded-full animate-pulse h-3" style={{ animationDuration: '0.38s' }} />
            <div className="hidden sm:block w-1 bg-red-400 rounded-full animate-pulse h-6" style={{ animationDuration: '0.58s' }} />
            <div className="hidden sm:block w-1 bg-red-500 rounded-full animate-pulse h-4" style={{ animationDuration: '0.48s' }} />
          </div>

          {/* Right Actions: Discard (Trash) & Stop Recording (Checkmark/Done) */}
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={cancelRecording}
              title="Cancel recording"
              aria-label="Cancel recording"
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-800/80 hover:bg-zinc-700 text-zinc-400 hover:text-red-400 text-sm transition active:scale-95 cursor-pointer"
            >
              🗑️
            </button>
            <button
              type="button"
              onClick={stopAndPreview}
              title="Finish recording"
              aria-label="Finish recording"
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-bold transition active:scale-95 cursor-pointer shadow-sm"
            >
              ⏹
            </button>
          </div>
        </div>
      )}

      {/* STATE 3: RECORDED AUDIO PREVIEW INLINE INSIDE COMPOSER */}
      {previewUrl && !recording && (
        <div className="w-full flex items-center justify-between gap-2 sm:gap-3 rounded-xl bg-zinc-950 border border-zinc-700/80 px-2.5 sm:px-3 py-1.5 sm:py-2 shadow-inner animate-fadeIn">
          {/* Play/Pause Button */}
          <button
            type="button"
            onClick={togglePreviewPlay}
            className="flex h-8 w-8 sm:h-9 sm:w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs sm:text-sm font-bold shadow-md transition active:scale-95 cursor-pointer"
            aria-label={isPlaying ? "Pause voice message" : "Play voice message"}
            title={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? (
              <span>❚❚</span>
            ) : (
              <span className="ml-0.5">▶</span>
            )}
          </button>

          {/* Timeline / Waveform Scrubber & Timer */}
          <div className="flex-1 min-w-0 flex flex-col justify-center">
            <div className="relative flex items-center h-4 cursor-pointer">
              <input
                type="range"
                min={0}
                max={totalPreviewDuration}
                step={0.05}
                value={currentTime}
                onChange={handleSeek}
                aria-label="Seek voice message preview"
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
              />
              <div className="h-1.5 sm:h-2 w-full rounded-full bg-zinc-800 overflow-hidden border border-zinc-700/50">
                <div
                  className="h-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all duration-75"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>

            <div className="flex items-center justify-between text-[10px] sm:text-[11px] font-mono text-zinc-400 px-0.5">
              <span>{formatDuration(currentTime)}</span>
              <span>{formatDuration(totalPreviewDuration)}</span>
            </div>
          </div>

          {/* Cancel/Discard Button */}
          <button
            type="button"
            onClick={cancelRecording}
            className="flex h-8 w-8 sm:h-9 sm:w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-800/80 hover:bg-zinc-700 hover:text-red-400 text-zinc-400 transition active:scale-95 cursor-pointer"
            title="Discard voice message"
            aria-label="Cancel recording"
          >
            🗑️
          </button>

          {/* WhatsApp-Style Right Arrow Send Button */}
          <button
            type="button"
            onClick={() => sendRecordedVoice()}
            disabled={isSending}
            className="flex h-8 w-8 sm:h-9 sm:w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white shadow-md active:scale-95 transition disabled:opacity-50 cursor-pointer"
            title="Send voice message"
            aria-label="Send message"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="w-4 h-4 sm:w-5 sm:h-5"
            >
              <path
                fillRule="evenodd"
                d="M3 10a.75.75 0 01.75-.75h10.638L10.23 5.29a.75.75 0 111.04-1.08l5.5 5.25a.75.75 0 010 1.08l-5.5 5.25a.75.75 0 11-1.04-1.08l4.158-3.96H3.75A.75.75 0 013 10z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>
      )}

      {/* STATE 1: IDLE MICROPHONE BUTTON (Inside input area) */}
      {!recording && !previewUrl && (
        <button
          type="button"
          onClick={startRecording}
          disabled={disabled}
          title={disabled && disabledReason ? disabledReason : "Record voice message"}
          aria-label={disabled && disabledReason ? disabledReason : "Record voice message"}
          className={
            buttonClassName
              ? buttonClassName
              : "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 hover:text-white text-base transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          }
        >
          🎙️
        </button>
      )}
    </div>
  );
});

export default VoiceRecorder;