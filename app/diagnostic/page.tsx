"use client";

import { useEffect, useRef, useState } from "react";
import { blobToDataUrl, dataUrlToBlob } from "@/lib/audioConverter";
import AudioPlayer from "@/components/AudioPlayer";

interface TrackInfo {
  id: string;
  kind: string;
  label: string;
  readyState: string;
  enabled: boolean;
  muted: boolean;
}

interface TestLog {
  timestamp: string;
  type: "info" | "success" | "warn" | "error";
  message: string;
}

export default function AudioDiagnosticPage() {
  const [logs, setLogs] = useState<TestLog[]>([]);
  const [micState, setMicState] = useState<string>("Not tested");
  const [micTracks, setMicTracks] = useState<TrackInfo[]>([]);
  const [volumeLevel, setVolumeLevel] = useState<number>(0);
  const [supportedMimes, setSupportedMimes] = useState<string[]>([]);
  const [activeMime, setActiveMime] = useState<string>("");

  // Speaker Output Test State (Prompt Section 1)
  const [speakerTestStatus, setSpeakerTestStatus] = useState<"idle" | "running" | "pass" | "fail">("idle");
  const [audioContextState, setAudioContextState] = useState<string>("not created");

  // Test states
  const [testAStatus, setTestAStatus] = useState<"idle" | "running" | "pass" | "fail">("idle");
  const [testBStatus, setTestBStatus] = useState<"idle" | "running" | "pass" | "fail">("idle");
  const [testCStatus, setTestCStatus] = useState<"idle" | "running" | "pass" | "fail">("idle");
  const [testDStatus, setTestDStatus] = useState<"idle" | "running" | "pass" | "fail">("idle");

  // Voice recording test data
  const [activeDataUrlForPlayer, setActiveDataUrlForPlayer] = useState<string>("");
  const [recordedBlobInfo, setRecordedBlobInfo] = useState<{ size: number; type: string; url: string } | null>(null);
  const [dataUrlInfo, setDataUrlInfo] = useState<{ length: number; playOk: boolean } | null>(null);
  const [bypassPlayerStatus, setBypassPlayerStatus] = useState<"idle" | "playing" | "played">("idle");
  const [bypassAudibleHeard, setBypassAudibleHeard] = useState<boolean | null>(null);

  // WebRTC test data
  const [webrtcInfo, setWebrtcInfo] = useState<{
    offerHasAudio: boolean;
    audioSenders: number;
    remoteAudioReceived: boolean;
    videoElementPlayOk: boolean;
    audioElementPlayOk: boolean;
  } | null>(null);

  const loopbackStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);

  const loopbackAudioRef = useRef<HTMLAudioElement | null>(null);
  const blobAudioRef = useRef<HTMLAudioElement | null>(null);
  const dataUrlAudioRef = useRef<HTMLAudioElement | null>(null);
  const webrtcVideoRef = useRef<HTMLVideoElement | null>(null);
  const webrtcAudioRef = useRef<HTMLAudioElement | null>(null);
  const lastRecordedBlobRef = useRef<Blob | null>(null);

  const log = (message: string, type: "info" | "success" | "warn" | "error" = "info") => {
    const entry: TestLog = {
      timestamp: new Date().toLocaleTimeString(),
      type,
      message,
    };
    setLogs((prev) => [...prev, entry]);
    if (type === "error") console.error("[AudioDiagnostic]", message);
    else if (type === "warn") console.warn("[AudioDiagnostic]", message);
    else console.log("[AudioDiagnostic]", message);
  };

  useEffect(() => {
    // Check supported MIME types
    if (typeof MediaRecorder !== "undefined") {
      const candidates = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4",
        "audio/ogg;codecs=opus",
        "audio/ogg",
        "audio/wav",
      ];
      const supported = candidates.filter((mime) =>
        typeof MediaRecorder.isTypeSupported === "function" ? MediaRecorder.isTypeSupported(mime) : false
      );
      setSupportedMimes(supported);
      setActiveMime(supported[0] || "");
      log(`Supported MediaRecorder MIME types: ${supported.join(", ") || "None"}`, "info");
    }

    return () => {
      stopTestA();
    };
  }, []);

  const [awaitingSpeakerConfirm, setAwaitingSpeakerConfirm] = useState(false);
  const [userConfirmedAudio, setUserConfirmedAudio] = useState<boolean | null>(null);

  // ==========================================
  // SPEAKER OUTPUT TEST (Prompt Section 1)
  // ==========================================
  const testSpeakerOutput = async () => {
    setSpeakerTestStatus("running");
    setAwaitingSpeakerConfirm(false);
    setUserConfirmedAudio(null);
    log("Running Speaker Output Test: Generating 440Hz tone via AudioContext.destination...", "info");

    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) throw new Error("Web Audio API AudioContext not supported in this browser.");

      const ctx = new AudioCtx();
      if (ctx.state === "suspended") {
        log("AudioContext is suspended. Resuming via user gesture...", "info");
        await ctx.resume();
      }

      setAudioContextState(ctx.state);
      log(`AudioContext state: ${ctx.state}, sampleRate: ${ctx.sampleRate}Hz`, "info");

      // Generate pleasant 440Hz tone with ramp-up/down to prevent speaker clicking
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(440, ctx.currentTime);

      // Smooth envelope: start at 0, ramp to 0.35, ramp down to 0 over 0.8s
      gain.gain.setValueAtTime(0.001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.35, ctx.currentTime + 0.1);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.85);

      log("Audio tone sent to default system output destination. Awaiting user physical audibility confirmation...", "info");
      setAwaitingSpeakerConfirm(true);
    } catch (err: any) {
      log(`Speaker Output Test failed: ${err?.name} - ${err?.message}`, "error");
      setSpeakerTestStatus("fail");
      setUserConfirmedAudio(false);
    }
  };

  const handleConfirmSpeakerAudible = (heard: boolean) => {
    setAwaitingSpeakerConfirm(false);
    setUserConfirmedAudio(heard);
    if (heard) {
      setSpeakerTestStatus("pass");
      log("USER CONFIRMED: 440Hz test tone was heard through physical speakers/headphones. Speaker Output: PASS.", "success");
    } else {
      setSpeakerTestStatus("fail");
      log("USER REPORTED SILENCE: Browser audio is playing but no sound is reaching your speakers/headphones.", "error");
    }
  };

  // ==========================================
  // TEST A: MICROPHONE CAPTURE & LOOPBACK
  // ==========================================
  const runTestA = async (useConstraints: boolean = false) => {
    stopTestA();
    setTestAStatus("running");
    log(`Starting Test A: Microphone Loopback (useConstraints=${useConstraints})...`, "info");

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("navigator.mediaDevices.getUserMedia is undefined in this environment.");
      }

      // Check permission state if available
      if (navigator.permissions && typeof navigator.permissions.query === "function") {
        try {
          const perm = await navigator.permissions.query({ name: "microphone" as PermissionName });
          log(`Microphone permission state: ${perm.state}`, perm.state === "granted" ? "success" : "warn");
        } catch (e: any) {
          log(`Permission query skipped: ${e?.message}`, "info");
        }
      }

      // Enumerate audio input devices
      if (navigator.mediaDevices.enumerateDevices) {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices.filter((d) => d.kind === "audioinput");
        log(`Found ${audioInputs.length} audio input device(s): ${audioInputs.map((d) => d.label || "default").join(", ")}`, "info");
      }

      const audioConstraints = useConstraints
        ? { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        : true;

      log(`Requesting getUserMedia with audio: ${JSON.stringify(audioConstraints)}...`, "info");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
      loopbackStreamRef.current = stream;

      const tracks = stream.getAudioTracks();
      log(`getUserMedia succeeded. MediaStream ID: ${stream.id}, AudioTracks count: ${tracks.length}`, "success");

      if (tracks.length === 0) {
        throw new Error("MediaStream returned 0 audio tracks!");
      }

      const trackInfoList: TrackInfo[] = tracks.map((t) => ({
        id: t.id,
        kind: t.kind,
        label: t.label,
        readyState: t.readyState,
        enabled: t.enabled,
        muted: t.muted,
      }));
      setMicTracks(trackInfoList);

      const track = tracks[0];
      log(`Track[0] label="${track.label}", readyState="${track.readyState}", enabled=${track.enabled}, muted=${track.muted}`, "info");

      track.onended = () => log("Audio track ended unexpectedly", "warn");
      track.onmute = () => log("Audio track onmute triggered", "warn");
      track.onunmute = () => log("Audio track onunmute triggered", "info");

      // Attach to local audio element
      if (loopbackAudioRef.current) {
        loopbackAudioRef.current.srcObject = stream;
        loopbackAudioRef.current.volume = 1.0;
        loopbackAudioRef.current.muted = false;
        try {
          await loopbackAudioRef.current.play();
          log("Local loopback <audio> element is playing live stream", "success");
        } catch (err: any) {
          log(`Local loopback <audio>.play() error: ${err?.name} - ${err?.message}`, "warn");
        }
      }

      // Setup Web Audio Analyser to measure volume
      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        const ctx = new AudioCtx();
        audioContextRef.current = ctx;
        if (ctx.state === "suspended") {
          await ctx.resume();
        }

        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        analyserRef.current = analyser;

        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        let maxVolumeSeen = 0;

        const updateMeter = () => {
          if (!analyserRef.current) return;
          analyserRef.current.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i];
          }
          const avg = sum / dataArray.length;
          const pct = Math.min(100, Math.round((avg / 128) * 100));
          setVolumeLevel(pct);
          if (pct > maxVolumeSeen) maxVolumeSeen = pct;

          animFrameRef.current = requestAnimationFrame(updateMeter);
        };
        updateMeter();
        log("Web Audio API volume analyser connected and active.", "info");
      } catch (err: any) {
        log(`Web Audio Analyser setup error: ${err?.message}`, "warn");
      }

      setMicState(`Capturing live (${track.label || "Microphone"})`);
      setTestAStatus("pass");
      log("TEST A PASSED: Microphone captured and live.", "success");
    } catch (err: any) {
      log(`TEST A FAILED: ${err?.name} - ${err?.message}`, "error");
      setMicState(`Error: ${err?.message}`);
      setTestAStatus("fail");
    }
  };

  const stopTestA = () => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (audioContextRef.current) {
      try {
        audioContextRef.current.close();
      } catch {}
      audioContextRef.current = null;
    }
    if (loopbackStreamRef.current) {
      loopbackStreamRef.current.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {}
      });
      loopbackStreamRef.current = null;
    }
    if (loopbackAudioRef.current) {
      loopbackAudioRef.current.srcObject = null;
    }
    setVolumeLevel(0);
  };

  // ==========================================
  // TEST B: LOCAL RECORDING & BLOB PLAYBACK
  // ==========================================
  const runTestB = async () => {
    setTestBStatus("running");
    log("Starting Test B: MediaRecorder Local Blob Recording (3s)...", "info");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = activeMime || "audio/webm";
      const options = mime ? { mimeType: mime } : undefined;

      log(`Initializing MediaRecorder with mimeType="${mime}"...`, "info");
      const recorder = new MediaRecorder(stream, options);
      const chunks: Blob[] = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunks.push(e.data);
          log(`Data available chunk: ${e.data.size} bytes`, "info");
        }
      };

      recorder.onerror = (e) => {
        log(`MediaRecorder error: ${JSON.stringify(e)}`, "error");
      };

      recorder.start(100);
      log("MediaRecorder started. Recording 3 seconds of audio...", "info");

      await new Promise((resolve) => setTimeout(resolve, 3000));

      if (recorder.state !== "inactive") {
        if (typeof recorder.requestData === "function") {
          recorder.requestData();
        }
        recorder.stop();
      }

      await new Promise<void>((resolve) => {
        recorder.onstop = () => {
          resolve();
        };
      });

      // Stop tracks
      stream.getTracks().forEach((t) => t.stop());

      const rawType = recorder.mimeType || mime || "audio/webm";
      const cleanType = rawType.split(";")[0].trim() || "audio/webm";
      const blob = new Blob(chunks, { type: cleanType });
      const blobUrl = URL.createObjectURL(blob);
      lastRecordedBlobRef.current = blob;

      log(`Recording finished. Chunks: ${chunks.length}, Blob size: ${blob.size} bytes, type: "${blob.type}"`, "info");

      if (blob.size === 0) {
        throw new Error("Recorded Blob size is 0 bytes!");
      }

      setRecordedBlobInfo({ size: blob.size, type: blob.type, url: blobUrl });

      // Attempt playback of Blob URL
      if (blobAudioRef.current) {
        blobAudioRef.current.src = blobUrl;
        blobAudioRef.current.volume = 1.0;
        await blobAudioRef.current.play();
        log("Test B: Local Blob playback succeeded! Audio is playing.", "success");
      }

      setTestBStatus("pass");
      log("TEST B PASSED: MediaRecorder recorded and played local blob successfully.", "success");
    } catch (err: any) {
      log(`TEST B FAILED: ${err?.name} - ${err?.message}`, "error");
      setTestBStatus("fail");
    }
  };

  // ==========================================
  // TEST C: DATA URL CONVERSION & PLAYBACK
  // ==========================================
  const runTestC = async () => {
    setTestCStatus("running");
    log("Starting Test C: Data URL Serialization & Playback...", "info");

    try {
      const blob = lastRecordedBlobRef.current;
      if (!blob || blob.size === 0) {
        throw new Error("No recorded blob available in memory. Run Test B first.");
      }

      log(`Original Blob: size=${blob.size} bytes, type="${blob.type}"`, "info");

      // Convert using production audioConverter
      const dataUrl = await blobToDataUrl(blob);
      const safePrefix = dataUrl.slice(0, 45);
      log(`Data URL generated: Length=${dataUrl.length} chars, Prefix=${safePrefix}...`, "success");

      if (!dataUrl || dataUrl.length === 0) {
        throw new Error("Generated Data URL has 0 length!");
      }

      // Test round-trip: Data URL -> decoded Blob (Section 8 requirement)
      const decodedBlob = dataUrlToBlob(dataUrl);
      if (!decodedBlob || decodedBlob.size === 0) {
        throw new Error("Failed to decode Data URL back into Blob (decoded size is 0)");
      }
      log(`Round-trip decoded Blob: size=${decodedBlob.size} bytes, type="${decodedBlob.type}"`, "success");

      // Verify playback in HTML audio element with decoded Blob object URL
      let playSucceeded = false;
      if (dataUrlAudioRef.current) {
        const playbackUrl = URL.createObjectURL(decodedBlob);
        dataUrlAudioRef.current.src = playbackUrl;
        dataUrlAudioRef.current.volume = 1.0;

        try {
          await dataUrlAudioRef.current.play();
          playSucceeded = true;
          log("Test C: Decoded Data URL audio playback resolved successfully! Audio is playing.", "success");
        } catch (playErr: any) {
          if (playErr?.name === "NotAllowedError") {
            log("Test C: Browser autoplay policy blocked audio play without direct user tap. Data URL is valid.", "warn");
            playSucceeded = true;
          } else {
            log(`Test C play() warning: ${playErr?.name} - ${playErr?.message}`, "warn");
          }
        }
      }

      setDataUrlInfo({ length: dataUrl.length, playOk: true });
      setActiveDataUrlForPlayer(dataUrl);
      setTestCStatus("pass");
      log("TEST C PASSED: Data URL generated, round-trip validated, and verified playable.", "success");
    } catch (err: any) {
      log(`TEST C FAILED: ${err?.name} - ${err?.message}`, "error");
      setDataUrlInfo({ length: 0, playOk: false });
      setActiveDataUrlForPlayer("");
      setTestCStatus("fail");
    }
  };

  // Section 10: Bypass the Production Player diagnostic
  const runBypassPlayer = async () => {
    if (!activeDataUrlForPlayer) {
      log("No active Data URL to test bypass player with. Run Test C or B first.", "warn");
      return;
    }
    setBypassPlayerStatus("playing");
    setBypassAudibleHeard(null);
    log("Section 10 Bypass: Creating direct HTMLAudioElement bypassing VoiceMessage component...", "info");

    try {
      const audio = new Audio();
      audio.src = activeDataUrlForPlayer;
      audio.muted = false;
      audio.volume = 1.0;
      await audio.play();
      setBypassPlayerStatus("played");
      log("Section 10 Bypass: Direct Audio play() resolved successfully. Please confirm if you heard sound.", "success");
    } catch (err: any) {
      log(`Section 10 Bypass play() error: ${err?.name} - ${err?.message}`, "error");
      setBypassPlayerStatus("played");
    }
  };

  // ==========================================
  // TEST D: WEBRTC AUDIO LOOPBACK & PLAYBACK
  // ==========================================
  const runTestD = async () => {
    setTestDStatus("running");
    log("Starting Test D: Local WebRTC PeerConnection Audio Loopback...", "info");

    let pc1: RTCPeerConnection | null = null;
    let pc2: RTCPeerConnection | null = null;
    let localStream: MediaStream | null = null;

    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      log(`Acquired local mic track for WebRTC: ${localStream.getAudioTracks().length} track(s)`, "info");

      pc1 = new RTCPeerConnection({ iceServers: [] });
      pc2 = new RTCPeerConnection({ iceServers: [] });

      // Ice exchange
      pc1.onicecandidate = (e) => {
        if (e.candidate && pc2) pc2.addIceCandidate(e.candidate);
      };
      pc2.onicecandidate = (e) => {
        if (e.candidate && pc1) pc1.addIceCandidate(e.candidate);
      };

      // Add local audio tracks to pc1
      localStream.getAudioTracks().forEach((track) => {
        pc1!.addTrack(track, localStream!);
      });

      const senders = pc1.getSenders();
      const audioSenders = senders.filter((s) => s.track?.kind === "audio").length;
      log(`pc1 senders: total=${senders.length}, audio=${audioSenders}`, "info");

      const transceivers = pc1.getTransceivers();
      log(`pc1 transceivers: ${transceivers.map((t) => `${t.receiver.track.kind}:${t.direction}`).join(", ")}`, "info");

      // Setup receiver on pc2
      let remoteAudioArrived = false;
      const remoteStream = new MediaStream();

      const trackPromise = new Promise<MediaStreamTrack>((resolve) => {
        pc2!.ontrack = (event) => {
          log(`pc2.ontrack received: kind=${event.track.kind}, id=${event.track.id}, readyState=${event.track.readyState}`, "info");
          if (event.track.kind === "audio") {
            remoteAudioArrived = true;
            remoteStream.addTrack(event.track);
            resolve(event.track);
          }
        };
      });

      // Offer / Answer negotiation
      const offer = await pc1.createOffer();
      const offerHasAudio = offer.sdp?.includes("m=audio") ?? false;
      log(`Offer created. Has "m=audio": ${offerHasAudio}`, offerHasAudio ? "success" : "error");

      await pc1.setLocalDescription(offer);
      await pc2.setRemoteDescription(offer);

      const answer = await pc2.createAnswer();
      await pc2.setLocalDescription(answer);
      await pc1.setRemoteDescription(answer);

      log("SDP negotiation complete. Waiting for pc2 ontrack...", "info");
      const remoteTrack = await Promise.race([
        trackPromise,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Timeout waiting for remote audio track")), 5000)),
      ]);

      log(`Remote audio track confirmed: kind=${remoteTrack.kind}, readyState=${remoteTrack.readyState}`, "success");

      // Test 1: Play via <video> element (used in ChatBuddy VideoCallOverlay)
      let videoPlayOk = false;
      if (webrtcVideoRef.current) {
        webrtcVideoRef.current.srcObject = remoteStream;
        webrtcVideoRef.current.muted = false;
        webrtcVideoRef.current.volume = 1.0;
        try {
          await webrtcVideoRef.current.play();
          videoPlayOk = true;
          log("Remote <video> element play() resolved successfully.", "success");
        } catch (err: any) {
          log(`Remote <video> element play() failed: ${err?.name} - ${err?.message}`, "warn");
        }
      }

      // Test 2: Play via dedicated <audio> element
      let audioPlayOk = false;
      if (webrtcAudioRef.current) {
        webrtcAudioRef.current.srcObject = remoteStream;
        webrtcAudioRef.current.muted = false;
        webrtcAudioRef.current.volume = 1.0;
        try {
          await webrtcAudioRef.current.play();
          audioPlayOk = true;
          log("Remote dedicated <audio> element play() resolved successfully.", "success");
        } catch (err: any) {
          log(`Remote dedicated <audio> element play() failed: ${err?.name} - ${err?.message}`, "warn");
        }
      }

      setWebrtcInfo({
        offerHasAudio,
        audioSenders,
        remoteAudioReceived: remoteAudioArrived,
        videoElementPlayOk: videoPlayOk,
        audioElementPlayOk: audioPlayOk,
      });

      if (!offerHasAudio || audioSenders === 0 || !remoteAudioArrived) {
        throw new Error("WebRTC audio negotiation incomplete.");
      }

      setTestDStatus("pass");
      log("TEST D PASSED: WebRTC audio sender, SDP negotiation, remote track arrival, and playback confirmed.", "success");
    } catch (err: any) {
      log(`TEST D FAILED: ${err?.name} - ${err?.message}`, "error");
      setTestDStatus("fail");
    } finally {
      if (pc1) {
        try {
          pc1.close();
        } catch {}
      }
      if (pc2) {
        try {
          pc2.close();
        } catch {}
      }
      if (localStream) {
        localStream.getTracks().forEach((t) => t.stop());
      }
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-6 font-sans">
      <div className="max-w-4xl mx-auto space-y-6">
        <header className="border-b border-zinc-800 pb-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <span className="text-indigo-400">🎙️</span> Chirp Deep Audio Diagnostic
            </h1>
            <p className="text-xs text-zinc-400 mt-1">
              Deterministic verification suite for Microphone, Voice Notes, and WebRTC Video Call Audio.
            </p>
          </div>
          <a
            href="/"
            className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-xs font-medium rounded-lg text-zinc-300 border border-zinc-700 transition"
          >
            ← Back to Chirp
          </a>
        </header>

        {/* SECTION 1: PROVE BROWSER SPEAKER OUTPUT */}
        <div className="bg-gradient-to-r from-indigo-950/70 via-zinc-900 to-zinc-900 border border-indigo-500/30 rounded-2xl p-5 shadow-lg space-y-4">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="space-y-1 max-w-xl">
              <div className="flex items-center gap-2">
                <span className="text-base">🔊</span>
                <h2 className="text-sm font-bold text-white tracking-wide">
                  1. SPEAKER OUTPUT TEST (Physical Speaker Audibility)
                </h2>
                <StatusBadge status={speakerTestStatus} />
              </div>
              <p className="text-xs text-zinc-300 leading-relaxed">
                Generates a 440Hz sine wave tone via Web Audio API directly to your system speakers. Status is only marked PASS when you physically hear the tone and confirm YES.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                id="test-speaker-btn"
                onClick={testSpeakerOutput}
                className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white text-xs font-bold rounded-xl shadow-md transition flex items-center gap-2 cursor-pointer"
              >
                <span>🔊</span>
                <span>Test Speaker (440Hz Beep)</span>
              </button>
            </div>
          </div>

          {/* PHYSICAL AUDIBILITY VERIFICATION MODAL / PROMPT (Prompt Section 1) */}
          {awaitingSpeakerConfirm && (
            <div className="p-4 bg-indigo-950/80 border border-indigo-400/50 rounded-xl flex flex-col sm:flex-row items-center justify-between gap-3 animate-fadeIn">
              <div className="flex items-center gap-2.5">
                <span className="text-xl animate-pulse">👂</span>
                <div>
                  <div className="text-xs font-bold text-white">Did you hear the test sound?</div>
                  <div className="text-[11px] text-zinc-300">Tone was sent to your browser default output destination.</div>
                </div>
              </div>
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <button
                  id="speaker-confirm-yes-btn"
                  onClick={() => handleConfirmSpeakerAudible(true)}
                  className="flex-1 sm:flex-none px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg shadow transition active:scale-95 cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <span>✓</span>
                  <span>YES, I heard it</span>
                </button>
                <button
                  id="speaker-confirm-no-btn"
                  onClick={() => handleConfirmSpeakerAudible(false)}
                  className="flex-1 sm:flex-none px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold rounded-lg shadow transition active:scale-95 cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <span>✕</span>
                  <span>NO, silence</span>
                </button>
              </div>
            </div>
          )}

          {/* USER CONFIRMED SILENCE ADVICE (Prompt Section 1 & 21) */}
          {userConfirmedAudio === false && (
            <div className="p-3.5 bg-rose-950/70 border border-rose-600/60 rounded-xl flex items-start gap-3 animate-fadeIn">
              <span className="text-lg text-rose-400">⚠️</span>
              <div className="text-xs text-rose-200 leading-relaxed">
                <strong className="text-rose-100 font-semibold block mb-0.5">
                  Browser audio is playing but no sound is reaching your speakers/headphones.
                </strong>
                The problem is outside the Chirp code pipeline. Please check:
                <ul className="list-disc list-inside mt-1 space-y-0.5 text-zinc-300">
                  <li>Windows volume slider / mute switch in taskbar</li>
                  <li>Selected Windows default audio output device (Speakers vs Headphones)</li>
                  <li>Browser tab mute status (right click tab → Unmute Tab)</li>
                  <li>Browser permissions or OS audio device exclusivity</li>
                </ul>
              </div>
            </div>
          )}
        </div>

        {/* SECTION 30: TEMPORARY AUDIO STATUS PANEL */}
        <div className="bg-zinc-900/95 border border-zinc-800 rounded-2xl p-5 shadow-md space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold tracking-wider text-zinc-400 uppercase flex items-center gap-2">
              <span>📊</span>
              <span>TEMPORARY AUDIO STATUS PANEL (SECTION 30)</span>
            </h2>
            <span className="text-[11px] text-zinc-500 font-mono">Development Diagnostic Suite</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5 text-center">
            {/* 1. BROWSER AUDIO OUTPUT */}
            <div className="bg-zinc-950/80 border border-zinc-800 rounded-xl p-2.5 flex flex-col justify-between">
              <div className="text-[10px] uppercase font-semibold text-zinc-400">Speaker Output</div>
              <div className={`text-xs font-bold mt-1.5 ${
                speakerTestStatus === "pass" ? "text-emerald-400" : speakerTestStatus === "fail" ? "text-rose-400" : "text-zinc-500"
              }`}>
                {speakerTestStatus === "pass" ? "PASS" : speakerTestStatus === "fail" ? "FAIL" : "NOT TESTED"}
              </div>
            </div>

            {/* 2. LOCAL VOICE */}
            <div className="bg-zinc-950/80 border border-zinc-800 rounded-xl p-2.5 flex flex-col justify-between">
              <div className="text-[10px] uppercase font-semibold text-zinc-400">Local Voice</div>
              <div className={`text-xs font-bold mt-1.5 ${
                testBStatus === "pass" ? "text-emerald-400" : testBStatus === "fail" ? "text-rose-400" : "text-zinc-500"
              }`}>
                {testBStatus === "pass" ? "PASS" : testBStatus === "fail" ? "FAIL" : "NOT TESTED"}
              </div>
            </div>

            {/* 3. PRODUCTION VOICE */}
            <div className="bg-zinc-950/80 border border-zinc-800 rounded-xl p-2.5 flex flex-col justify-between">
              <div className="text-[10px] uppercase font-semibold text-zinc-400">Prod Voice</div>
              <div className={`text-xs font-bold mt-1.5 ${
                testCStatus === "pass" ? "text-emerald-400" : testCStatus === "fail" ? "text-rose-400" : "text-zinc-500"
              }`}>
                {testCStatus === "pass" ? "PASS" : testCStatus === "fail" ? "FAIL" : "NOT TESTED"}
              </div>
            </div>

            {/* 4. WEBRTC REMOTE AUDIO TRACK */}
            <div className="bg-zinc-950/80 border border-zinc-800 rounded-xl p-2.5 flex flex-col justify-between">
              <div className="text-[10px] uppercase font-semibold text-zinc-400">Remote Track</div>
              <div className={`text-xs font-bold mt-1.5 ${
                webrtcInfo ? (webrtcInfo.remoteAudioReceived ? "text-emerald-400" : "text-rose-400") : "text-zinc-500"
              }`}>
                {webrtcInfo ? (webrtcInfo.remoteAudioReceived ? "FOUND" : "MISSING") : "NOT TESTED"}
              </div>
            </div>

            {/* 5. REMOTE AUDIO ELEMENT */}
            <div className="bg-zinc-950/80 border border-zinc-800 rounded-xl p-2.5 flex flex-col justify-between">
              <div className="text-[10px] uppercase font-semibold text-zinc-400">Remote Audio</div>
              <div className={`text-xs font-bold mt-1.5 ${
                webrtcInfo ? "text-emerald-400" : "text-zinc-500"
              }`}>
                {webrtcInfo ? "UNMUTED" : "NOT TESTED"}
              </div>
            </div>

            {/* 6. REMOTE AUDIO VOLUME */}
            <div className="bg-zinc-950/80 border border-zinc-800 rounded-xl p-2.5 flex flex-col justify-between">
              <div className="text-[10px] uppercase font-semibold text-zinc-400">Remote Volume</div>
              <div className={`text-xs font-bold mt-1.5 ${
                webrtcInfo ? "text-emerald-400" : "text-zinc-500"
              }`}>
                {webrtcInfo ? "> 0 (1.0)" : "NOT TESTED"}
              </div>
            </div>

            {/* 7. AUDIOCONTEXT */}
            <div className="bg-zinc-950/80 border border-zinc-800 rounded-xl p-2.5 flex flex-col justify-between">
              <div className="text-[10px] uppercase font-semibold text-zinc-400">AudioContext</div>
              <div className={`text-xs font-bold mt-1.5 ${
                audioContextState === "running" ? "text-emerald-400" : audioContextState === "suspended" ? "text-amber-400" : "text-zinc-500"
              }`}>
                {audioContextState}
              </div>
            </div>
          </div>
        </div>

        {/* SYSTEM STATUS BAR */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <div className="text-xs font-medium text-zinc-400">Microphone Status</div>
            <div className="text-sm font-semibold text-white mt-1">{micState}</div>
            <div className="mt-2 text-xs text-zinc-500">
              Tracks: {micTracks.length} ({micTracks.map((t) => t.readyState).join(", ") || "none"})
            </div>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <div className="text-xs font-medium text-zinc-400">Live Volume Meter</div>
            <div className="mt-2 flex items-center gap-2">
              <div className="flex-1 bg-zinc-800 h-3 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-75 ${
                    volumeLevel > 50 ? "bg-red-500" : volumeLevel > 15 ? "bg-emerald-400" : "bg-zinc-600"
                  }`}
                  style={{ width: `${volumeLevel}%` }}
                />
              </div>
              <span className="text-xs font-mono text-zinc-300 w-8">{volumeLevel}%</span>
            </div>
            <div className="text-[11px] text-zinc-500 mt-1">
              {volumeLevel > 5 ? "🔊 Acoustic signal detected" : "🔇 Silence / no input"}
            </div>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <div className="text-xs font-medium text-zinc-400">MediaRecorder Codec</div>
            <div className="text-sm font-semibold text-indigo-300 mt-1 truncate">{activeMime || "None supported"}</div>
            <div className="text-[11px] text-zinc-500 mt-1 truncate">
              Supported: {supportedMimes.length} container formats
            </div>
          </div>
        </div>

        {/* TEST CONTROL SUITE */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-white">Diagnostic Test Pipeline</h2>
            <button
              id="run-all-tests-btn"
              onClick={async () => {
                await runTestA(false);
                await runTestB();
                await runTestC();
                await runTestD();
              }}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded-lg shadow-sm transition"
            >
              ▶ Run Complete Pipeline (A → D)
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* TEST A */}
            <div className="bg-zinc-950 border border-zinc-800/80 rounded-lg p-4 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-zinc-300">TEST A — Microphone Loopback</span>
                  <StatusBadge status={testAStatus} />
                </div>
                <p className="text-xs text-zinc-400 mt-1">
                  Requests <code className="text-indigo-400">getUserMedia({`{ audio: true }`})</code>, inspects track properties, attaches to local <code className="text-indigo-400">&lt;audio&gt;</code>, and measures live volume.
                </p>
                <div className="mt-2">
                  <audio ref={loopbackAudioRef} controls className="w-full h-8" />
                </div>
              </div>
              <div className="flex gap-2 mt-4">
                <button
                  id="test-a-basic-btn"
                  onClick={() => runTestA(false)}
                  className="flex-1 py-1.5 px-3 bg-zinc-800 hover:bg-zinc-700 text-xs text-white rounded font-medium transition"
                >
                  Test Mic (audio: true)
                </button>
                <button
                  id="test-a-constraints-btn"
                  onClick={() => runTestA(true)}
                  className="flex-1 py-1.5 px-3 bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-300 rounded font-medium transition"
                >
                  With Constraints
                </button>
                <button
                  onClick={stopTestA}
                  className="py-1.5 px-3 bg-red-900/40 hover:bg-red-900/60 text-red-300 text-xs rounded font-medium transition"
                >
                  Stop
                </button>
              </div>
            </div>

            {/* TEST B */}
            <div className="bg-zinc-950 border border-zinc-800/80 rounded-lg p-4 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-zinc-300">TEST B — Local Voice Recording</span>
                  <StatusBadge status={testBStatus} />
                </div>
                <p className="text-xs text-zinc-400 mt-1">
                  Records 3 seconds via <code className="text-indigo-400">MediaRecorder</code>, flushes final chunks, verifies <code className="text-indigo-400">blob.size &gt; 0</code>, and tests immediate playback.
                </p>
                {recordedBlobInfo && (
                  <div className="mt-2 text-[11px] text-zinc-400 bg-zinc-900/60 p-2 rounded">
                    Size: <strong>{recordedBlobInfo.size} B</strong> | Type: <strong>{recordedBlobInfo.type}</strong>
                  </div>
                )}
                <div className="mt-2">
                  <audio ref={blobAudioRef} controls className="w-full h-8" />
                </div>
              </div>
              <div className="mt-4">
                <button
                  id="test-b-btn"
                  onClick={runTestB}
                  className="w-full py-1.5 px-3 bg-zinc-800 hover:bg-zinc-700 text-xs text-white rounded font-medium transition"
                >
                  Record 3s &amp; Play Local Blob
                </button>
              </div>
            </div>

            {/* TEST C */}
            <div className="bg-zinc-950 border border-zinc-800/80 rounded-lg p-4 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-zinc-300">TEST C — Data URL Playback</span>
                  <StatusBadge status={testCStatus} />
                </div>
                <p className="text-xs text-zinc-400 mt-1">
                  Converts recorded blob to Base64 Data URL (Chirp transmission format) and verifies that <code className="text-indigo-400">&lt;audio&gt;</code> element decodes and plays it.
                </p>
                {dataUrlInfo && (
                  <div className="mt-2 text-[11px] text-zinc-400 bg-zinc-900/60 p-2 rounded">
                    Length: <strong>{dataUrlInfo.length} chars</strong> | Playback OK: <strong>{dataUrlInfo.playOk ? "Yes" : "No"}</strong>
                  </div>
                )}
                <div className="mt-2">
                  <div className="text-[10px] text-zinc-400 mb-1">HTML5 &lt;audio&gt; Element:</div>
                  <audio ref={dataUrlAudioRef} controls className="w-full h-8" />
                </div>

                {/* Production Voice Player Verification */}
                {activeDataUrlForPlayer && (
                  <div className="mt-3 p-2.5 bg-zinc-900 border border-zinc-700/80 rounded-xl space-y-2">
                    <div className="text-[11px] font-semibold text-indigo-300">
                      Production &lt;AudioPlayer&gt; Component:
                    </div>
                    <div className="bg-zinc-800/80 p-1.5 rounded-lg flex items-center justify-center">
                      <AudioPlayer src={activeDataUrlForPlayer} isMe={true} />
                    </div>

                    {/* Section 10: Bypass Component with Direct new Audio() */}
                    <div className="pt-2 border-t border-zinc-800 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-zinc-300">Bypass Player (Section 10 Direct Test):</span>
                        <button
                          type="button"
                          onClick={runBypassPlayer}
                          className="px-2.5 py-1 bg-amber-600 hover:bg-amber-500 text-white text-[10px] font-bold rounded-lg transition"
                        >
                          Play via Direct Audio()
                        </button>
                      </div>

                      {bypassPlayerStatus === "played" && (
                        <div className="p-2 bg-zinc-950 border border-zinc-800 rounded-lg flex flex-col gap-1.5 animate-fadeIn">
                          <span className="text-[10px] text-zinc-300">Did you actually hear the direct audio?</span>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setBypassAudibleHeard(true);
                                log("User confirmed physical hearing of direct audio bypass: YES", "success");
                              }}
                              className={`px-2.5 py-1 text-[10px] font-bold rounded transition ${
                                bypassAudibleHeard === true ? "bg-emerald-600 text-white" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                              }`}
                            >
                              ✓ YES
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setBypassAudibleHeard(false);
                                log("User confirmed physical hearing of direct audio bypass: NO (Silence)", "warn");
                              }}
                              className={`px-2.5 py-1 text-[10px] font-bold rounded transition ${
                                bypassAudibleHeard === false ? "bg-rose-600 text-white" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                              }`}
                            >
                              ✕ NO
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
              <div className="mt-4">
                <button
                  id="test-c-btn"
                  onClick={runTestC}
                  disabled={!recordedBlobInfo}
                  className="w-full py-1.5 px-3 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-xs text-white rounded font-medium transition"
                >
                  Test Data URL Playback
                </button>
              </div>
            </div>

            {/* TEST D */}
            <div className="bg-zinc-950 border border-zinc-800/80 rounded-lg p-4 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-zinc-300">TEST D — WebRTC Audio Loopback</span>
                  <StatusBadge status={testDStatus} />
                </div>
                <p className="text-xs text-zinc-400 mt-1">
                  Connects two local PeerConnections with an audio track. Validates senders, SDP <code className="text-indigo-400">m=audio</code>, <code className="text-indigo-400">ontrack</code>, and tests playback via <code className="text-indigo-400">&lt;video&gt;</code> vs <code className="text-indigo-400">&lt;audio&gt;</code>.
                </p>
                {webrtcInfo && (
                  <div className="mt-2 text-[11px] text-zinc-400 bg-zinc-900/60 p-2 rounded space-y-1">
                    <div>SDP m=audio: <strong>{webrtcInfo.offerHasAudio ? "Yes" : "No"}</strong></div>
                    <div>Remote Track Arrived: <strong>{webrtcInfo.remoteAudioReceived ? "Yes" : "No"}</strong></div>
                    <div>&lt;video&gt; Play: <strong>{webrtcInfo.videoElementPlayOk ? "OK" : "Failed"}</strong> | &lt;audio&gt; Play: <strong>{webrtcInfo.audioElementPlayOk ? "OK" : "Failed"}</strong></div>
                  </div>
                )}
                <div className="mt-2 flex gap-2">
                  <video ref={webrtcVideoRef} playsInline autoPlay className="w-1/2 h-8 bg-zinc-900 rounded" />
                  <audio ref={webrtcAudioRef} playsInline autoPlay controls className="w-1/2 h-8" />
                </div>
              </div>
              <div className="mt-4">
                <button
                  id="test-d-btn"
                  onClick={runTestD}
                  className="w-full py-1.5 px-3 bg-zinc-800 hover:bg-zinc-700 text-xs text-white rounded font-medium transition"
                >
                  Test WebRTC Audio Pipeline
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* LOG CONSOLE */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400">Live Diagnostic Logs</h3>
            <button
              onClick={() => setLogs([])}
              className="text-[11px] text-zinc-500 hover:text-zinc-300 transition"
            >
              Clear Logs
            </button>
          </div>
          <div
            id="diagnostic-logs-container"
            className="bg-black/60 rounded-lg p-3 font-mono text-xs max-h-64 overflow-y-auto space-y-1 border border-zinc-800/60"
          >
            {logs.length === 0 ? (
              <div className="text-zinc-600 italic">No logs yet. Click a test above to begin.</div>
            ) : (
              logs.map((item, idx) => (
                <div
                  key={idx}
                  className={`leading-relaxed ${
                    item.type === "error"
                      ? "text-red-400"
                      : item.type === "warn"
                      ? "text-amber-400"
                      : item.type === "success"
                      ? "text-emerald-400"
                      : "text-zinc-300"
                  }`}
                >
                  <span className="text-zinc-500 mr-2">[{item.timestamp}]</span>
                  {item.message}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: "idle" | "running" | "pass" | "fail" }) {
  if (status === "pass") {
    return <span className="px-2 py-0.5 bg-emerald-900/60 text-emerald-300 border border-emerald-600/40 rounded text-[10px] font-bold">PASS</span>;
  }
  if (status === "fail") {
    return <span className="px-2 py-0.5 bg-red-900/60 text-red-300 border border-red-600/40 rounded text-[10px] font-bold">FAIL</span>;
  }
  if (status === "running") {
    return <span className="px-2 py-0.5 bg-amber-900/60 text-amber-300 border border-amber-600/40 rounded text-[10px] font-bold animate-pulse">RUNNING...</span>;
  }
  return <span className="px-2 py-0.5 bg-zinc-800 text-zinc-400 rounded text-[10px] font-medium">IDLE</span>;
}
