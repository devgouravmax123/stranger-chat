"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { dataUrlToBlob } from "../lib/audioConverter";

type AudioPlayerProps = {
  src: string;
  isMe?: boolean;
};

export default function AudioPlayer({
  src,
  isMe = false,
}: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const prevBlobUrlRef = useRef<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);

  // Use the decrypted blob: URL (or data: URL) directly without creating secondary URLs or prematurely revoking
  const resolvedSrc = useMemo(() => {
    if (!src) return "";
    if (src.startsWith("data:")) {
      const blob = dataUrlToBlob(src);
      if (blob && blob.size > 0) {
        return URL.createObjectURL(blob);
      }
    }
    return src;
  }, [src]);

  // Only revoke secondary blob URLs created internally for legacy data: URLs on unmount
  useEffect(() => {
    return () => {
      if (resolvedSrc.startsWith("blob:") && src.startsWith("data:")) {
        try {
          URL.revokeObjectURL(resolvedSrc);
        } catch {}
      }
    };
  }, [resolvedSrc, src]);

  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setIsLoaded(false);
    setHasError(false);

    const audio = audioRef.current;
    if (!audio) return;

    // Explicitly guarantee unmuted full-volume output
    audio.muted = false;
    audio.volume = 1.0;

    const onPlay = () => {
      if (process.env.NODE_ENV !== "production") {
        console.log("[AudioPlayer:FORENSIC_EVENT] play", { currentTime: audio.currentTime, readyState: audio.readyState });
      }
      setIsPlaying(true);
    };

    const onPlaying = () => {
      if (process.env.NODE_ENV !== "production") {
        console.log("[AudioPlayer:FORENSIC_EVENT] playing (audio physically active)", { currentTime: audio.currentTime });
      }
      setIsPlaying(true);
      setHasError(false);
    };

    const onPause = () => {
      if (process.env.NODE_ENV !== "production") {
        console.log("[AudioPlayer:FORENSIC_EVENT] pause", { currentTime: audio.currentTime });
      }
      setIsPlaying(false);
    };

    const onWaiting = () => {
      if (process.env.NODE_ENV !== "production") {
        console.log("[AudioPlayer:FORENSIC_EVENT] waiting/buffering", { currentTime: audio.currentTime });
      }
    };

    const onCanPlay = () => {
      if (process.env.NODE_ENV !== "production") {
        console.log("[AudioPlayer:FORENSIC_EVENT] canplay", { readyState: audio.readyState, duration: audio.duration });
      }
      setIsLoaded(true);
    };

    const onCanPlayThrough = () => {
      if (process.env.NODE_ENV !== "production") {
        console.log("[AudioPlayer:FORENSIC_EVENT] canplaythrough");
      }
      setIsLoaded(true);
    };

    const onLoadedData = () => {
      if (process.env.NODE_ENV !== "production") {
        console.log("[AudioPlayer:FORENSIC_EVENT] loadeddata");
      }
      setIsLoaded(true);
    };

    const onStalled = () => {
      if (process.env.NODE_ENV !== "production") {
        console.warn("[AudioPlayer:FORENSIC_EVENT] stalled", { networkState: audio.networkState });
      }
    };

    let lastLoggedSec = -1;
    const updateTime = () => {
      const cur = audio.currentTime;
      setCurrentTime(cur);

      // Section 5: Log currentTime progression at integer/half intervals in development
      if (process.env.NODE_ENV !== "production" && !audio.paused) {
        const flooredSec = Math.floor(cur * 2) / 2;
        if (flooredSec !== lastLoggedSec) {
          lastLoggedSec = flooredSec;
          console.log(`[AudioPlayer:PROGRESSION] currentTime: ${cur.toFixed(2)}s / ${(audio.duration || 0).toFixed(2)}s`);
        }
      }

      // For streaming WebM recordings where duration header is Infinity, track progressive max time
      if (!isFinite(audio.duration) || isNaN(audio.duration)) {
        setDuration((prev) => Math.max(prev, cur));
        setIsLoaded(true);
      }
    };

    const updateDuration = () => {
      if (!isNaN(audio.duration) && isFinite(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration);
        setIsLoaded(true);
      } else if (audio.currentTime > 0) {
        setDuration((prev) => Math.max(prev, audio.currentTime));
        setIsLoaded(true);
      }
    };

    const handleEnded = () => {
      if (process.env.NODE_ENV !== "production") {
        console.log("[AudioPlayer:FORENSIC_EVENT] ended", { finalTime: audio.currentTime });
      }
      setIsPlaying(false);
      setCurrentTime(0);
      if (audio.currentTime > 0) {
        setDuration((prev) => Math.max(prev, audio.currentTime));
      }
    };

    const handleError = () => {
      const audioErr = audio?.error;
      console.warn("[AudioPlayer] Audio error event received:", {
        errorCode: audioErr?.code,
        errorMessage: audioErr?.message,
        currentSrc: audio?.currentSrc,
        audioUrl: resolvedSrc,
        rawSrcPrefix: src ? src.slice(0, 40) : "empty",
        networkState: audio?.networkState,
        readyState: audio?.readyState,
      });

      // If Blob URL failed to decode and src is data URL, fallback
      if (resolvedSrc !== src && src && audio) {
        console.log("[AudioPlayer] Falling back from Blob URL to direct Data URL source");
        audio.src = src;
        audio.load();
        return;
      }

      // Only display permanent error if user was attempting to play or audio actually failed to play
      if (audio.currentTime > 0 || !audio.paused) {
        setHasError(true);
        setIsPlaying(false);
      }
    };

    const handleLoadedMetadata = () => {
      if (process.env.NODE_ENV !== "production") {
        console.log("[AudioPlayer] loadedmetadata", {
          currentSrc: audio.currentSrc,
          duration: audio.duration,
          readyState: audio.readyState,
        });
      }
      updateDuration();
    };

    audio.addEventListener("play", onPlay);
    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("waiting", onWaiting);
    audio.addEventListener("canplay", onCanPlay);
    audio.addEventListener("canplaythrough", onCanPlayThrough);
    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("loadeddata", onLoadedData);
    audio.addEventListener("durationchange", updateDuration);
    audio.addEventListener("timeupdate", updateTime);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("stalled", onStalled);
    audio.addEventListener("error", handleError);

    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("waiting", onWaiting);
      audio.removeEventListener("canplay", onCanPlay);
      audio.removeEventListener("canplaythrough", onCanPlayThrough);
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("loadeddata", onLoadedData);
      audio.removeEventListener("durationchange", updateDuration);
      audio.removeEventListener("timeupdate", updateTime);
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("stalled", onStalled);
      audio.removeEventListener("error", handleError);
    };
  }, [resolvedSrc]);

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      // Explicitly ensure audio element is unmuted and volume is full 1.0
      audio.muted = false;
      audio.volume = 1.0;

      // Unlock and verify browser audio hardware sink on user gesture
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

      // If audio has reached the end, reset to beginning
      if (audio.ended || (duration > 0 && Math.abs(audio.currentTime - duration) < 0.2)) {
        audio.currentTime = 0;
      }

      // Safe development diagnostics
      if (process.env.NODE_ENV !== "production") {
        console.log("[AudioPlayer:DEV_PLAY_CLICK]", {
          tagName: audio.tagName,
          muted: audio.muted,
          volume: audio.volume,
          paused: audio.paused,
          readyState: audio.readyState,
          networkState: audio.networkState,
          srcPrefix: audio.src ? audio.src.slice(0, 45) : "empty",
          currentSrcPrefix: audio.currentSrc ? audio.currentSrc.slice(0, 45) : "empty",
          currentTime: audio.currentTime,
        });
      }

      audio
        .play()
        .then(() => {
          setIsPlaying(true);
          setHasError(false);
          if (process.env.NODE_ENV !== "production") {
            console.log("[AudioPlayer] play() resolved successfully - audio should be audible through physical speakers");
          }
        })
        .catch((err) => {
          console.error("[AudioPlayer] Audio playback error on play():", err);
          setIsPlaying(false);
          setHasError(true);
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

  const toggleSpeed = () => {
    const audio = audioRef.current;
    if (!audio) return;

    const rates = [1, 1.5, 2];
    const currentIndex = rates.indexOf(playbackRate);
    const nextRate = rates[(currentIndex + 1) % rates.length];
    audio.playbackRate = nextRate;
    setPlaybackRate(nextRate);
  };

  const formatTime = (seconds: number) => {
    if (!seconds || isNaN(seconds)) return "00:00";
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs
      .toString()
      .padStart(2, "0")}`;
  };

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  if (hasError) {
    return (
      <div
        className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium ${
          isMe
            ? "bg-indigo-900/40 border border-indigo-500/30 text-indigo-200"
            : "bg-zinc-800 border border-zinc-700 text-zinc-400"
        }`}
      >
        <span className="text-sm">⚠️</span>
        <span>Unable to play this voice note.</span>
      </div>
    );
  }

  return (
    <div
      className={`flex items-center gap-3 rounded-2xl p-2.5 min-w-[240px] max-w-[300px] select-none transition-all ${
        isMe ? "text-white" : "text-zinc-900"
      }`}
    >
      <audio ref={audioRef} src={resolvedSrc} preload="auto" />

      {/* PLAY / PAUSE BUTTON */}
      <button
        type="button"
        onClick={togglePlay}
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-base font-bold transition transform active:scale-95 ${
          isMe
            ? "bg-white text-zinc-900 hover:bg-zinc-100"
            : "bg-zinc-900 text-white hover:bg-zinc-800"
        }`}
        aria-label={isPlaying ? "Pause voice note" : "Play voice note"}
      >
        {isPlaying ? (
          <span className="text-sm">❚❚</span>
        ) : (
          <span className="ml-0.5 text-sm">▶</span>
        )}
      </button>

      {/* WAVE / PROGRESS TRACK & TIME */}
      <div className="flex flex-1 flex-col gap-1 min-w-0">
        <div className="relative flex items-center h-4 cursor-pointer">
          <input
            type="range"
            min={0}
            max={duration || 100}
            step={0.1}
            value={currentTime}
            onChange={handleSeek}
            aria-label="Seek audio playback"
            aria-valuetext={`${formatTime(currentTime)} of ${formatTime(duration)}`}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
          />

          {/* BACKGROUND TRACK */}
          <div
            className={`h-2 w-full rounded-full overflow-hidden ${
              isMe ? "bg-white/20" : "bg-zinc-200"
            }`}
          >
            {/* PROGRESS FILL */}
            <div
              className={`h-full transition-all duration-75 ${
                isMe ? "bg-white" : "bg-zinc-900"
              }`}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        <div
          className={`flex items-center justify-between text-[11px] font-mono tracking-tight ${
            isMe ? "text-zinc-300" : "text-zinc-500"
          }`}
        >
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      {/* PLAYBACK SPEED TOGGLE */}
      <button
        type="button"
        onClick={toggleSpeed}
        className={`rounded-lg px-1.5 py-0.5 text-[11px] font-semibold transition ${
          isMe
            ? "bg-white/10 text-white hover:bg-white/20"
            : "bg-zinc-200 text-zinc-700 hover:bg-zinc-300"
        }`}
        title="Playback Speed"
      >
        {playbackRate}x
      </button>
    </div>
  );
}
