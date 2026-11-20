import type { BackgroundSpec, Kinetic, Motion, Style } from '../types.js';
import { THEMES } from '../render/themes.js';
import { DEFAULT_MOTION } from '../render/presets.js';
import { DEFAULT_KINETIC } from '../render/kinetic.js';
import { invalidateAssets } from '../render/assets.js';
import { api } from './api.js';
import { useEditor } from './store.js';

const FONTS: Style['font']['family'][] = ['Inter', 'Montserrat', 'Playfair Display', 'Bebas Neue'];
const PRESETS: { value: Style['preset']; label: string; hint: string }[] = [
  { value: 'fade-rise', label: 'Fade rise', hint: 'Naik + blur, mengambang saat ditahan' },
  { value: 'karaoke', label: 'Karaoke', hint: 'Isi aksen per kata mengikuti vokal' },
  { value: 'typewriter', label: 'Typewriter', hint: 'Muncul huruf demi huruf dengan kursor' },
  { value: 'pop-word', label: 'Pop word', hint: 'Kata memantul satu per satu' },
  { value: 'slide-left', label: 'Slide left', hint: 'Geser masuk, keluar ke kiri' },
  { value: 'glow-beat', label: 'Glow beat', hint: 'Glow berdenyut mengikuti beat' },
  { value: 'mask-reveal', label: 'Mask reveal', hint: 'Teks terungkap dari bawah per kata' },
  { value: 'cinematic', label: 'Cinematic', hint: 'Push-in lambat, blur lembut, keluar halus' },
  { value: 'kinetic', label: 'Kinetic', hint: 'Tipografi gerak: ukuran campur, rotasi, smear, coretan kuas' },
];

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
}) {
  return (
    <div className="field">
      <label>
        {label}: {format ? format(value) : value}
      </label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

export function StylePanel() {
  const project = useEditor((s) => s.project);
  const patchStyle = useEditor((s) => s.patchStyle);
  const setToast = useEditor((s) => s.setToast);
  if (!project) return null;

  const style = project.style;
  const bg = style.background;
  const motion: Motion = { ...DEFAULT_MOTION, ...(style.motion ?? {}) };
  const kinetic: Kinetic = { ...DEFAULT_KINETIC, ...(style.kinetic ?? {}) };

  const patchMotion = (patch: Partial<Motion>) => patchStyle({ motion: { ...motion, ...patch } });
  const patchKinetic = (patch: Partial<Kinetic>) => patchStyle({ kinetic: { ...kinetic, ...patch } });

  const setBackground = (next: BackgroundSpec) => patchStyle({ background: next });

  const uploadImage = async (file: File) => {
    try {
      const { file: rel } = await api.importImage(project.id, file);
      invalidateAssets();
      setBackground({ kind: 'image', file: rel, blur: 8, zoom: 0.08 });
      setToast('Gambar latar dimuat');
    } catch (err) {
      setToast(`Upload gagal: ${(err as Error).message}`);
    }
  };

  return (
    <div className="panel-body">
      <div className="group">
        <h3>Tema</h3>
        <div className="row wrap">
          {THEMES.map((theme) => (
            <button
              key={theme.name}
              title={theme.description}
              onClick={() => {
                patchStyle(theme.style);
                setToast(`Tema ${theme.name} diterapkan`);
              }}
            >
              {theme.name}
            </button>
          ))}
        </div>
      </div>

      <div className="group">
        <h3>Animasi</h3>
        <div className="seg" style={{ flexWrap: 'wrap' }}>
          {PRESETS.map((preset) => (
            <button
              key={preset.value}
              className={style.preset === preset.value ? 'active' : ''}
              onClick={() => patchStyle({ preset: preset.value })}
              title={preset.hint}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="hint">{PRESETS.find((p) => p.value === style.preset)?.hint}</div>
        <div className="row">
          <div className="field" style={{ flex: 1 }}>
            <label>Transisi</label>
            <select
              value={style.transition}
              onChange={(e) => patchStyle({ transition: e.target.value as Style['transition'] })}
            >
              <option value="crossfade">Crossfade</option>
              <option value="cut">Cut</option>
            </select>
          </div>
        </div>
        <Slider
          label="Durasi masuk"
          value={style.timing.inDur}
          min={0.05}
          max={1.5}
          step={0.05}
          onChange={(inDur) => patchStyle({ timing: { ...style.timing, inDur } })}
          format={(v) => `${v.toFixed(2)}s`}
        />
        <Slider
          label="Durasi keluar"
          value={style.timing.outDur}
          min={0.05}
          max={1.5}
          step={0.05}
          onChange={(outDur) => patchStyle({ timing: { ...style.timing, outDur } })}
          format={(v) => `${v.toFixed(2)}s`}
        />
        <Slider
          label="Stagger kata"
          value={style.timing.stagger}
          min={0}
          max={0.4}
          step={0.01}
          onChange={(stagger) => patchStyle({ timing: { ...style.timing, stagger } })}
          format={(v) => `${v.toFixed(2)}s`}
        />
      </div>

      <div className="group">
        <h3>Gerak (saat tampil)</h3>
        <Slider
          label="Push-in kamera"
          value={motion.cameraZoom}
          min={0}
          max={0.2}
          step={0.005}
          onChange={(cameraZoom) => patchMotion({ cameraZoom })}
          format={(v) => `${(v * 100).toFixed(1)}%`}
        />
        <Slider
          label="Napas mengikuti beat"
          value={motion.breathe}
          min={0}
          max={0.08}
          step={0.002}
          onChange={(breathe) => patchMotion({ breathe })}
          format={(v) => `${(v * 100).toFixed(1)}%`}
        />
        <Slider
          label="Drift vertikal"
          value={motion.drift}
          min={0}
          max={24}
          step={1}
          onChange={(drift) => patchMotion({ drift })}
          format={(v) => `${v}px/s`}
        />
        <Slider
          label="Blur masuk/keluar"
          value={motion.blur}
          min={0}
          max={14}
          step={0.5}
          onChange={(blur) => patchMotion({ blur })}
          format={(v) => `${v}px`}
        />
        <Slider
          label="Jarak gerak keluar"
          value={motion.exitLift}
          min={0}
          max={2}
          step={0.05}
          onChange={(exitLift) => patchMotion({ exitLift })}
          format={(v) => `${Math.round(v * 100)}%`}
        />
        <button
          className="ghost"
          onClick={() => patchStyle({ motion: { cameraZoom: 0.04, breathe: 0.012, drift: 6, blur: 4, exitLift: 1 } })}
        >
          Kembalikan gerak default
        </button>
      </div>

      {style.preset === 'kinetic' && (
        <div className="group">
          <h3>Tipografi gerak</h3>
          <Slider
            label="Kata per tampilan"
            value={kinetic.wordsPerBurst}
            min={1}
            max={5}
            step={1}
            onChange={(wordsPerBurst) => patchKinetic({ wordsPerBurst })}
            format={(v) => `${v} kata`}
          />
          <Slider
            label="Skala kata kunci"
            value={kinetic.emphasisScale}
            min={0}
            max={2}
            step={0.05}
            onChange={(emphasisScale) => patchKinetic({ emphasisScale })}
            format={(v) => `+${Math.round(v * 100)}%`}
          />
          <Slider
            label="Coretan kuas"
            value={kinetic.swatchCount}
            min={0}
            max={1}
            step={1}
            onChange={(swatchCount) => patchKinetic({ swatchCount })}
            format={(v) => (v > 0 ? 'aktif' : 'nonaktif')}
          />
          <div className="field">
            <label>Warna coretan</label>
            <div className="row">
              <input
                type="color"
                value={kinetic.swatchColor || style.colors.accent}
                onChange={(e) => patchKinetic({ swatchColor: e.target.value })}
              />
              <button
                className="ghost"
                onClick={() => patchKinetic({ swatchColor: '' })}
                title="Ikuti warna aksen"
              >
                Ikut aksen
              </button>
            </div>
          </div>
          <Slider
            label="Rotasi kata"
            value={kinetic.rotate}
            min={0}
            max={14}
            step={0.5}
            onChange={(rotate) => patchKinetic({ rotate })}
            format={(v) => `${v}°`}
          />
          <Slider
            label="Jitter baseline"
            value={kinetic.baselineJitter}
            min={0}
            max={40}
            step={1}
            onChange={(baselineJitter) => patchKinetic({ baselineJitter })}
            format={(v) => `${v}px`}
          />
          <Slider
            label="Squash saat mendarat"
            value={kinetic.stretch}
            min={0}
            max={0.9}
            step={0.05}
            onChange={(stretch) => patchKinetic({ stretch })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <Slider
            label="Jumlah smear"
            value={kinetic.smear}
            min={0}
            max={6}
            step={1}
            onChange={(smear) => patchKinetic({ smear })}
            format={(v) => `${v}`}
          />
          <Slider
            label="Jarak smear"
            value={kinetic.smearDistance}
            min={0}
            max={80}
            step={2}
            onChange={(smearDistance) => patchKinetic({ smearDistance })}
            format={(v) => `${v}px`}
          />
          <button className="ghost" onClick={() => patchStyle({ kinetic: { ...DEFAULT_KINETIC } })}>
            Kembalikan kinetic default
          </button>
        </div>
      )}

      <div className="group">
        <h3>Latar</h3>
        <select
          value={bg.kind}
          onChange={(e) => {
            const kind = e.target.value as BackgroundSpec['kind'];
            if (kind === 'solid') setBackground({ kind: 'solid', color: '#0b0f17' });
            else if (kind === 'gradient')
              setBackground({ kind: 'gradient', from: '#0b1d3a', to: '#1b3b6f', angle: 135, animate: true });
            else if (kind === 'image') setBackground({ kind: 'image', file: '', blur: 8, zoom: 0.08 });
            else
              setBackground({
                kind: 'mesh',
                palette: ['#0b1d3a', '#1b3b6f', '#0e4d64'],
                speed: 0.15,
                pulseOnBeat: true,
              });
          }}
        >
          <option value="mesh">Mesh</option>
          <option value="gradient">Gradien</option>
          <option value="solid">Warna solid</option>
          <option value="image">Gambar</option>
        </select>

        {bg.kind === 'solid' && (
          <div className="field">
            <label>Warna</label>
            <input type="color" value={bg.color} onChange={(e) => setBackground({ ...bg, color: e.target.value })} />
          </div>
        )}

        {bg.kind === 'gradient' && (
          <>
            <div className="row">
              <div className="field" style={{ flex: 1 }}>
                <label>Dari</label>
                <input type="color" value={bg.from} onChange={(e) => setBackground({ ...bg, from: e.target.value })} />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label>Ke</label>
                <input type="color" value={bg.to} onChange={(e) => setBackground({ ...bg, to: e.target.value })} />
              </div>
            </div>
            <Slider
              label="Sudut"
              value={bg.angle}
              min={0}
              max={360}
              step={5}
              onChange={(angle) => setBackground({ ...bg, angle })}
              format={(v) => `${v}°`}
            />
            <label className="row" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={bg.animate}
                onChange={(e) => setBackground({ ...bg, animate: e.target.checked })}
                style={{ width: 'auto' }}
              />
              Animasi gradien
            </label>
          </>
        )}

        {bg.kind === 'mesh' && (
          <>
            <div className="row">
              {bg.palette.map((color, index) => (
                <div className="field" key={index} style={{ flex: 1 }}>
                  <label>W{index + 1}</label>
                  <input
                    type="color"
                    value={color}
                    onChange={(e) => {
                      const palette = [...bg.palette] as [string, string, string];
                      palette[index] = e.target.value;
                      setBackground({ ...bg, palette });
                    }}
                  />
                </div>
              ))}
            </div>
            <Slider
              label="Kecepatan"
              value={bg.speed}
              min={0}
              max={1}
              step={0.01}
              onChange={(speed) => setBackground({ ...bg, speed })}
              format={(v) => v.toFixed(2)}
            />
            <label className="row" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={bg.pulseOnBeat}
                onChange={(e) => setBackground({ ...bg, pulseOnBeat: e.target.checked })}
                style={{ width: 'auto' }}
              />
              Pulse mengikuti beat
            </label>
          </>
        )}

        {bg.kind === 'image' && (
          <>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void uploadImage(file);
              }}
            />
            <Slider
              label="Blur"
              value={bg.blur}
              min={0}
              max={40}
              step={1}
              onChange={(blur) => setBackground({ ...bg, blur })}
              format={(v) => `${v}px`}
            />
            <Slider
              label="Zoom"
              value={bg.zoom}
              min={0}
              max={0.5}
              step={0.01}
              onChange={(zoom) => setBackground({ ...bg, zoom })}
              format={(v) => `${(v * 100).toFixed(0)}%`}
            />
          </>
        )}
      </div>

      <div className="group">
        <h3>Tipografi</h3>
        <div className="row">
          <div className="field" style={{ flex: 2 }}>
            <label>Font</label>
            <select
              value={style.font.family}
              onChange={(e) => patchStyle({ font: { ...style.font, family: e.target.value as Style['font']['family'] } })}
            >
              {FONTS.map((font) => (
                <option key={font} value={font}>
                  {font}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Weight</label>
            <select
              value={style.font.weight}
              onChange={(e) => patchStyle({ font: { ...style.font, weight: Number(e.target.value) } })}
              disabled={style.font.family === 'Bebas Neue'}
            >
              {[400, 500, 600, 700].map((weight) => (
                <option key={weight} value={weight}>
                  {weight}
                </option>
              ))}
            </select>
          </div>
        </div>
        <Slider
          label="Ukuran"
          value={style.font.size}
          min={32}
          max={120}
          step={2}
          onChange={(size) => patchStyle({ font: { ...style.font, size } })}
          format={(v) => `${v}px`}
        />
        <Slider
          label="Letter spacing"
          value={style.font.letterSpacing}
          min={-2}
          max={12}
          step={0.5}
          onChange={(letterSpacing) => patchStyle({ font: { ...style.font, letterSpacing } })}
          format={(v) => `${v}px`}
        />
        <Slider
          label="Line height"
          value={style.font.lineHeight}
          min={0.9}
          max={2}
          step={0.05}
          onChange={(lineHeight) => patchStyle({ font: { ...style.font, lineHeight } })}
          format={(v) => v.toFixed(2)}
        />
        <label className="row" style={{ gap: 6 }}>
          <input
            type="checkbox"
            checked={style.font.uppercase}
            onChange={(e) => patchStyle({ font: { ...style.font, uppercase: e.target.checked } })}
            style={{ width: 'auto' }}
          />
          HURUF BESAR
        </label>
      </div>

      <div className="group">
        <h3>Warna</h3>
        <div className="row">
          <div className="field" style={{ flex: 1 }}>
            <label>Teks</label>
            <input
              type="color"
              value={style.colors.text}
              onChange={(e) => patchStyle({ colors: { ...style.colors, text: e.target.value } })}
            />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Aksen</label>
            <input
              type="color"
              value={style.colors.accent}
              onChange={(e) => patchStyle({ colors: { ...style.colors, accent: e.target.value } })}
            />
          </div>
        </div>
        <Slider
          label="Overlay gelap"
          value={style.colors.overlay}
          min={0}
          max={0.85}
          step={0.01}
          onChange={(overlay) => patchStyle({ colors: { ...style.colors, overlay } })}
          format={(v) => `${Math.round(v * 100)}%`}
        />
        <Slider
          label="Grain film"
          value={style.grain ?? 0}
          min={0}
          max={0.3}
          step={0.01}
          onChange={(grain) => patchStyle({ grain })}
          format={(v) => `${Math.round(v * 100)}%`}
        />
        <label className="row" style={{ gap: 6 }}>
          <input
            type="checkbox"
            checked={style.colors.shadow}
            onChange={(e) => patchStyle({ colors: { ...style.colors, shadow: e.target.checked } })}
            style={{ width: 'auto' }}
          />
          Bayangan teks
        </label>
      </div>

      <div className="group">
        <h3>Tata letak</h3>
        <div className="row">
          <div className="field" style={{ flex: 1 }}>
            <label>Perataan</label>
            <select
              value={style.layout.align}
              onChange={(e) => patchStyle({ layout: { ...style.layout, align: e.target.value as 'center' | 'left' } })}
            >
              <option value="center">Tengah</option>
              <option value="left">Kiri</option>
            </select>
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Maks baris</label>
            <input
              type="number"
              min={1}
              max={5}
              value={style.layout.maxLines}
              onChange={(e) => patchStyle({ layout: { ...style.layout, maxLines: Number(e.target.value) || 1 } })}
            />
          </div>
        </div>
        <Slider
          label="Posisi X"
          value={style.layout.x}
          min={0.1}
          max={0.9}
          step={0.01}
          onChange={(x) => patchStyle({ layout: { ...style.layout, x } })}
          format={(v) => `${Math.round(v * 100)}%`}
        />
        <Slider
          label="Posisi Y"
          value={style.layout.y}
          min={0.1}
          max={0.95}
          step={0.01}
          onChange={(y) => patchStyle({ layout: { ...style.layout, y } })}
          format={(v) => `${Math.round(v * 100)}%`}
        />
        <Slider
          label="Lebar maks"
          value={style.layout.maxWidthPct}
          min={0.4}
          max={1}
          step={0.01}
          onChange={(maxWidthPct) => patchStyle({ layout: { ...style.layout, maxWidthPct } })}
          format={(v) => `${Math.round(v * 100)}%`}
        />
      </div>
    </div>
  );
}
