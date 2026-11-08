'use client';

import { useEffect, useRef, useState } from 'react';
import type { Hand, Note, Score } from '@/lib/score';
import { playNote, preloadPiano, unlockAudio } from '@/lib/piano';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Slider from '@mui/material/Slider';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import FastRewindIcon from '@mui/icons-material/FastRewind';
import PauseIcon from '@mui/icons-material/Pause';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import SkipPreviousIcon from '@mui/icons-material/SkipPrevious';
import FastForwardIcon from '@mui/icons-material/FastForward';

const COLORS = { R: '#3b82f6', L: '#f97316' } as const;
const LEAD_IN = -4; // 4 temps de décompte

const isBlack = (m: number) => [1, 3, 6, 8, 10].includes(m % 12);
const octaveOf = (midi: number) => Math.floor(midi / 12) - 1;

type Key = { x: number; w: number; black: boolean };
type Group = { start: number; end: number; hand: Hand; notes: Note[] };

function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}


// Index de la mesure qui contient ce temps (recherche dichotomique)
function measureIndexAt(measures: number[], beat: number) {
  let lo = 0;
  let hi = measures.length - 1;
  let r = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (measures[mid] <= beat) {
      r = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return r;
}

function keyLayout(lo: number, hi: number, width: number) {
  let whites = 0;
  for (let m = lo; m <= hi; m++) if (!isBlack(m)) whites++;
  const ww = width / whites;
  const bw = ww * 0.6;
  const keys: Record<number, Key> = {};
  let wi = 0;
  for (let m = lo; m <= hi; m++) {
    if (isBlack(m)) keys[m] = { x: wi * ww - bw / 2, w: bw, black: true };
    else { keys[m] = { x: wi * ww, w: ww, black: false }; wi++; }
  }
  return keys;
}

function noteRange(notes: Note[]) {
  if (notes.length === 0) return { lo: 48, hi: 84 };
  let lo = Math.max(21, Math.min(...notes.map((n) => n.midi)) - 2);
  let hi = Math.min(108, Math.max(...notes.map((n) => n.midi)) + 2);
  while (hi - lo < 24) { lo = Math.max(21, lo - 1); hi = Math.min(108, hi + 1); }
  if (isBlack(lo)) lo--;
  if (isBlack(hi)) hi++;
  return { lo, hi };
}

// Regroupe les notes jouées ensemble (accords) par main, aigu en haut
function buildGroups(notes: Note[]): Group[] {
  const map = new Map<string, Group>();
  for (const n of notes) {
    const k = `${n.hand}-${n.start.toFixed(3)}`;
    let g = map.get(k);
    if (!g) {
      g = { start: n.start, end: n.start + n.dur, hand: n.hand, notes: [] };
      map.set(k, g);
    }
    g.notes.push(n);
    g.end = Math.max(g.end, n.start + n.dur);
  }
  const groups = [...map.values()].sort((a, b) => a.start - b.start);
  groups.forEach((g) => g.notes.sort((a, b) => b.midi - a.midi));
  return groups;
}

export default function Player({ score }: { score: Score }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const beatRef = useRef(LEAD_IN);
  const nextRef = useRef(0);
  const playingRef = useRef(false);
  const bpmRef = useRef(score.bpm);
  const soundRef = useRef(true);
  const ppbRef = useRef(110);
  const octRef = useRef(false);
    const measureRef = useRef(0);
  const loopRef = useRef<{ start: number; end: number } | null>(null);

  const [playing, setPlaying] = useState(false);
  const [bpm, setBpm] = useState(score.bpm);
  const [sound, setSound] = useState(true);
  const [ppb, setPpb] = useState(110);
  const [showOct, setShowOct] = useState(false);
  const [ready, setReady] = useState(false);
    const [measure, setMeasure] = useState(0);
  const [loopOn, setLoopOn] = useState(false);
  const [loopRange, setLoopRange] = useState<number[]>([0, Math.min(3, score.measures.length - 1)]);

  useEffect(() => { preloadPiano().then(() => setReady(true)).catch(() => setReady(false)); }, []);
  useEffect(() => { bpmRef.current = bpm; }, [bpm]);
  useEffect(() => { soundRef.current = sound; }, [sound]);
  useEffect(() => { ppbRef.current = ppb; }, [ppb]);
  useEffect(() => { octRef.current = showOct; }, [showOct]);

  const seek = (beat: number) => {
    beatRef.current = beat;
    const i = score.notes.findIndex((n) => n.start >= beat);
    nextRef.current = i < 0 ? score.notes.length : i;
  };

  const toggle = () => {
    unlockAudio();
    if (!playingRef.current && beatRef.current > score.end) seek(LEAD_IN);
    playingRef.current = !playingRef.current;
    setPlaying(playingRef.current);
  };


  const goToMeasure = (i: number) => {
    const idx = Math.max(0, Math.min(score.measures.length - 1, i));
    seek(score.measures[idx]);
  };

  // Active ou met à jour la boucle ; replace la lecture dans la zone si besoin
  const applyLoop = (on: boolean, range: number[]) => {
    const start = score.measures[range[0]];
    const end = score.measures[range[1] + 1] ?? score.end;
    loopRef.current = on ? { start, end } : null;
    if (on && (beatRef.current < start || beatRef.current >= end)) seek(start);
  };

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    const notes = score.notes;
    const groups = buildGroups(notes);
    const { lo, hi } = noteRange(notes);
    let raf = 0;
    let last = performance.now();

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const W = canvas.clientWidth;
      const H = canvas.clientHeight;
      if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const kbH = Math.min(H * 0.3, 150);
      const trackH = H - kbH;
      const laneH = trackH / 2;
      const cursorX = Math.round(W * 0.2);
      const ppb = ppbRef.current;
      const beat = beatRef.current;
      const label = (n: Note) => (octRef.current ? `${n.name}${octaveOf(n.midi)}` : n.name);

      // Ce qui se joue maintenant, et le prochain accord de chaque main
      const current: Group[] = [];
      const next: Partial<Record<Hand, Group>> = {};
      for (const g of groups) {
        if (g.start > beat) {
          if (!next[g.hand]) next[g.hand] = g;
          if (next.R && next.L) break;
        } else if (g.end > beat) {
          current.push(g);
        }
      }

      // Fond des deux lignes
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, W, laneH);
      ctx.fillStyle = '#111827';
      ctx.fillRect(0, laneH, W, laneH);

      // Un trait vertical par temps
      ctx.strokeStyle = '#1f2937';
      ctx.lineWidth = 1;
      for (let b = Math.ceil(beat - cursorX / ppb); cursorX + (b - beat) * ppb < W; b++) {
        const x = Math.round(cursorX + (b - beat) * ppb) + 0.5;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, trackH);
        ctx.stroke();
      }


      // Zone de boucle surlignée
      const loop = loopRef.current;
      if (loop) {
        const x1 = cursorX + (loop.start - beat) * ppb;
        const x2 = cursorX + (loop.end - beat) * ppb;
        ctx.fillStyle = 'rgba(250, 204, 21, 0.08)';
        ctx.fillRect(x1, 0, x2 - x1, trackH);
      }

      // Barres de mesure numérotées
      ctx.strokeStyle = '#475569';
      ctx.fillStyle = '#94a3b8';
      ctx.font = '600 11px system-ui';
      ctx.textAlign = 'left';
      score.measures.forEach((mb, i) => {
        const x = cursorX + (mb - beat) * ppb;
        if (x < -40 || x > W) return;
        ctx.beginPath();
        ctx.moveTo(Math.round(x) + 0.5, 0);
        ctx.lineTo(Math.round(x) + 0.5, trackH);
        ctx.stroke();
        ctx.fillText(String(i + 1), x + 4, trackH - 6);
      });

      // Cases de notes
      for (const g of groups) {
        const x = cursorX + (g.start - beat) * ppb;
        if (x > W) break;
        const xEnd = cursorX + (g.end - beat) * ppb;
        if (xEnd < 0) continue;

        const y0 = g.hand === 'R' ? 0 : laneH;
        const color = COLORS[g.hand];
        const isCurrent = g.start <= beat && g.end > beat;
        const isNext = next[g.hand] === g;
        const isPast = g.end <= beat;

        ctx.fillStyle = hexA(color, isCurrent ? 0.9 : isNext ? 0.3 : isPast ? 0.06 : 0.15);
        ctx.beginPath();
        ctx.roundRect(x + 1, y0 + 4, Math.max(6, xEnd - x - 2), laneH - 8, 6);
        ctx.fill();
        if (isNext) {
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.lineWidth = 1;
        }

        const count = g.notes.length;
        const size = Math.max(11, Math.min(22, (laneH - 12) / count / 1.15));
        const lineH = size * 1.15;
        let y = y0 + laneH / 2 - (count * lineH) / 2 + size * 0.95;
        ctx.font = `${isCurrent || isNext ? 700 : 500} ${size}px system-ui`;
        ctx.textAlign = 'left';
        ctx.fillStyle = isPast ? '#475569' : isCurrent || isNext ? '#ffffff' : '#cbd5e1';
        for (const n of g.notes) {
          ctx.fillText(label(n), x + 6, y);
          y += lineH;
        }
      }

      // Étiquettes des lignes, curseur, décompte
      ctx.font = '600 11px system-ui';
      ctx.fillStyle = '#64748b';
      ctx.textAlign = 'left';
      ctx.fillText('Main droite', 6, 14);
      ctx.fillText('Main gauche', 6, laneH + 14);
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(cursorX - 1, 0, 2, trackH);
      if (beat < 0) {
        ctx.font = '700 28px system-ui';
        ctx.fillStyle = '#94a3b8';
        ctx.textAlign = 'center';
        ctx.fillText(String(Math.ceil(-beat)), cursorX - 24, trackH / 2 + 10);
      }

      // Clavier : plein = à jouer maintenant, transparent = prochaine note
      const keys = keyLayout(lo, hi, W);
      const active = new Map<number, Note>();
      for (const g of current) for (const n of g.notes) if (n.start + n.dur > beat) active.set(n.midi, n);
      const preview = new Map<number, Note>();
      for (const g of [next.R, next.L]) if (g) for (const n of g.notes) if (!active.has(n.midi)) preview.set(n.midi, n);

      const drawKey = (m: number) => {
        const k = keys[m];
        const h = k.black ? kbH * 0.62 : kbH;
        const a = active.get(m);
        const p = preview.get(m);
        ctx.fillStyle = k.black ? '#111827' : '#f8fafc';
        ctx.fillRect(k.x, trackH, k.w, h);
        if (a) {
          ctx.fillStyle = COLORS[a.hand];
          ctx.fillRect(k.x, trackH, k.w, h);
        } else if (p) {
          ctx.fillStyle = hexA(COLORS[p.hand], k.black ? 0.6 : 0.35);
          ctx.fillRect(k.x, trackH, k.w, h);
        }
        if (!k.black) {
          ctx.strokeStyle = '#94a3b8';
          ctx.strokeRect(k.x + 0.5, trackH, k.w, h);
        }
        const n = a ?? p;
        const text = n ? label(n) : !k.black && m % 12 === 0 ? `C${octaveOf(m)}` : '';
        if (text && k.w >= 10) {
          ctx.font = `${n ? 700 : 500} ${Math.min(12, k.w * 0.45)}px system-ui`;
          ctx.textAlign = 'center';
          ctx.fillStyle = n ? (a || k.black ? '#ffffff' : '#0f172a') : '#64748b';
          ctx.fillText(text, k.x + k.w / 2, trackH + h - 6);
        }
      };
      for (let m = lo; m <= hi; m++) if (!keys[m].black) drawKey(m);
      for (let m = lo; m <= hi; m++) if (keys[m].black) drawKey(m);
    };

    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (playingRef.current) {
        beatRef.current += (dt * bpmRef.current) / 60;
                const lp = loopRef.current;
        if (lp && beatRef.current >= lp.end) {
          beatRef.current = lp.start;
          const i = notes.findIndex((n) => n.start >= lp.start);
          nextRef.current = i < 0 ? notes.length : i;
        }
        const beat = beatRef.current;
        while (nextRef.current < notes.length && notes[nextRef.current].start <= beat) {
          const n = notes[nextRef.current++];
          if (soundRef.current) playNote(n.midi, (n.dur * 60) / bpmRef.current);
        }
        if (beat > score.end + 1) {
          playingRef.current = false;
          setPlaying(false);
        }
      }
            const mi = measureIndexAt(score.measures, Math.max(0, beatRef.current));
      if (mi !== measureRef.current) {
        measureRef.current = mi;
        setMeasure(mi);
      }
      draw();
      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [score]);

      const lastMeasure = score.measures.length;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <canvas
        ref={canvasRef}
        onClick={toggle}
        style={{ flex: 1, minHeight: 0, width: '100%', display: 'block', touchAction: 'none' }}
      />
      <Paper square elevation={3} sx={{ px: 1.5, py: 0.5 }}>
        {/* Transport et position */}
        <Stack direction="row" sx={{ alignItems: 'center', gap: 0.5 }}>
          <IconButton
            onClick={() => seek(loopOn ? score.measures[loopRange[0]] : LEAD_IN)}
            aria-label="Revenir au début"
          >
            <SkipPreviousIcon />
          </IconButton>
          <IconButton onClick={() => goToMeasure(measure - 1)} aria-label="Mesure précédente">
            <FastRewindIcon />
          </IconButton>
          <Button variant="contained" onClick={toggle} startIcon={playing ? <PauseIcon /> : <PlayArrowIcon />}>
            {playing ? 'Pause' : 'Lecture'}
          </Button>
          <IconButton onClick={() => goToMeasure(measure + 1)} aria-label="Mesure suivante">
            <FastForwardIcon />
          </IconButton>
          <Slider
            size="small"
            min={1}
            max={lastMeasure}
            value={measure + 1}
            onChange={(_, v) => goToMeasure((v as number) - 1)}
            aria-label="Position"
            sx={{ flex: 1, mx: 1.5 }}
          />
          <Typography variant="body2" sx={{ minWidth: 76, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
            Mes. {measure + 1}/{lastMeasure}
          </Typography>
        </Stack>

        {/* Boucle */}
        <Stack direction="row" sx={{ alignItems: 'center', gap: 1.5 }}>
          <FormControlLabel
            control={
              <Switch
                size="small"
                checked={loopOn}
                onChange={(e) => {
                  setLoopOn(e.target.checked);
                  applyLoop(e.target.checked, loopRange);
                }}
              />
            }
            label="Boucle"
          />
          <Slider
            size="small"
            min={1}
            max={lastMeasure}
            value={[loopRange[0] + 1, loopRange[1] + 1]}
            disableSwap
            onChange={(_, v) => {
              const r = (v as number[]).map((x) => x - 1);
              setLoopRange(r);
              applyLoop(loopOn, r);
            }}
            getAriaLabel={(i) => (i === 0 ? 'Début de boucle' : 'Fin de boucle')}
            sx={{ flex: 1, mx: 1.5 }}
          />
          <Typography variant="body2" sx={{ minWidth: 76, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
            Mes. {loopRange[0] + 1}–{loopRange[1] + 1}
          </Typography>
        </Stack>

        {/* Réglages */}
        <Stack direction="row" sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1.5 }}>
          <Stack direction="row" sx={{ alignItems: 'center', gap: 1.5, flex: 1, minWidth: 220 }}>
            <Typography variant="body2" sx={{ width: 64, fontVariantNumeric: 'tabular-nums' }}>
              {bpm} BPM
            </Typography>
            <Slider
              size="small"
              min={20}
              max={Math.max(200, score.bpm)}
              value={bpm}
              onChange={(_, v) => setBpm(v as number)}
              aria-label="Tempo"
            />
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ width: 40, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
            >
              {Math.round((bpm / score.bpm) * 100)}%
            </Typography>
          </Stack>
          <Stack direction="row" sx={{ alignItems: 'center', gap: 1.5 }}>
            <Typography variant="body2">Espacement</Typography>
            <Slider
              size="small"
              min={40}
              max={260}
              value={ppb}
              onChange={(_, v) => setPpb(v as number)}
              aria-label="Espacement"
              sx={{ width: 100 }}
            />
          </Stack>
          <FormControlLabel
            control={<Switch size="small" checked={showOct} onChange={(e) => setShowOct(e.target.checked)} />}
            label="Octaves"
          />
          <FormControlLabel
            control={<Switch size="small" checked={sound} onChange={(e) => setSound(e.target.checked)} />}
            label={ready ? 'Son' : 'Son (chargement…)'}
          />
        </Stack>
      </Paper>
    </Box>
  );
}