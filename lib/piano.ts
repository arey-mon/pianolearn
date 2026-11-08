let Tone: typeof import('tone') | null = null;
let sampler: import('tone').Sampler | null = null;

export async function preloadPiano() {
  if (sampler) return;
  Tone = await import('tone');
  const urls: Record<string, string> = { A0: 'A0.mp3', C8: 'C8.mp3' };
  for (let o = 1; o <= 7; o++) {
    for (const [n, f] of [['C', 'C'], ['D#', 'Ds'], ['F#', 'Fs'], ['A', 'A']]) {
      urls[`${n}${o}`] = `${f}${o}.mp3`;
    }
  }
  sampler = new Tone.Sampler({
    urls,
    baseUrl: 'https://tonejs.github.io/audio/salamander/',
    release: 1,
  }).toDestination();
  await Tone.loaded();
}

// À appeler directement dans un clic (obligatoire sur iPhone pour activer le son)
export function unlockAudio() {
  Tone?.start();
}

export function playNote(midi: number, seconds: number) {
  if (!Tone || !sampler?.loaded) return;
  sampler.triggerAttackRelease(Tone.Frequency(midi, 'midi').toNote(), seconds, undefined, 0.7);
}
