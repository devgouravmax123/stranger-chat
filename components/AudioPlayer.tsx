"use client";

import { useEffect, useRef, useState } from "react";

type AudioPlayerProps = {
  src: string;
  isMe?: boolean;
};

export default function AudioPlayer({
  src,
  isMe = false,
}: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setIsLoaded(false);

    const audio = audioRef.current;
    if (!audio) return;

    const updateTime = () => setCurrentTime(audio.currentTime);
    const updateDuration = () => {
      if (!isNaN(audio.duration) && isFinite(audio.duration)) {
        setDuration(audio.duration);
        setIsLoaded(true);
      }
    };
    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };

    audio.addEventListener("timeupdate", updateTime);
    audio.addEventListener("loadedmetadata", updateDuration);
    audio.addEventListener("durationchange", updateDuration);
    audio.addEventListener("ended", handleEnded);

    return () => {
      audio.removeEventListener("timeupdate", updateTime);
      audio.removeEventListener("loadedmetadata", updateDuration);
      audio.removeEventListener("durationchange", updateDuration);
      audio.removeEventListener("ended", handleEnded);
    };
  }, [src]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      audio
        .play()
        .then(() => setIsPlaying(true))
        .catch((err) => console.error("Audio playback error:", err));
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
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, "0")}:${secs
      .toString()
      .padStart(2, "0")}`;
  };

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div
      className={`flex items-center gap-3 rounded-2xl p-2.5 min-w-[240px] max-w-[300px] select-none transition-all ${
        isMe ? "text-white" : "text-zinc-900"
      }`}
    >
      <audio ref={audioRef} src={src} preload="metadata" />

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
