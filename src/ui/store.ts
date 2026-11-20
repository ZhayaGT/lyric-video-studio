import { create } from 'zustand';
import type { LyricLine, Project, SongSummary, Style } from '../types.js';
import { api, type Health } from './api.js';
import { playhead } from './playhead.js';

export type Panel = 'lirik' | 'desain' | 'audio' | 'ekspor';

export type EditorState = {
  songs: SongSummary[];
  health: Health | null;
  project: Project | null;
  loading: boolean;
  saving: boolean;
  dirty: boolean;
  error: string | null;
  toast: string | null;
  panel: Panel;
  selectedLineId: string | null;
  tapSync: boolean;
  safeGuides: boolean;
  zoom: number;
  sidebarOpen: boolean;
  sheetOpen: boolean;

  bootstrap: () => Promise<void>;
  refreshSongs: () => Promise<void>;
  openSong: (id: string) => Promise<void>;
  newSong: (title: string, artist: string) => Promise<void>;
  deleteSong: (id: string) => Promise<void>;
  closeSong: () => void;
  save: () => Promise<void>;
  mutate: (updater: (project: Project) => Project) => void;
  patchStyle: (patch: Partial<Style>) => void;
  setPanel: (panel: Panel) => void;
  setSelectedLine: (id: string | null) => void;
  setLines: (lines: LyricLine[]) => void;
  updateLine: (id: string, patch: Partial<LyricLine>) => void;
  addLine: (afterId?: string) => void;
  removeLine: (id: string) => void;
  mergeWithPrevious: (id: string) => void;
  splitLine: (id: string, charIndex: number) => void;
  moveLine: (id: string, direction: -1 | 1) => void;
  toggleTapSync: () => void;
  tap: () => void;
  setToast: (message: string | null) => void;
  setZoom: (zoom: number) => void;
  toggleSafeGuides: () => void;
  setSidebarOpen: (open: boolean) => void;
  setSheetOpen: (open: boolean) => void;
};

let saveTimer: ReturnType<typeof setTimeout> | null = null;

const MIN_LINE_DURATION = 0.3;
const LINE_GAP = 0.01;

/**
 * Keep the timeline monotonic after an edit: each line starts no earlier than
 * the previous line's end. Later lines ripple forward instead of being squeezed
 * below the minimum duration (tap-sync relies on that).
 */
function reindex(lines: LyricLine[]): LyricLine[] {
  const out: LyricLine[] = [];
  let cursor = 0;
  for (const line of lines) {
    const start = Math.max(line.start, cursor);
    const shift = start - line.start;
    // Preserve each line's own duration when a neighbour pushes it later.
    const end = Math.max(line.end + shift, start + MIN_LINE_DURATION);
    out.push({ ...line, start: Number(start.toFixed(3)), end: Number(end.toFixed(3)) });
    cursor = end + LINE_GAP;
  }
  return out;
}

