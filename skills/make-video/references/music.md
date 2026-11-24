# `music.json`: music and sound effects

`music.json` in the movie directory is the score.
VVV plays it on its own Web Audio synthesizer, mixes in the narration, and lowers the music while anyone speaks.
A movie without `music.json` has no music.
[`schema/music.schema.json`](../../../schema/music.schema.json) defines the file, and `vvv validate` checks it.

Patterns repeat to the end of the movie by themselves, and a time can name a scene or a line, so the score never needs to know how long the movie is.

```json
{
  "bpm": 100,
  "gain": 0.7,
  "tracks": [
    { "inst": "pad", "gain": 0.75, "reverb": 0.5, "progression": ["Cmaj7", "Am7", "Fmaj7", "G"], "vel": 0.65 },
    { "inst": "keys", "gain": 0.4, "progression": ["Cmaj7", "Am7", "Fmaj7", "G"], "style": "pulse", "step": 2, "octave": 4, "from": "connect" },
    { "inst": "bass", "gain": 0.5, "roots": ["Cmaj7", "Am7", "Fmaj7", "G"], "step": 4 },
    { "inst": "swell", "unit": "seconds", "at": "title - 1.2", "notes": [[0, 1.2, "C4", 0.7]] },
    { "inst": "bell", "unit": "seconds", "reverb": 0.6, "at": "title + 1.6", "notes": [[0, 2, ["C5", "G5", "E6"], 0.6]] }
  ]
}
```

## The score

| Field | Default | Meaning |
|---|---|---|
| `bpm` | `100` | Tempo in beats per minute. |
| `gain` | `0.8` | Music level under the narration. |
| `duck` | `0.45` | Music level while someone speaks, as a fraction of `gain`. |
| `fadeOut` | `1.5` | Seconds of fade at the end of the movie. |
| `tracks` | | The tracks. |

## Tracks

A track plays one instrument.
Its notes come from exactly one of `notes`, `progression`, `roots` and `drums`.

| Field | Applies to | Meaning |
|---|---|---|
| `inst` | all | The instrument. See [Instruments](#instruments). |
| `name` | all | A name that `movie.js` uses to find the track's notes. See [Sounds in step with the picture](#sounds-in-step-with-the-picture). |
| `gain` | all | Level, from 0 to 2. Default 1. |
| `pan` | all | From −1 (left) to 1 (right). Default 0. |
| `reverb`, `delay` | all | Send levels to the reverb and the echo, from 0 to 1. Default 0. |
| `from`, `until` | all | Play only the notes that start at or after `from`, and before `until`. See [Times](#times). |
| `notes` | | Notes as `[at, length, pitch, velocity]`, in beats from `at`. `velocity` runs from 0 to 1 and defaults to 0.8. |
| `unit` | `notes` | `"seconds"` measures the notes in seconds instead of beats, which suits sound effects. |
| `at` | `notes` | When the track's notes count from. Default 0, the start of the movie. |
| `progression` | | Chord symbols, each held for `beats`, repeated to the end of the movie. |
| `roots` | | Chord symbols, played as a bass line on their roots. A slash chord plays its bass note, so `"C"`, `"G/B"`, `"Am"` walks down. |
| `drums` | | A pattern, one character per `step`: `x` a hit, `o` a soft hit, `.` a rest. `"x...x...x...x..."` is a kick on every beat. |
| `beats` | `progression`, `roots` | Beats per chord, at least 0.25. Default 4. |
| `octave` | `progression`, `roots` | The octave of the chords' roots. Default 3 for `progression` and 2 for `roots`. |
| `style` | `progression` | `"block"` holds each chord (default), `"pulse"` repeats it every `step` beats, and `"arp"` plays it one note at a time. |
| `step` | `progression`, `roots`, `drums` | Beats between notes, at least 0.125: default 0.5 for `pulse` and `arp`, a whole chord for `roots`, and 0.25 for `drums`. |
| `vel` | `progression`, `roots` | Velocity of every note. Default 0.8 for `progression` and 0.9 for `roots`. |
| `shift` | `progression`, `roots`, `drums` | Beats to move every note by; 0.5 puts a pulse on the off-beat. |
| `length` | `progression`, `roots`, `drums` | Every note's length in beats, for a shorter, more staccato sound. |

Patterns (`progression`, `roots` and `drums`) run on the beat grid from the start of the movie.
Their `from` and `until` snap to the nearest beat, so a part that enters at a scene still enters on the beat.

## Times

`at`, `from` and `until` take a time in one of these forms:

- A number: seconds from the start of the movie, such as `2.4`.
- A scene or line id: when that scene or line starts, such as `"title"` or `"kids-1"`.
- An id with an offset in seconds, with spaces around the sign: `"title + 1.6"` or `"bark - 0.6"`.

Tie every sound effect to a scene or a line.
The narration sets each scene's length, so a fixed number of seconds drifts out of place whenever a line changes.

## Pitches and chords

A pitch is a MIDI note number or a name such as `"C4"`, `"F#3"` or `"Bb2"`, where C4 is middle C.
An array of pitches plays a chord: `["C5", "G5", "E6"]`.

Chord symbols take a root, a quality and an optional slash bass: `"C"`, `"Am"`, `"G7"`, `"Fmaj7"`, `"Dm7"`, `"Bb"`, `"Csus4"`, `"Cadd9"`, `"C/E"`.
The qualities are `M`, `m`, `dim`, `aug`, `sus2`, `sus4`, `6`, `m6`, `7`, `maj7`, `M7`, `m7`, `m7b5`, `add9`, `madd9`, `9`, `maj9` and `m9`.

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

## Sounds in step with the picture

Give a track a `name`, and a scene's `draw` gets that track's notes from `s.notes(name)`, timed like `s.line()`: from the start of the scene.
Draw from those times rather than copying them into `movie.js`, so that the picture follows when the score changes.

```json
{ "inst": "bark", "name": "barks", "unit": "seconds", "at": "bark", "notes": [[0.35, 0.25, "F#4", 1], [0.7, 0.25, "F#4", 1]] }
```

```js
const barks = s.notes('barks').map((n) => n.start);
const jumping = barks.some((b) => s.t >= b && s.t < b + 0.3);
```

`s.music` holds the whole expanded score, or `null` without `music.json`.
It has `bpm` and `tracks`, and each track has `inst`, `name` and `notes`.
A note there has `time` and `len` in seconds from the start of the movie, `pitch` (an array of MIDI numbers) and `vel`.
Use it for motion on the beat: one beat lasts `60 / s.music.bpm` seconds.

## Choosing the music

Match the tone of the brief.
A business video wants a slow tempo (90–100 bpm), `pad` with soft `keys` and `bass`, and no drums; a single `bell` can mark the logo.
A playful video can take `pluck`, drums, faster tempos and sound effects.
Keep the music under the voice: the narration carries the message.
