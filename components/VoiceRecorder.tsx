"use client";

import { useEffect, useRef, useState, useCallback } from "react";

type VoiceRecorderProps = {
  onRecorded: (audioBlob: Blob) => void;
  disabled?: boolean;
  disabledReason?: string;
};

export default function VoiceRecorder({
  onRecorded,
  disabled = false,
  disabledReason,
}: VoiceRecorderProps) {
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
        setDuration((prev) => prev + 1);
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
    <div className="relative flex items-center gap-2">
      {/* Hidden audio element for preview */}
      <audio
        ref={audioRef}
        src={previewUrl || undefined}
        preload="auto"
        playsInline
      />

      {/* RECORDING IN PROGRESS PILL */}
      {recording && (
        <div className="flex items-center gap-2 rounded-xl bg-red-950/90 border border-red-800/90 px-3 py-1.5 text-sm text-red-300 animate-fadeIn shadow-lg">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
          </span>

          <span className="font-mono font-bold text-xs text-white">
            {formatDuration(duration)}
          </span>

          {/* STOP & REVIEW BUTTON */}
          <button
            type="button"
            onClick={stopAndPreview}
            title="Done recording"
            aria-label="Done recording"
            className="ml-1 rounded-lg bg-red-600 hover:bg-red-500 px-2.5 py-1 text-xs font-semibold text-white transition active:scale-95 cursor-pointer shadow-xs"
          >
            Done ⏹
          </button>

          {/* CANCEL BUTTON */}
          <button
            type="button"
            onClick={cancelRecording}
            title="Cancel recording"
            aria-label="Cancel recording"
            className="rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 px-2 py-1 text-xs font-semibold text-zinc-300 transition cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* PREVIEW CARD (MATCHES SECTION 25 SPECIFICATION) */}
      {previewUrl && !recording && (
        <div className="absolute bottom-full mb-3 right-0 sm:right-auto sm:left-0 w-80 max-w-[calc(100vw-32px)] bg-zinc-900/95 border border-zinc-700/90 rounded-2xl p-4 shadow-2xl backdrop-blur-xl z-30 animate-fadeIn text-zinc-100">
          {/* Header */}
          <div className="flex items-center justify-between pb-2.5 border-b border-zinc-800/80">
            <div className="flex items-center gap-2">
              <span className="text-base">🎙️</span>
              <span className="text-xs font-bold text-white tracking-wide uppercase">
                Voice Note Ready
              </span>
            </div>
            <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded-md bg-indigo-950/80 text-indigo-300 border border-indigo-800/40">
              {formatDuration(totalPreviewDuration)}
            </span>
          </div>

          {/* Playback & Progress Scrubber */}
          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={togglePreviewPlay}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold shadow-md shadow-indigo-600/30 transition active:scale-95 cursor-pointer"
              aria-label={isPlaying ? "Pause voice note preview" : "Play voice note preview"}
            >
              {isPlaying ? (
                <span>❚❚</span>
              ) : (
                <span className="ml-0.5">▶</span>
              )}
            </button>

            <div className="flex-1 min-w-0">
              {/* Scrubbing track */}
              <div className="relative flex items-center h-4 cursor-pointer">
                <input
                  type="range"
                  min={0}
                  max={totalPreviewDuration}
                  step={0.05}
                  value={currentTime}
                  onChange={handleSeek}
                  aria-label="Seek voice note preview"
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                />
                <div className="h-2 w-full rounded-full bg-zinc-800 overflow-hidden border border-zinc-700/50">
                  <div
                    className="h-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all duration-75"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>

              {/* Progress timers */}
              <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400 mt-1">
                <span>{formatDuration(currentTime)}</span>
                <span>{formatDuration(totalPreviewDuration)}</span>
              </div>
            </div>
          </div>

          {/* Error message */}
          {previewError && (
            <p className="mt-2.5 text-xs text-red-300 bg-red-950/60 border border-red-900/50 rounded-lg p-2 leading-relaxed">
              ⚠️ {previewError}
            </p>
          )}

          {/* Action Buttons: Delete & Send */}
          <div className="mt-4 pt-3 border-t border-zinc-800/80 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={cancelRecording}
              className="px-3.5 py-2 rounded-xl text-xs font-semibold text-zinc-400 hover:text-red-400 hover:bg-red-950/40 border border-zinc-800 hover:border-red-900/50 transition active:scale-95 flex items-center gap-1.5 cursor-pointer"
            >
              <span>🗑</span>
              <span>Delete</span>
            </button>

            <button
              type="button"
              onClick={() => sendRecordedVoice()}
              disabled={isSending}
              className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 shadow-md shadow-indigo-600/30 transition active:scale-95 disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
            >
              <span>🚀</span>
              <span>{isSending ? "Sending..." : "Send"}</span>
            </button>
          </div>
        </div>
      )}

      {/* IDLE MIC BUTTON */}
      {!recording && (
        <button
          type="button"
          onClick={previewUrl ? togglePreviewPlay : startRecording}
          disabled={disabled}
          title={
            disabled && disabledReason
              ? disabledReason
              : previewUrl
              ? "Preview Voice Note"
              : "Record Voice Note"
          }
          aria-label={
            disabled && disabledReason
              ? disabledReason
              : previewUrl
              ? "Preview Voice Note"
              : "Record Voice Note"
          }
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border text-xl transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 ${
            previewUrl
              ? "bg-indigo-600/20 border-indigo-500 text-indigo-400 shadow-xs"
              : "bg-zinc-800 hover:bg-zinc-700 border-zinc-700/60 text-zinc-200"
          }`}
        >
          🎙️
        </button>
      )}
    </div>
  );
}