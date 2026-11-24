# `script.json`: the storyboard

`script.json` lists the scenes in order and the narration lines in each scene.
VVV's timeline reads it together with `voice/manifest.json`, which `vvv voice` writes.
[`schema/script.schema.json`](../../../schema/script.schema.json) defines the file, and `vvv validate` checks it.

## Example

```json
{
  "size": [1920, 1080],
  "fps": 30,
  "captions": true,
  "timing": { "lead": 0.5, "gap": 0.35, "tail": 0.6 },
  "voice": {
    "engine": "google",
    "google": { "project": "my-gcp-project", "voice": "Charon", "speakingRate": 1.05 },
    "pronounce": { "en": { "Orito": "[[ ˈ o ʊ ɾ i t o ʊ ]]" } }
  },
  "scenes": [
    { "id": "intro", "lines": [{ "lang": "en", "text": "Meet Orito." }] },
    { "id": "logo", "duration": 4, "transition": 0.6 }
  ]
}
```

## Top level

| Field | Default | Meaning |
|---|---|---|
| `size` | `[1920, 1080]` | Width and height in pixels. Both must be even for H.264. Use `[1080, 1920]` for vertical video. |
| `fps` | `30` | Frames per second. |
| `captions` | `true` | Draw each line's text as a subtitle at the bottom while it plays. |
| `timing` | `{ lead: 0.5, gap: 0.35, tail: 0.8 }` | Seconds of silence before a scene's first line, between its lines, and after its last line. |
| `credits` | none | Text lines for the closing credits card. A voice engine that requires a credit adds its own. |
| `creditsDuration` | `3` | Length of the automatic credits card in seconds. |
| `voice` | piper-plus | The voice engine and pronunciation dictionary. See [voice.md](voice.md). |
| `scenes` | required | The scenes, in order. |

VVV appends a credits card when there is at least one credit, and draws it on the movie's `background`.
To design it yourself, add a scene with the id `credits` to `movie.js`; its draw function reads the lines from `s.timeline.credits`, and `creditsDuration` and a 0.5 s fade still apply.

## Scenes

| Field | Meaning |
|---|---|
| `id` | Unique name of letters, digits, `_`, `-` and `.`. `movie.js` draws the scene under this name. |
| `chapter` | A chapter title. The scene starts a chapter. See [Chapters](#chapters). |
| `lines` | Narration lines, spoken one after another. |
| `duration` | The scene's minimum length in seconds. A scene without lines needs it. |
| `transition` | Seconds of crossfade from the previous scene. The fade overlaps the start of this scene. |
| `lead`, `gap`, `tail` | Override `timing` for this scene. |

A scene lasts until its last line ends plus `tail`, or for `duration`, whichever is longer.
Scenes follow one another without overlap: a transition fades over the start of the new scene, so it does not change the movie's length.

## Lines

| Field | Meaning |
|---|---|
| `lang` | `en`, `ja`, `zh`, `es`, `fr` or `pt`. |
| `text` | What is spoken, and what the subtitle shows unless `caption` says otherwise. May contain `\n` to break the subtitle. |
| `id` | Unique name of letters, digits, `_`, `-` and `.`. Defaults to `<scene id>-<n>`, counting from 1. |
| `speech` | Different text to speak, for one line. The pronunciation dictionary still applies to it. |
| `caption` | A different subtitle, for example a translation, or `false` for none. |
| `who` | The speaker's name, for `movie.js` (for example to open that character's mouth). |
| `voice` | Per-line voice settings. See [voice.md](voice.md). |

## Narrating in one language, subtitling in another

```json
{ "lang": "ja", "text": "来週月曜日、オープンです。", "caption": "We open next Monday." }
```

## Chapters

A scene with a `chapter` title starts a chapter, which lasts until the next scene with a title starts.
The first chapter starts at 0 s even when the first scene has no title, so the chapters cover the whole movie, credits included.

```json
{ "id": "setup", "chapter": "Set up your team", "lines": [{ "lang": "en", "text": "First, invite your team." }] }
```

`vvv info` lists the chapters with their start and end times.
`vvv render` writes them into the MP4 and into the movie's `out/` directory:

- **In the MP4**, as a QuickTime chapter track, which QuickTime Player, Safari on a Mac and VLC list as chapters, though the iPhone's player may not.
- **`out/chapters.vtt`**, a WebVTT chapters file for web players that take one.
- **`out/chapters.txt`**, timestamps to paste into a YouTube description.

Chrome shows no chapters from inside an MP4, so a page that plays the video draws its own chapter list, as [player-page.md](player-page.md) shows.

YouTube shows chapters only when there are at least three and each lasts 10 s or more.
`render` prints a note when the chapters break that rule.

## Fitting a length

`vvv info <dir>` prints each scene's start and end.
The automatic credits card is part of the length; shorten it with `creditsDuration`.
To shorten a video, cut words first, then reduce `lead` and `tail`, then raise the speaking rate a little.
A rate change above about 10 % starts to sound rushed.
