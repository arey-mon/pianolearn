import JSZip from 'jszip';
import { Midi } from '@tonejs/midi';

export type Hand = 'R' | 'L';
export type Note = { midi: number; start: number; dur: number; hand: Hand; name: string };
export type Score = { title: string; notes: Note[]; bpm: number; end: number; measures: number[] };
const STEP: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const EN_CHROMA = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const txt = (el: Element, sel: string) => el.querySelector(sel)?.textContent?.trim() ?? '';

function finish(title: string, notes: Note[], bpm: number, measures: number[] = [], beatsPerMeasure = 4): Score {
  notes.sort((a, b) => a.start - b.start || a.midi - b.midi);
  const end = notes.reduce((m, n) => Math.max(m, n.start + n.dur), 0);
  if (measures.length === 0) {
    for (let b = 0; b < Math.max(end, 1); b += beatsPerMeasure) measures.push(b);
  }
  return { title, notes, bpm: Math.round(bpm), end, measures };
}

export function parseMusicXml(xml: string, fallbackTitle: string): Score {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Fichier MusicXML illisible');
  const root = doc.documentElement;
  const title = txt(root, 'work-title') || txt(root, 'movement-title') || fallbackTitle;
  const tempoEl = doc.querySelector('sound[tempo]');
  const bpm = tempoEl ? Number(tempoEl.getAttribute('tempo')) || 80 : 80;
  const notes: Note[] = [];
    const measures: number[] = [];

  Array.from(doc.querySelectorAll('part')).forEach((part, pi) => {
    let divisions = 1;
    let t = 0;
    let lastStart = 0;
    const openTies = new Map<string, Note>();

    for (const measure of Array.from(part.children)) {
      if (measure.tagName !== 'measure') continue;
            if (pi === 0) measures.push(t);
      for (const el of Array.from(measure.children)) {
        if (el.tagName === 'attributes') {
          const d = txt(el, 'divisions');
          if (d) divisions = Number(d);
        } else if (el.tagName === 'backup') {
          t -= Number(txt(el, 'duration')) / divisions;
        } else if (el.tagName === 'forward') {
          t += Number(txt(el, 'duration')) / divisions;
        } else if (el.tagName === 'note') {
          if (el.querySelector('grace, cue')) continue;
          const dur = Number(txt(el, 'duration')) / divisions;
          const isChord = !!el.querySelector('chord');
          const start = isChord ? lastStart : t;
          if (!isChord) { lastStart = t; t += dur; }

          const pitch = el.querySelector('pitch');
          if (!pitch) continue; // silence

          const step = txt(pitch, 'step');
          const alter = Number(txt(pitch, 'alter') || 0);
          const octave = Number(txt(pitch, 'octave'));
          const midi = (octave + 1) * 12 + STEP[step] + alter;
          const staff = Number(txt(el, 'staff') || 1);
          const hand: Hand = staff >= 2 || pi > 0 ? 'L' : 'R';

          // Notes liées : on prolonge la note d'origine au lieu d'en créer une nouvelle
          const ties = Array.from(el.querySelectorAll('tie')).map((x) => x.getAttribute('type'));
          const key = `${pi}-${staff}-${midi}`;
          const prev = openTies.get(key);
          if (ties.includes('stop') && prev) {
            prev.dur = start + dur - prev.start;
            if (!ties.includes('start')) openTies.delete(key);
            continue;
          }

                    const acc = txt(el, 'accidental');
          const name = step + (alter > 0 ? '#'.repeat(alter) : alter < 0 ? 'b'.repeat(-alter) : acc === 'natural' ? '♮' : '');
          const n: Note = { midi, start, dur, hand, name };
          notes.push(n);
          if (ties.includes('start')) openTies.set(key, n);
        }
      }
    }
  });

    return finish(title, notes, bpm, measures);
}

export function parseMidi(buf: ArrayBuffer, fallbackTitle: string): Score {
  const midi = new Midi(buf);
  const ppq = midi.header.ppq;
  const tracks = midi.tracks.filter((tr) => tr.notes.length > 0);
  const notes: Note[] = tracks.flatMap((tr, i) =>
    tr.notes.map((n) => ({
      midi: n.midi,
      start: n.ticks / ppq,
      dur: n.durationTicks / ppq,
      hand: (tracks.length > 1 ? (i === 0 ? 'R' : 'L') : n.midi >= 60 ? 'R' : 'L') as Hand,
            name: EN_CHROMA[n.midi % 12],
    }))
  );
    const ts = midi.header.timeSignatures[0]?.timeSignature ?? [4, 4];
  return finish(midi.name || fallbackTitle, notes, midi.header.tempos[0]?.bpm ?? 80, [], (ts[0] * 4) / ts[1]);
}

export async function loadScoreFile(file: File): Promise<Score> {
  const base = file.name.replace(/\.[^.]+$/, '');
  const ext = file.name.split('.').pop()?.toLowerCase();

  if (ext === 'mid' || ext === 'midi') return parseMidi(await file.arrayBuffer(), base);

  if (ext === 'mxl') {
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const container = await zip.file('META-INF/container.xml')?.async('string');
    let path = container?.match(/full-path="([^"]+)"/)?.[1];
    if (!path) path = Object.keys(zip.files).find((p) => !p.startsWith('META-INF') && /\.(xml|musicxml)$/i.test(p));
    const xml = path ? await zip.file(path)?.async('string') : undefined;
    if (!xml) throw new Error('Archive .mxl sans partition');
    return parseMusicXml(xml, base);
  }

  if (ext === 'xml' || ext === 'musicxml') return parseMusicXml(await file.text(), base);

  throw new Error('Format non pris en charge (MusicXML, .mxl ou MIDI)');
}