export const useEditor = create<EditorState>((set, get) => ({
  songs: [],
  health: null,
  project: null,
  loading: false,
  saving: false,
  dirty: false,
  error: null,
  toast: null,
  panel: 'lirik',
  selectedLineId: null,
  tapSync: false,
  safeGuides: false,
  zoom: 1,
  sidebarOpen: false,
  sheetOpen: false,

  bootstrap: async () => {
    try {
      const [health, songs] = await Promise.all([api.health(), api.listSongs()]);
      set({ health, songs });
    } catch (err) {
      set({ error: String((err as Error).message ?? err) });
    }
  },

  refreshSongs: async () => {
    try {
      set({ songs: await api.listSongs() });
    } catch (err) {
      set({ error: String((err as Error).message ?? err) });
    }
  },

  openSong: async (id) => {
    set({ loading: true, error: null });
    try {
      const stored = await api.getSong(id);
      const project = stored as Project;
      set({
        project,
        loading: false,
        dirty: false,
        selectedLineId: project.lines[0]?.id ?? null,
        tapSync: false,
      });
      // The App effect owns playhead attachment; it lands on the first line so
      // the preview never opens on a blank frame.
    } catch (err) {
      set({ loading: false, error: String((err as Error).message ?? err) });
    }
  },

  newSong: async (title, artist) => {
    set({ loading: true, error: null });
    try {
      const project = await api.createSong(title, artist);
      await get().refreshSongs();
      await get().openSong(project.id);
    } catch (err) {
      set({ loading: false, error: String((err as Error).message ?? err) });
    }
  },

  deleteSong: async (id) => {
    try {
      await api.deleteSong(id);
      if (get().project?.id === id) get().closeSong();
      await get().refreshSongs();
    } catch (err) {
      set({ error: String((err as Error).message ?? err) });
    }
  },

  closeSong: () => {
    playhead.pause();
    playhead.detach();
    set({ project: null, selectedLineId: null, dirty: false, tapSync: false });
  },

  save: async () => {
    const project = get().project;
    if (!project) return;
    set({ saving: true });
    try {
      await api.saveSong(project);
      set({ saving: false, dirty: false });
      void get().refreshSongs();
    } catch (err) {
      set({ saving: false, error: String((err as Error).message ?? err) });
    }
  },

  mutate: (updater) => {
    const project = get().project;
    if (!project) return;
    const next = updater(project);
    set({ project: next, dirty: true });
    clearTimeout(saveTimer ?? undefined);
    saveTimer = setTimeout(() => void get().save(), 900);
  },

  patchStyle: (patch) => {
    get().mutate((project) => ({
      ...project,
      style: {
        ...project.style,
        ...patch,
        font: { ...project.style.font, ...(patch.font ?? {}) },
        colors: { ...project.style.colors, ...(patch.colors ?? {}) },
        layout: { ...project.style.layout, ...(patch.layout ?? {}) },
        timing: { ...project.style.timing, ...(patch.timing ?? {}) },
        motion: { ...(project.style.motion ?? {}), ...(patch.motion ?? {}) },
        background: patch.background ?? project.style.background,
      },
    }));
  },

  setPanel: (panel) => set({ panel, sheetOpen: true }),
  setSelectedLine: (selectedLineId) => set({ selectedLineId }),

  setLines: (lines) => {
    get().mutate((project) => ({ ...project, lines: reindex(lines) }));
    set({ selectedLineId: lines[0]?.id ?? null });
  },

  updateLine: (id, patch) => {
    get().mutate((project) => ({
      ...project,
      lines: project.lines.map((line) => (line.id === id ? { ...line, ...patch } : line)),
    }));
  },

  addLine: (afterId) => {
    const project = get().project;
    if (!project) return;
    const index = afterId ? project.lines.findIndex((l) => l.id === afterId) : project.lines.length - 1;
    const prev = project.lines[index];
    const next = project.lines[index + 1];
    const start = prev ? prev.end + 0.15 : 0;
    const end = next ? Math.max(start + 0.3, next.start - 0.05) : Math.min(start + 2.5, project.audio.duration || start + 2.5);
    const line: LyricLine = {
      id: `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
      text: 'baris baru',
      start,
      end,
    };
    const lines = [...project.lines];
    lines.splice(index + 1, 0, line);
    get().mutate((p) => ({ ...p, lines: reindex(lines) }));
    set({ selectedLineId: line.id });
  },

  removeLine: (id) => {
    const project = get().project;
    if (!project) return;
    const lines = project.lines.filter((line) => line.id !== id);
    get().mutate((p) => ({ ...p, lines: reindex(lines) }));
    set({ selectedLineId: lines[0]?.id ?? null });
  },

  mergeWithPrevious: (id) => {
    const project = get().project;
    if (!project) return;
    const index = project.lines.findIndex((line) => line.id === id);
    if (index <= 0) return;
    const prev = project.lines[index - 1];
    const cur = project.lines[index];
    const merged: LyricLine = {
      ...prev,
      text: `${prev.text} ${cur.text}`.trim(),
      end: cur.end,
      words: undefined,
    };
    const lines = project.lines.filter((line) => line.id !== id);
    lines[index - 1] = merged;
    get().mutate((p) => ({ ...p, lines: reindex(lines) }));
    set({ selectedLineId: merged.id });
  },

  splitLine: (id, charIndex) => {
    const project = get().project;
    if (!project) return;
    const index = project.lines.findIndex((line) => line.id === id);
    if (index === -1) return;
    const line = project.lines[index];
    const head = line.text.slice(0, charIndex).trim();
    const tail = line.text.slice(charIndex).trim();
    if (!head || !tail) return;
    const ratio = charIndex / Math.max(line.text.length, 1);
    const splitAt = line.start + (line.end - line.start) * ratio;
    const first: LyricLine = { ...line, text: head, end: splitAt, words: undefined };
    const second: LyricLine = {
      id: `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
      text: tail,
      start: splitAt,
      end: line.end,
    };
    const lines = [...project.lines];
    lines.splice(index, 1, first, second);
    get().mutate((p) => ({ ...p, lines: reindex(lines) }));
    set({ selectedLineId: second.id });
  },

  moveLine: (id, direction) => {
    const project = get().project;
    if (!project) return;
    const index = project.lines.findIndex((line) => line.id === id);
    const target = index + direction;
    if (index === -1 || target < 0 || target >= project.lines.length) return;

    // Swap the entries but keep the time slots: the timeline stays monotonic and
    // only the text order changes. Build new objects — the old ones are still
    // referenced by the current state and by the save snapshot.
    const order = [...project.lines];
    [order[index], order[target]] = [order[target], order[index]];
    const lines = order.map((line, i) => ({
      ...line,
      start: project.lines[i].start,
      end: project.lines[i].end,
    }));
    get().mutate((p) => ({ ...p, lines }));
  },

  toggleTapSync: () => {
    const { tapSync, project, selectedLineId } = get();
    if (!project) return;
    const next = !tapSync;
    set({
      tapSync: next,
      selectedLineId: next ? (selectedLineId ?? project.lines[0]?.id ?? null) : selectedLineId,
    });
  },

  tap: () => {
    const { project, selectedLineId, tapSync } = get();
    if (!project || !tapSync || !selectedLineId) return;
    const index = project.lines.findIndex((line) => line.id === selectedLineId);
    if (index === -1) return;
    const start = Number(playhead.time.toFixed(3));
    const end = Number((start + 2.5).toFixed(3));
    const lines = project.lines.map((line, i) => (i === index ? { ...line, start, end, words: undefined } : line));
    get().mutate((p) => ({ ...p, lines: reindex(lines) }));
    set({ selectedLineId: project.lines[index + 1]?.id ?? selectedLineId });
  },

  setToast: (toast) => set({ toast }),
  setZoom: (zoom) => set({ zoom: Math.max(0.5, Math.min(8, zoom)) }),
  toggleSafeGuides: () => set({ safeGuides: !get().safeGuides }),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  setSheetOpen: (sheetOpen) => set({ sheetOpen }),
}));
