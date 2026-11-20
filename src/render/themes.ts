import type { Style } from '../types.js';
import { DEFAULT_STYLE } from '../project.js';

export type ThemeName = 'Tenang' | 'Hangat' | 'Modern' | 'Klasik';

export type Theme = { name: ThemeName; description: string; style: Style };

const base = structuredClone(DEFAULT_STYLE);

export const THEMES: Theme[] = [
  {
    name: 'Tenang',
    description: 'Mesh biru malam, Inter tebal, fade-rise',
    style: {
      ...structuredClone(base),
      preset: 'fade-rise',
      background: { kind: 'mesh', palette: ['#081a2b', '#123a5c', '#0d4f5c'], speed: 0.12, pulseOnBeat: true },
      font: { family: 'Inter', weight: 600, size: 64, letterSpacing: 0, lineHeight: 1.2, uppercase: false },
      colors: { text: '#f5f7fa', accent: '#7fd1e8', shadow: true, overlay: 0.32 },
      layout: { align: 'center', x: 0.5, y: 0.78, maxWidthPct: 0.82, maxLines: 3 },
      timing: { inDur: 0.5, outDur: 0.35, stagger: 0.08 },
      transition: 'crossfade',
    },
  },
  {
    name: 'Hangat',
    description: 'Gradien jingga, karaoke kata per kata',
    style: {
      ...structuredClone(base),
      preset: 'karaoke',
      background: { kind: 'gradient', from: '#2a0d05', to: '#7a2d10', angle: 135, animate: true },
      font: { family: 'Montserrat', weight: 700, size: 62, letterSpacing: 0, lineHeight: 1.25, uppercase: false },
      colors: { text: '#fff4e6', accent: '#ffb703', shadow: true, overlay: 0.2 },
      layout: { align: 'center', x: 0.5, y: 0.8, maxWidthPct: 0.84, maxLines: 3 },
      timing: { inDur: 0.35, outDur: 0.25, stagger: 0.06 },
      transition: 'crossfade',
    },
  },
  {
    name: 'Modern',
    description: 'Solid gelap, pop-word tebal, Bebas Neue',
    style: {
      ...structuredClone(base),
      preset: 'pop-word',
      background: { kind: 'solid', color: '#0b0f17' },
      font: { family: 'Bebas Neue', weight: 400, size: 86, letterSpacing: 2, lineHeight: 1.1, uppercase: true },
      colors: { text: '#ffffff', accent: '#4ade80', shadow: false, overlay: 0.15 },
      layout: { align: 'center', x: 0.5, y: 0.76, maxWidthPct: 0.86, maxLines: 2 },
      timing: { inDur: 0.3, outDur: 0.2, stagger: 0.07 },
      transition: 'cut',
    },
  },
  {
    name: 'Klasik',
    description: 'Gradien hangat, Playfair, glow-beat',
    style: {
      ...structuredClone(base),
      preset: 'glow-beat',
      background: { kind: 'gradient', from: '#1b1206', to: '#3d2b12', angle: 90, animate: false },
      font: { family: 'Playfair Display', weight: 600, size: 60, letterSpacing: 1, lineHeight: 1.3, uppercase: false },
      colors: { text: '#fdf6e3', accent: '#e9c46a', shadow: true, overlay: 0.28 },
      layout: { align: 'center', x: 0.5, y: 0.8, maxWidthPct: 0.8, maxLines: 3 },
      timing: { inDur: 0.6, outDur: 0.4, stagger: 0.1 },
      transition: 'crossfade',
    },
  },
];
