import { DEFAULT_SETTINGS } from "./config.js";

const STORAGE_KEY = "undercover-xiangqi-settings";
let audioContext = null;
let settings = { ...DEFAULT_SETTINGS };

function normalizeSettings(value = {}) {
  return {
    sound: value.sound ?? DEFAULT_SETTINGS.sound,
    vibration: value.vibration ?? DEFAULT_SETTINGS.vibration
  };
}

export function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    settings = normalizeSettings(saved ?? {});
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    settings = { ...DEFAULT_SETTINGS };
  }
  return { ...settings };
}

export function saveSettings(nextSettings) {
  settings = normalizeSettings({ ...settings, ...nextSettings });
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Local storage can be unavailable in strict browser modes.
  }
  return { ...settings };
}

function getAudioContext() {
  if (!audioContext) {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) {
      return null;
    }
    audioContext = new Context();
  }
  return audioContext;
}

export function playSound(type, overrideSettings = settings) {
  if (!overrideSettings.sound) {
    return;
  }

  const context = getAudioContext();
  if (!context) {
    return;
  }

  if (context.state === "suspended") {
    context.resume();
  }

  const profiles = {
    select: [360, 0.04, 0.025],
    move: [220, 0.06, 0.035],
    capture: [150, 0.1, 0.055],
    cannon: [120, 0.12, 0.06],
    reveal: [420, 0.13, 0.045],
    threat: [90, 0.18, 0.05],
    check: [260, 0.1, 0.05],
    illegal: [110, 0.06, 0.025],
    win: [300, 0.24, 0.06]
  };

  const [frequency, duration, gainValue] = profiles[type] ?? profiles.move;
  const oscillator = context.createOscillator();
  const gain = context.createGain();

  oscillator.type = type === "threat" ? "triangle" : "sine";
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(gainValue, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);

  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + duration);
}

export function vibrate(type, overrideSettings = settings) {
  if (!overrideSettings.vibration || !("vibrate" in navigator)) {
    return;
  }

  const patterns = {
    move: 12,
    reveal: [16, 28, 16],
    capture: 28,
    threat: [18, 35, 18],
    illegal: 8,
    win: [30, 40, 30]
  };

  navigator.vibrate(patterns[type] ?? 10);
}
