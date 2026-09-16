"use client";

import { useEffect, useRef, useState } from "react";

type VoiceRecorderProps = {
  onRecorded: (audioBlob: Blob) => void;
  disabled?: boolean;
};

export default function VoiceRecorder({
  onRecorded,
  disabled = false,
}: VoiceRecorderProps) {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [recording, setRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  useEffect(() => {
    return () => {
      cleanupHardware();
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, []);

  const cleanupHardware = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    mediaRecorderRef.current = null;
  };

  const getSupportedMimeType = () => {
    if (typeof MediaRecorder === "undefined") return "";
    const types = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
      "audio/mp4",
      "audio/aac",
    ];
    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }
    return "";
  };

  const startRecording = async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert("Your browser does not support microphone access.");
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
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

      mediaRecorder.onstop = () => {
        cleanupHardware();
        const type = mimeType || mediaRecorder.mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });

        if (blob.size > 0) {
          setRecordedBlob(blob);
          const url = URL.createObjectURL(blob);
          setPreviewUrl(url);
        }
      };

      mediaRecorder.start(100);
      setDuration(0);
      setRecording(true);

      timerRef.current = setInterval(() => {
        setDuration((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      console.error("Microphone access error:", err);
      cleanupHardware();
      setRecording(false);
      alert("Could not access microphone. Please check browser permissions.");
    }
  };

  const stopAndPreview = () => {
    if (mediaRecorderRef.current && recording) {
      setRecording(false);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      mediaRecorderRef.current.stop();
    }
  };

  const cancelRecording = () => {
    if (recording && mediaRecorderRef.current) {
      mediaRecorderRef.current.onstop = () => {
        cleanupHardware();
        chunksRef.current = [];
      };
      mediaRecorderRef.current.stop();
    }
    setRecording(false);
    cleanupHardware();
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setRecordedBlob(null);
    setPreviewUrl(null);
    setDuration(0);
  };

  const sendRecordedVoice = (blobToSend?: Blob) => {
    const targetBlob = blobToSend || recordedBlob;
    if (!targetBlob) return;

    setIsSending(true);
    onRecorded(targetBlob);

    // Reset state
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setRecordedBlob(null);
    setPreviewUrl(null);
    setDuration(0);
    setIsSending(false);
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs
      .toString()
      .padStart(2, "0")}`;
  };

  return (
    <div className="flex items-center gap-2">
      {/* RECORDING IN PROGRESS */}
      {recording && (
        <div className="flex items-center gap-2 rounded-xl bg-red-950/80 border border-red-800/80 px-3 py-1.5 text-sm text-red-300 animate-fadeIn">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
          </span>

          <span className="font-mono font-medium text-xs">{formatDuration(duration)}</span>

          {/* STOP & REVIEW */}
          <button
            type="button"
            onClick={stopAndPreview}
            title="Done recording"
            className="ml-1 rounded-lg bg-red-600 px-2 py-1 text-xs font-semibold text-white transition hover:bg-red-500 active:scale-95"
          >
            Done ⏹
          </button>

          {/* CANCEL */}
          <button
            type="button"
            onClick={cancelRecording}
            title="Cancel recording"
            className="rounded-lg bg-zinc-800 border border-zinc-700 px-2 py-1 text-xs font-semibold text-zinc-300 transition hover:bg-zinc-700"
          >
            ✕
          </button>
        </div>
      )}

      {/* PREVIEW & SEND SCREEN */}
      {previewUrl && !recording && (
        <div className="flex items-center gap-2 rounded-xl bg-zinc-800 border border-zinc-700/80 p-1.5">
          <audio src={previewUrl} controls className="h-8 max-w-[180px]" />

          <button
            type="button"
            onClick={() => sendRecordedVoice()}
            disabled={isSending}
            title="Send Voice Note"
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition active:scale-95 disabled:opacity-50"
          >
            ✓
          </button>

          <button
            type="button"
            onClick={cancelRecording}
            title="Discard Voice Note"
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-700 text-zinc-300 text-xs font-bold transition hover:bg-zinc-600 active:scale-95"
          >
            🗑
          </button>
        </div>
      )}

      {/* IDLE MIC BUTTON */}
      {!recording && !previewUrl && (
        <button
          type="button"
          onClick={startRecording}
          disabled={disabled}
          title="Record Voice Note"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700/60 text-xl text-zinc-200 transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
        >
          🎙️
        </button>
      )}
    </div>
  );
}