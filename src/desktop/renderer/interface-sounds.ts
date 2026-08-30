import { play, setEnabled, setVolume, type SoundName } from "cuelume";

export type InterfaceSound = "permission" | "complete" | "failure";
export type SoundRunEvent = "permission.requested" | "run.completed" | "run.failed";

const sounds: Record<InterfaceSound, SoundName> = {
  permission: "chime",
  complete: "ready",
  failure: "error",
};

export function setInterfaceSoundsEnabled(enabled: boolean): void {
  setVolume(0.55);
  setEnabled(enabled);
}

export function playInterfaceSound(sound: InterfaceSound): void {
  play(sounds[sound]);
}

export function soundForRunEvent(event: SoundRunEvent, options: {
  background: boolean;
  queued: boolean;
  userStopped: boolean;
}): InterfaceSound | undefined {
  if (event === "permission.requested") return "permission";
  if (options.queued) return undefined;
  if (event === "run.completed") return options.background ? "complete" : undefined;
  return options.userStopped ? undefined : "failure";
}
