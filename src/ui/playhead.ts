type Listener = (time: number) => void;

/**
 * Playhead shared by preview, transport, timeline and tap-sync. Kept outside
 * React so 60fps time updates never re-render the tree.
 */
class Playhead {
  time = 0;
  duration = 0;
  playing = false;

  private audio: HTMLAudioElement | null = null;
  private listeners = new Set<Listener>();
  private frame = 0;
  private lastTick = 0;

  attach(audio: HTMLAudioElement | null, duration: number, startAt = 0): void {
    this.detach();
    this.audio = audio;
    this.duration = duration;
    this.time = Math.max(0, Math.min(startAt, duration > 0 ? duration : startAt));
    if (audio) {
      const apply = () => {
        try {
          audio.currentTime = this.time;
        } catch {
          /* not seekable yet */
        }
      };
      if (audio.readyState >= 1) apply();
      else audio.addEventListener('loadedmetadata', apply, { once: true });
      audio.addEventListener('ended', this.onEnded);
    }
    this.emit();
  }

  detach(): void {
    this.pause();
    if (this.audio) this.audio.removeEventListener('ended', this.onEnded);
    this.audio = null;
    this.time = 0;
    this.duration = 0;
    this.emit();
  }

  private onEnded = (): void => {
    this.pause();
    this.seek(this.duration);
  };

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.time);
  }

  private tick = (): void => {
    if (!this.playing) return;
    const now = performance.now();
    const dt = Math.min((now - this.lastTick) / 1000, 0.25);
    this.lastTick = now;

    if (this.audio) {
      this.time = this.audio.currentTime;
    } else {
      this.time = Math.min(this.time + dt, this.duration || Infinity);
      if (this.duration > 0 && this.time >= this.duration) {
        this.time = this.duration;
        this.pause();
      }
    }
    this.emit();
    if (this.playing) this.frame = requestAnimationFrame(this.tick);
  };

  play(): void {
    if (this.playing) return;
    if (this.duration > 0 && this.time >= this.duration - 0.02) this.seek(0);
    this.playing = true;
    this.lastTick = performance.now();
    void this.audio?.play().catch(() => undefined);
    this.frame = requestAnimationFrame(this.tick);
  }

  pause(): void {
    if (!this.playing) return;
    this.playing = false;
    cancelAnimationFrame(this.frame);
    this.audio?.pause();
    this.emit();
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  seek(time: number): void {
    const limit = this.duration > 0 ? this.duration : Number.MAX_SAFE_INTEGER;
    this.time = Math.max(0, Math.min(time, limit));
    if (this.audio) {
      try {
        this.audio.currentTime = this.time;
      } catch {
        /* seeking before metadata loads */
      }
    }
    this.emit();
  }

  nudge(delta: number): void {
    this.seek(this.time + delta);
  }
}

export const playhead = new Playhead();
