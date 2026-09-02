import { useEffect, useRef, useState } from "react";

const BAR_COUNT = 7;

export function Dictation({
  disabled,
  platform,
  stopAfterSilence,
  soundsEnabled,
  onPrepare,
  onError,
  onStart,
  onAudio,
  onStop,
}: {
  disabled: boolean;
  platform: string;
  stopAfterSilence: boolean;
  soundsEnabled: boolean;
  onPrepare: () => void;
  onError: (message: string) => void;
  onStart: () => Promise<void>;
  onAudio: (samples: Float32Array, sampleRate: number) => void;
  onStop: () => Promise<void>;
}): JSX.Element {
  const [status, setStatus] = useState<"idle" | "starting" | "recording" | "stopping" | "error">("idle");
  const [silenceCountdown, setSilenceCountdown] = useState<number | null>(null);
  const bars = useRef<Array<HTMLSpanElement | null>>([]);
  const stream = useRef<MediaStream>();
  const audioContext = useRef<AudioContext>();
  const animationFrame = useRef<number>();
  const mounted = useRef(true);
  const recording = useRef(false);
  const recognitionStarted = useRef(false);

  function release(keepContext = false): AudioContext | undefined {
    if (animationFrame.current !== undefined) cancelAnimationFrame(animationFrame.current);
    animationFrame.current = undefined;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = undefined;
    const context = audioContext.current;
    if (!keepContext) void context?.close();
    audioContext.current = undefined;
    bars.current.forEach((bar) => {
      bar?.style.removeProperty("--voice-cell-1");
      bar?.style.removeProperty("--voice-cell-2");
      bar?.style.removeProperty("--voice-cell-3");
      bar?.style.removeProperty("--voice-cell-4");
      bar?.style.removeProperty("--voice-cell-5");
    });
    recording.current = false;
    return context;
  }

  async function start(): Promise<void> {
    onPrepare();
    setSilenceCountdown(null);
    setStatus("starting");
    let microphone: MediaStream;
    try {
      microphone = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (cause) {
      if (mounted.current) {
        setStatus("error");
        onError(microphoneErrorMessage(cause));
      }
      return;
    }

    try {
      if (!mounted.current) {
        microphone.getTracks().forEach((track) => track.stop());
        return;
      }
      await onStart();
      recognitionStarted.current = true;
      if (!mounted.current) {
        microphone.getTracks().forEach((track) => track.stop());
        recognitionStarted.current = false;
        await onStop();
        return;
      }
      const context = new AudioContext();
      stream.current = microphone;
      audioContext.current = context;
      await context.resume();
      if (!mounted.current) return;
      if (soundsEnabled) await playCue(context, "start").catch(() => undefined);
      if (!mounted.current) return;
      const analyser = context.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.72;
      const source = context.createMediaStreamSource(microphone);
      source.connect(analyser);
      const processor = context.createScriptProcessor(2048, 1, 1);
      processor.onaudioprocess = (event) => {
        if (recording.current) {
          onAudio(new Float32Array(event.inputBuffer.getChannelData(0)), context.sampleRate);
        }
      };
      source.connect(processor);
      processor.connect(context.destination);
      const frequencies = new Uint8Array(analyser.frequencyBinCount);
      const waveform = new Float32Array(analyser.fftSize);
      let noiseFloor = 0.008;
      let voiceCandidateAt: number | undefined;
      let voiceStarted = false;
      let lastVoiceAt = 0;
      setStatus("recording");
      recording.current = true;

      const draw = (): void => {
        analyser.getByteFrequencyData(frequencies);
        analyser.getFloatTimeDomainData(waveform);
        const rms = Math.sqrt(waveform.reduce((sum, sample) => sum + sample * sample, 0) / waveform.length);
        const now = performance.now();
        const speaking = rms > Math.max(0.012, noiseFloor * 2.5);
        if (speaking) {
          voiceCandidateAt ??= now;
          if (now - voiceCandidateAt >= 120) {
            voiceStarted = true;
            lastVoiceAt = now;
          }
        } else {
          voiceCandidateAt = undefined;
          noiseFloor = noiseFloor * 0.98 + rms * 0.02;
        }
        bars.current.forEach((bar, index) => {
          if (!bar) return;
          const bin = 2 + Math.floor(index * 2.4);
          const level = Math.max(0.1, frequencies[bin]! / 255);
          bar.style.setProperty("--voice-cell-1", Math.max(0.18, Math.min(1, level * 2.5)).toFixed(2));
          bar.style.setProperty("--voice-cell-2", Math.max(0.14, Math.min(1, (level - 0.16) * 3)).toFixed(2));
          bar.style.setProperty("--voice-cell-3", Math.max(0.12, Math.min(1, (level - 0.34) * 3.5)).toFixed(2));
          bar.style.setProperty("--voice-cell-4", Math.max(0.1, Math.min(1, (level - 0.52) * 4)).toFixed(2));
          bar.style.setProperty("--voice-cell-5", Math.max(0.08, Math.min(1, (level - 0.7) * 5)).toFixed(2));
        });
        if (stopAfterSilence && voiceStarted) {
          const silentFor = now - lastVoiceAt;
          if (silentFor >= 8_000) {
            void finish();
            return;
          }
          const countdown = silentFor >= 5_000 ? Math.ceil((8_000 - silentFor) / 1_000) : null;
          setSilenceCountdown((current) => current === countdown ? current : countdown);
        } else if (silenceCountdown !== null) {
          setSilenceCountdown(null);
        }
        animationFrame.current = requestAnimationFrame(draw);
      };
      draw();
    } catch {
      release();
      if (recognitionStarted.current) {
        recognitionStarted.current = false;
        void onStop();
      }
      if (mounted.current) setStatus("error");
    }
  }

  async function finish(): Promise<void> {
    setSilenceCountdown(null);
    setStatus("stopping");
    const context = release(soundsEnabled);
    try {
      await Promise.all([
        onStop(),
        context && soundsEnabled
          ? playCue(context, "stop").catch(() => undefined).finally(() => void context.close())
          : undefined,
      ]);
      recognitionStarted.current = false;
      if (mounted.current) setStatus("idle");
    } catch {
      recognitionStarted.current = false;
      if (mounted.current) setStatus("error");
    }
  }

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const wasRecognizing = recognitionStarted.current;
      release();
      recognitionStarted.current = false;
      if (wasRecognizing) void onStop();
    };
  }, []);

  const isRecording = status === "recording";
  const shortcut = platform === "darwin" ? "⌘⇧M" : "Ctrl⇧M";
  const label = status === "starting"
    ? "Starting voice input"
    : status === "stopping" ? "Finishing transcription"
    : isRecording ? `Stop voice input (${shortcut})`
    : status === "error" ? "Microphone unavailable — click to retry"
    : `Start voice input (${shortcut})`;

  useEffect(() => {
    function toggle(event: KeyboardEvent): void {
      const primary = platform === "darwin" ? event.metaKey : event.ctrlKey;
      if (!primary || !event.shiftKey || event.altKey || event.key.toLowerCase() !== "m" || event.repeat) return;
      if (disabled || status === "starting" || status === "stopping") return;
      event.preventDefault();
      event.stopPropagation();
      if (status === "recording") void finish();
      else void start();
    }

    window.addEventListener("keydown", toggle, { capture: true });
    return () => window.removeEventListener("keydown", toggle, { capture: true });
  }, [disabled, platform, status]);

  return (
    <button
      className={`dictation-button ${status}`}
      data-shortcut-layout={platform === "darwin" ? "compact" : "wide"}
      type="button"
      disabled={disabled || status === "starting" || status === "stopping"}
      aria-label={label}
      aria-pressed={isRecording}
      title={label}
      onClick={isRecording ? () => void finish() : () => void start()}
    >
      <span className="dictation-mic" aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" />
          <path d="M5 11v1a7 7 0 0 0 14 0v-1M12 19v2" />
        </svg>
      </span>
      <span className="dictation-loading" aria-hidden="true">
        {status === "stopping" ? "Finishing" : "Starting"}<span className="dictation-loading-dots">...</span>
      </span>
      <span className="dictation-wave" aria-hidden="true">
        {Array.from({ length: BAR_COUNT }, (_, index) => (
          <span key={index} ref={(element) => { bars.current[index] = element; }}>
            <span />
            <span />
            <span />
            <span />
            <span />
          </span>
        ))}
      </span>
      <span className="dictation-shortcut" aria-hidden="true">
        <span key={silenceCountdown ?? "shortcut"}>
          {silenceCountdown ?? (
            <>
              {platform === "darwin"
                ? <span className="dictation-shortcut-glyph">⌘</span>
                : <span>Ctrl</span>}
              <span className="dictation-shortcut-glyph">⇧</span>
              <span>M</span>
            </>
          )}
        </span>
      </span>
    </button>
  );
}

function microphoneErrorMessage(cause: unknown): string {
  const name = cause instanceof DOMException ? cause.name : "";
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "No microphone was found. Connect or enable an input device, then try again.";
  }
  if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") {
    return "Microphone access was denied. Allow Snaffle to use the microphone in system settings, then try again.";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "The microphone could not be opened. It may be in use by another application.";
  }
  return "Voice input could not access the microphone. Check the input device and try again.";
}

function playCue(context: AudioContext, cue: "start" | "stop"): Promise<void> {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const now = context.currentTime;
  const duration = 0.11;
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(cue === "start" ? 480 : 680, now);
  oscillator.frequency.linearRampToValueAtTime(cue === "start" ? 680 : 460, now + duration);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.025, now + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(now);
  oscillator.stop(now + duration);
  return new Promise((resolve) => { oscillator.onended = () => resolve(); });
}
