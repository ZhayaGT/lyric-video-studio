import { useState } from 'react';
import { api } from './api.js';
import { useEditor } from './store.js';

export function Library() {
  const songs = useEditor((s) => s.songs);
  const project = useEditor((s) => s.project);
  const openSong = useEditor((s) => s.openSong);
  const newSong = useEditor((s) => s.newSong);
  const deleteSong = useEditor((s) => s.deleteSong);
  const refreshSongs = useEditor((s) => s.refreshSongs);
  const setToast = useEditor((s) => s.setToast);
  const sidebarOpen = useEditor((s) => s.sidebarOpen);
  const setSidebarOpen = useEditor((s) => s.setSidebarOpen);
  const [busy, setBusy] = useState<string | null>(null);
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');

  const importYoutube = async () => {
    const url = youtubeUrl.trim();
    if (!url) return;
    setBusy('Mengunduh audio + caption…');
    try {
      const created = await api.importYoutube(url);
      setYoutubeUrl('');
      await refreshSongs();
      await openSong(created.id);
      setToast(`Diimpor: ${created.title} (${created.lines.length} baris)`);
    } catch (err) {
      setToast(`Impor YouTube gagal: ${(err as Error).message}. Coba unggah berkas audio.`);
    } finally {
      setBusy(null);
    }
  };

  const importFile = async (file: File) => {
    setBusy(`Mengunggah ${file.name}…`);
    try {
      const created = await api.importAudio(file, file.name.replace(/\.[^.]+$/, ''), '');
      await refreshSongs();
      await openSong(created.id);
      setToast(`Audio diunggah: ${created.title}`);
    } catch (err) {
      setToast(`Upload gagal: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <aside className={`sidebar${sidebarOpen ? ' open' : ''}`}>
      <div className="sidebar-head">
        <div className="brand">
          Lyric Video Studio
          <small>lokal · 720p/1080p · inferhub AI</small>
        </div>
        <button
          className="icon ghost mobile-only"
          onClick={() => setSidebarOpen(false)}
          title="Tutup"
          aria-label="Tutup daftar lagu"
        >
          ✕
        </button>
      </div>

      <div className="sidebar-actions">
        <button
          className="primary"
          onClick={() => {
            setShowCreate(true);
            setSidebarOpen(false);
          }}
          disabled={busy !== null}
        >
          + Lagu baru
        </button>
        <input
          type="url"
          placeholder="URL YouTube (opsional)"
          value={youtubeUrl}
          onChange={(e) => setYoutubeUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void importYoutube();
          }}
          disabled={busy !== null}
        />
        <button onClick={() => void importYoutube()} disabled={!youtubeUrl.trim() || busy !== null}>
          Impor YouTube
        </button>
        <label
          className="dropzone"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const file = e.dataTransfer.files?.[0];
            if (file) void importFile(file);
          }}
        >
          Tarik berkas audio ke sini
          <input
            type="file"
            accept="audio/*"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void importFile(file);
            }}
          />
        </label>
        {busy && <div className="hint">{busy}</div>}
      </div>

      <div className="song-list">
        {songs.length === 0 && <div className="hint" style={{ padding: '8px 10px' }}>Belum ada lagu.</div>}
        {songs.map((song) => (
          <div
            key={song.id}
            className={`song-item${project?.id === song.id ? ' active' : ''}`}
            onClick={() => {
              void openSong(song.id);
              setSidebarOpen(false);
            }}
            title={`${song.title || song.id}${song.artist ? ` — ${song.artist}` : ''}`}
          >
            <div style={{ minWidth: 0 }}>
              <div className="title">{song.title || song.id}</div>
              <div className="meta">
                {song.artist || 'tanpa artis'} · {Math.round(song.duration)}s
              </div>
            </div>
            <button
              className="ghost danger"
              title="Hapus lagu"
              onClick={(e) => {
                e.stopPropagation();
                if (confirm(`Hapus "${song.title || song.id}" beserta audio & ekspornya?`)) {
                  void deleteSong(song.id);
                }
              }}
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      {showCreate && (
        <div className="modal-backdrop" onClick={() => setShowCreate(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: 0 }}>Lagu baru</h3>
            <div className="field">
              <label>Judul</label>
              <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
            </div>
            <div className="field">
              <label>Artis</label>
              <input type="text" value={artist} onChange={(e) => setArtist(e.target.value)} />
            </div>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="ghost" onClick={() => setShowCreate(false)}>
                Batal
              </button>
              <button
                className="primary"
                disabled={!title.trim()}
                onClick={() => {
                  void newSong(title.trim(), artist.trim());
                  setTitle('');
                  setArtist('');
                  setShowCreate(false);
                }}
              >
                Buat
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
