export const SPEECH_MODELS = [
  {
    id: "parakeet-tdt-0.6b-v3",
    name: "Parakeet TDT 0.6B",
    detail: "Fast · about 500 MB · 25 European languages",
    mode: "buffered",
  },
  {
    id: "nemotron-3.5-asr-streaming-0.6b",
    name: "Nemotron Streaming 0.6B",
    detail: "Balanced · about 650 MB · English",
    mode: "streaming",
  },
  {
    id: "qwen3-asr-1.7b",
    name: "Qwen3-ASR 1.7B",
    detail: "Highest quality · about 4.7 GB · 52 languages and dialects",
    mode: "streaming",
  },
] as const;

export type SpeechModel = (typeof SPEECH_MODELS)[number]["id"];
export type SpeechModelPhase = "missing" | "downloading" | "installing" | "ready" | "unavailable" | "error";

export type SpeechModelStatus = {
  id: SpeechModel;
  phase: SpeechModelPhase;
  progress: number;
  detail: string;
};

export type SpeechTranscriptEvent = {
  text: string;
  final: boolean;
  error?: string;
};

export type SpeechSettings = {
  enabled: boolean;
  localModel: SpeechModel;
  language: string;
  autoStopOnSilence: boolean;
  keepModelLoaded: boolean;
};

export const DEFAULT_SPEECH_SETTINGS: SpeechSettings = {
  enabled: false,
  localModel: "nemotron-3.5-asr-streaming-0.6b",
  language: "auto",
  autoStopOnSilence: true,
  keepModelLoaded: false,
};

export function parseSpeechSettings(value: unknown): SpeechSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return DEFAULT_SPEECH_SETTINGS;
  }
  const input = value as Record<string, unknown>;
  const model = SPEECH_MODELS.find((item) => item.id === input.localModel)?.id;
  return {
    enabled: input.enabled === true,
    localModel: model ?? DEFAULT_SPEECH_SETTINGS.localModel,
    language: typeof input.language === "string" && input.language.trim()
      ? input.language.trim()
      : "auto",
    autoStopOnSilence: input.autoStopOnSilence !== false,
    keepModelLoaded: input.keepModelLoaded === true,
  };
}
