import type { Project, Style } from './types.js';

export const DEFAULT_STYLE: Style = {
  preset: 'fade-rise',
  background: {
    kind: 'mesh',
    palette: ['#0b1d3a', '#1b3b6f', '#0e4d64'],
    speed: 0.15,
    pulseOnBeat: true,
  },
  font: {
    family: 'Inter',
    weight: 600,
    size: 64,
    letterSpacing: 0,
    lineHeight: 1.2,
    uppercase: false,
  },
  colors: { text: '#ffffff', accent: '#ffd166', shadow: true, overlay: 0.35 },
  grain: 0.07,
  layout: { align: 'center', x: 0.5, y: 0.78, maxWidthPct: 0.82, maxLines: 3 },
  timing: { inDur: 0.45, outDur: 0.3, stagger: 0.08 },
  transition: 'crossfade',
  motion: { cameraZoom: 0.04, breathe: 0.012, drift: 4, blur: 4, exitLift: 1 },
  kinetic: {
    emphasisScale: 0.85,
    swatchCount: 1,
    swatchColor: '',
    rotate: 4,
    baselineJitter: 14,
    smear: 3,
    smearDistance: 26,
    stretch: 0.55,
    wordsPerBurst: 3,
  },
};

export function defaultProject(id: string, title: string, artist: string): Project {
  return {
    version: 1,
    id,
    title,
    artist,
    audio: { file: null, duration: 0, source: 'none' },
    bpm: { value: 0, offset: 0, beats: null, source: 'none' },
    lines: [],
    style: structuredClone(DEFAULT_STYLE),
    export: { width: 1280, height: 720, fps: 30 },
  };
}
