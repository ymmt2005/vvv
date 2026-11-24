# VVV

VVV makes narrated videos in Chrome.
A movie is a storyboard (`script.json`) plus drawing and music code (`movie.js`).
Headless Chrome draws every frame from its time alone, encodes it with WebCodecs, and writes an MP4.

## Setup

Linux x64 and Node.js 24 or later.

```sh
npm install
node bin/vvv.js setup   # piper-plus, the Tsukuyomi-chan voice, Noto Sans JP, Playwright Chromium
```

The downloads go to `~/.cache/vvv`, or `$VVV_CACHE` when it is set (`$XDG_CACHE_HOME/vvv` when only that is set).
Chromium goes to Playwright's own cache.

## Make a movie

```sh
node bin/vvv.js voice   examples/wonderful-day   # speak the narration lines into voice/
node bin/vvv.js frames  examples/wonderful-day   # contact sheet in out/sheet.png
node bin/vvv.js check   examples/wonderful-day   # draw every frame; report errors and text overflow
node bin/vvv.js render  examples/wonderful-day   # out/wonderful-day.mp4
node bin/vvv.js preview examples/wonderful-day   # player with play and seek, on http://localhost:8573/
```

The MP4 holds H.264 video and Opus audio.
Chrome on Linux cannot encode AAC.

[`skills/make-video/references/`](skills/make-video/references/) documents `script.json`, `movie.js`, the music score and the voice engines.

## Use it from Claude Code

The repository is a Claude Code plugin with one skill, `make-video`.
Install it from the marketplace this repository defines:

```
/plugin marketplace add ymmt2005/vvv
/plugin install vvv@vvv
```

To try a local checkout without installing it, start Claude Code with `claude --plugin-dir <path to this repository>`.
Then ask for a video, or run `/vvv:make-video`.

## Voice engines

- `piper-plus` (default) runs offline and speaks Japanese, English and four more languages in one voice.
- `google` uses Google Cloud Text-to-Speech with Chirp 3 HD voices, billed to a GCP project.

A per-language pronunciation dictionary in `script.json` fixes names and acronyms that an engine misreads.
See [voice.md](skills/make-video/references/voice.md).

## Tests

```sh
npm test
```

Unit tests run in Node.
End-to-end tests render the fixture movies in `test/fixtures/` in headless Chrome, and decode the results with WebCodecs.

## Third-party parts

- [three.js](https://threejs.org/) 0.187.0, in `runtime/vendor/three` (MIT).
- [piper-plus](https://github.com/ayutaz/piper-plus) 2.1.0 for speech, downloaded by `setup`.
- The Tsukuyomi-chan zs-v1 voice model, downloaded by `setup`.
  Every video that uses it must show the credit `Piper Plus:つくよみちゃん`; VVV adds it to the credits card.
  Read the [model terms](https://huggingface.co/ayousanz/piper-plus-tsukuyomi-chan) before you publish a video.
- [Noto Sans JP](https://fonts.google.com/noto/specimen/Noto+Sans+JP) (SIL Open Font License), downloaded by `setup`.
- [Playwright](https://playwright.dev/) drives headless Chrome.
