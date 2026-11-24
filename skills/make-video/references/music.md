# Music and sound effects

`music(timeline)` in `movie.js` returns a score.
VVV renders it with its own Web Audio synthesizer, mixes in the narration, and lowers the music while anyone speaks.
The music is code, so it can follow the timeline exactly: a section can start with a scene, and a sound effect can land on an event.

```js
import { progression, roots, drums } from 'vvv';

music(timeline) {
  const bpm = 100;
  const beat = 60 / bpm;
  const bars = Math.ceil(timeline.duration / beat / 4);
  const chords = ['Cmaj7', 'Am7', 'Fmaj7', 'G'];
  const reps = Math.ceil(bars / 4);
  const title = timeline.scenes.find((x) => x.id === 'title');
  return {
    bpm,
    tracks: [
      { inst: 'pad', gain: 0.75, reverb: 0.5, notes: progression(chords, { octave: 3, repeat: reps }) },
      { inst: 'keys', gain: 0.4, reverb: 0.4, notes: progression(chords, { style: 'pulse', step: 2, octave: 4, repeat: reps, vel: 0.45 }) },
      { inst: 'bass', gain: 0.5, notes: roots(chords, { step: 4, octave: 2, repeat: reps }) },
      { inst: 'bell', unit: 'seconds', reverb: 0.6, notes: [[title.start + 1.6, 2, ['C5', 'G5', 'E6'], 0.6]] },
    ],
  };
},
```

## The score

| Field | Default | Meaning |
|---|---|---|
| `bpm` | `100` | Tempo, for tracks in beats. |
| `gain` | `0.8` | Music level under the narration. |
| `duck` | `0.45` | Music level while someone speaks, as a fraction of `gain`. |
| `fadeOut` | `1.5` | Seconds of fade at the end of the movie. |
| `tracks` | | The tracks. |

A track is `{ inst, notes, gain?, pan?, reverb?, delay?, unit? }`.
`reverb` and `delay` are send levels from 0 to 1, and `pan` runs from −1 (left) to 1 (right).
`unit: 'seconds'` places the notes in seconds instead of beats, which suits sound effects tied to the timeline.

A note is `[at, length, pitch, velocity]`.
`pitch` is a MIDI number, a name such as `'C#4'`, or an array of them for a chord; `velocity` runs from 0 to 1.

## Instruments

| Instrument | Sound |
|---|---|
| `pad` | Warm, slow-attack chords. The base of calm music. |
| `keys` | Soft electric piano. |
| `bell` | Bright bell with a long decay, for a reveal. |
| `pluck` | Plucked string. |
| `bass` | Round bass. |
| `lead` | Soft melody voice. |
| `kick`, `snare`, `hat` | Drums. |
| `swell` | Rising noise sweep, to lead into a transition. |
| `bark` | A dog's bark; the pitch sets the dog's size. |
| `boing` | Cartoon spring sound. |

## Helpers from `'vvv'`

- `chord('Am7', octave)` and `scale('C4', 'major')(degree)` give MIDI notes.
- Chord symbols take qualities such as `m`, `7`, `maj7`, `m7`, `sus4` and `add9`, and a slash bass such as `'C/E'`.
- `progression(chords, { beats, octave, style, step, repeat, vel })` turns chord symbols into notes: `style` is `'block'` (held), `'pulse'` (repeated every `step` beats) or `'arp'` (one note at a time).
- `roots(chords, {...})` gives a bass line on the chords' roots, with slash chords walking on their bass note.
- `drums('x...x...', { step, repeat })` gives hits from a pattern: `x` is a hit, `o` a soft hit, `.` a rest.

## Choosing the music

Match the tone of the brief.
A business video wants a slow tempo (90–100 bpm), `pad` with soft `keys` and `bass`, and no drums; a single `bell` can mark the logo.
A playful video can take `pluck`, drums, faster tempos and sound effects.
Keep the music under the voice: the narration carries the message.
