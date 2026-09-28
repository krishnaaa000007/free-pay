import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';

/**
 * Audio cues for the vendor counter.
 *
 * A mela stall is loud and the vendor is rarely looking at the screen while handing over
 * chai — the sound is the confirmation, the screen is the detail. Two short cues only:
 * a rising chime when a payment is accepted, a low double note when one is refused.
 *
 * Players are created lazily and reused; every call is best-effort and never throws, so a
 * device with audio disabled (or the web preview before a user gesture) degrades silently.
 */
export type Cue = 'accepted' | 'rejected';

const SOURCES: Record<Cue, number> = {
  accepted: require('../../assets/sounds/accepted.wav'),
  rejected: require('../../assets/sounds/rejected.wav'),
};

const players: Partial<Record<Cue, AudioPlayer>> = {};
let audioModeReady = false;
let enabled = true;

/** Mute/unmute every cue (Profile toggle, or for a silent demo). */
export function setSoundEnabled(on: boolean) {
  enabled = on;
}
export function isSoundEnabled() {
  return enabled;
}

export function play(cue: Cue) {
  if (!enabled) return;
  try {
    if (!audioModeReady) {
      audioModeReady = true;
      // Cues should be audible even when the phone is on silent, and must never
      // interrupt music or a call the vendor has going.
      void setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'mixWithOthers' }).catch(() => undefined);
    }
    let player = players[cue];
    if (!player) {
      player = createAudioPlayer(SOURCES[cue]);
      players[cue] = player;
    }
    player.seekTo(0);
    player.play();
  } catch {
    /* audio unavailable on this device/browser; the visual confirmation still stands */
  }
}

export const playAccepted = () => play('accepted');
export const playRejected = () => play('rejected');
