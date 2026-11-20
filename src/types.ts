export type Project = {
  version: 1;
  id: string; // slug
  title: string;
  artist: string;
  audio: { file: string | null; duration: number; source: 'upload' | 'youtube' | 'none'; sourceUrl?: string };
  bpm: { value: number; offset: number; beats: number[] | null; source: 'browser' | 'manual' | 'none' };
  lines: LyricLine[];
  style: Style;
  export: { width: 1280 | 1920; height: 720 | 1080; fps: 30 };
};

export type LyricLine = {
  id: string;
  text: string;
  start: number;
  end: number;
  words?: { text: string; start: number; end: number }[];
  section?: 'intro' | 'verse' | 'chorus' | 'bridge' | 'outro' | 'other';
};

export type BackgroundSpec =
  | { kind: 'solid'; color: string }
  | { kind: 'gradient'; from: string; to: string; angle: number; animate: boolean }
  | { kind: 'image'; file: string; blur: number; zoom: number }
  | { kind: 'mesh'; palette: [string, string, string]; speed: number; pulseOnBeat: boolean };

export type Preset =
  | 'fade-rise'
  | 'karaoke'
  | 'typewriter'
  | 'pop-word'
  | 'slide-left'
  | 'glow-beat'
  | 'mask-reveal'
  | 'cinematic'
  | 'kinetic';

/** Continuous motion applied on top of the preset: entrance, hold and exit. */
export type Motion = {
  /** Slow push-in across a line, 0–0.2. */
  cameraZoom: number;
  /** Beat-synced scale breathing while the line holds, 0–0.08. */
  breathe: number;
  /** Upward drift in px per second while the line holds. */
  drift: number;
  /** Blur in px used on entrance and exit. */
  blur: number;
  /** Multiplier for exit travel; 0 keeps the text still while it fades. */
  exitLift: number;
};

/**
 * Kinetic-typography knobs (the "professional" look): mixed word sizes, rotation,
 * smear trails on entrance and a brush swatch behind key words.
 */
export type Kinetic = {
  /** Extra scale for emphasised words, e.g. 0.9 = 190% of the base size. */
  emphasisScale: number;
  /** How many words per line get a swatch, starting with the longest. */
  swatchCount: number;
  /** Swatch colour; empty string reuses colors.accent. */
  swatchColor: string;
  /** Maximum rotation in degrees applied per word. */
  rotate: number;
  /** Vertical offset in px between adjacent words. */
  baselineJitter: number;
  /** Number of ghost copies drawn behind each word while it enters. */
  smear: number;
  /** Horizontal spread of the smear trails, in px. */
  smearDistance: number;
  /** Vertical squash at the start of a word's entrance, 0–1. */
  stretch: number;
  /** Words shown together per burst; 2–4 gives the reference look. */
  wordsPerBurst: number;
};

export type Style = {
  preset: Preset;
  background: BackgroundSpec;
  font: {
    family: 'Inter' | 'Montserrat' | 'Playfair Display' | 'Bebas Neue';
    weight: number;
    size: number;
    letterSpacing: number;
    lineHeight: number;
    uppercase: boolean;
  };
  colors: { text: string; accent: string; shadow: boolean; overlay: number };
  /** Film-grain strength over the whole frame, 0–0.4. */
  grain?: number;
  layout: { align: 'center' | 'left'; x: number; y: number; maxWidthPct: number; maxLines: number };
  timing: { inDur: number; outDur: number; stagger: number };
  transition: 'cut' | 'crossfade';
  /** Optional so projects saved before motion existed keep working. */
  motion?: Partial<Motion>;
  kinetic?: Partial<Kinetic>;
};

export type SongSummary = {
  id: string;
  title: string;
  artist: string;
  duration: number;
  updatedAt: string;
};

export type StoredProject = Project & { updatedAt?: string };
