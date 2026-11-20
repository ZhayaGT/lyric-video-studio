import { useEffect, useState } from 'react';
import { playhead } from './playhead.js';

function formatTime(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const m = Math.floor(safe / 60);
  const s = Math.floor(safe % 60);
  const cs = Math.floor((safe % 1) * 100);
  return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

export function Transport({ duration }: { duration: number }) {
  const [time, setTime] = useState(playhead.time);
  const [playing, setPlaying] = useState(playhead.playing);

  useEffect(() => {
    const unsubscribe = playhead.subscribe(setTime);
    const id = setInterval(() => setPlaying(playhead.playing), 120);
    return () => {
      unsubscribe();
      clearInterval(id);
    };
  }, []);

  return (
    <div className="transport">
      <button className="primary" onClick={() => playhead.toggle()} title="Play/Pause (Space)">
        {playing ? '❚❚' : '▶'}
      </button>
      <button onClick={() => playhead.nudge(-1)} title="Mundur 1 detik (Shift+←)">
        −1s
      </button>
      <button onClick={() => playhead.nudge(1)} title="Maju 1 detik (Shift+→)">
        +1s
      </button>
      <span className="time">
        {formatTime(time)} / {formatTime(duration)}
      </span>
      <input
        type="range"
        min={0}
        max={Math.max(duration, 0.01)}
        step={0.01}
        value={Math.min(time, duration || 0.01)}
        onChange={(e) => playhead.seek(Number(e.target.value))}
      />
    </div>
  );
}
