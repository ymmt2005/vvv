---
name: make-video
description: Make a narrated MP4 video with VVV, which renders 2D and three.js animation, subtitles, synthesized music and text-to-speech narration in headless Chrome. Use when the user asks to make, create, render or edit a video, movie, short, explainer, intro, promo, demo or animated clip, in English, Japanese or another language.
---

# Make a video with VVV

VVV turns three files into an MP4.
`script.json` is the storyboard: scenes, narration lines, voice and timing.
`music.json` is the score: chords, bass, drums and sound effects, timed by scene and line.
`movie.js` draws each frame.
Schemas in VVV's `schema/` directory define the two JSON files.
Headless Chrome draws frame *i* at time *t = i / fps* and encodes it with WebCodecs, so the result never depends on machine speed.

VVV's root directory is `${CLAUDE_SKILL_DIR}/../..`.
Run the CLI as `node ${CLAUDE_SKILL_DIR}/../../bin/vvv.js <command> <movie-dir>`.
Below, `vvv` means that command.

## Before the first movie

Run `npm install` in VVV's root once, then `vvv setup`.
Setup downloads the pinned voice engine, voice model and Japanese font into `~/.cache/vvv`, and Chromium into Playwright's cache (`~/.cache/ms-playwright`).
It is safe to repeat.
Linux x64 only.

## Workflow

Work through these steps in order.
Each one catches a class of mistakes that is cheaper to fix there than later.

### 1. Settle the brief

Find out the audience, the tone, the length, the languages of narration and subtitles, and the brand.
Ask only for what you cannot find yourself.

- **Facts come from sources:** the product's website and docs, in their wording, never invented features, dates or numbers.
- **Brand assets come from the owner:** real logo files and brand colours from the user's repositories or website, never a redrawn imitation.
- **A fictional brand** gets a palette and a mark that you design to fit the brief.
- **Tone sets the motion and music:** smooth easing and calm music without drums for business, and bounce, sound effects and drums for playful videos.

A tone between the two, such as "warm and friendly", takes smooth motion with one or two gentle accents, for example a single small overshoot on a logo, and calm music with a bell or a pluck.

### 2. Create the movie directory

Put each movie in its own directory, `~/vvv-movies/<short-name>/`, unless the user names another place.
Tell the user the path when you create it.
Do not use the current working directory: it is often a project repository, and a video does not belong in one.
Do not use a temporary or scratchpad directory either.
It gets cleared, and a paid voice engine must then generate the lost clips again.
When the user asks to change an existing movie, work in its directory, so that `vvv voice` keeps the clips of unchanged lines.

The directory holds `script.json`, `music.json`, `movie.js`, and any images or SVG files the movie loads.
VVV writes `voice/` and `out/` there.

### 3. Write the storyboard (`script.json`)

Give each scene one idea and one or two narration lines.
Budget the words: English narration runs at about 2.5 words a second, and Japanese at about 7 characters a second.
The timeline follows the voice clips, so the narration length sets the video length.
The credits card counts too: with piper-plus, VVV appends one (3 s unless `creditsDuration` says otherwise).

Subtitles follow the narration by default.
To narrate in one language and subtitle in another, put the spoken text in `text` and the subtitle in `caption`, as [references/script-json.md](references/script-json.md) shows.

Give scenes chapter titles when the user asks for chapters, or when a longer video has parts that a viewer may want to jump to.

Read [references/script-json.md](references/script-json.md) for every field.
Then run `vvv validate <dir>` and fix what it reports.
Every message names the field and suggests the closest valid name for a misspelt one.

### 4. Generate the voice

Choose the engine with the user when quality matters:

- `piper-plus` (default): offline and free, with one young female voice for Japanese and English that suits casual videos; it requires a credit line, which VVV adds.
- `google`: Google Cloud Chirp 3 HD, with natural, professional voices billed to a GCP project.

Then run `vvv voice <dir>`.
It speaks only the lines whose text or voice settings changed.
It validates `script.json` first, and stops before calling an engine when the file has errors.

**Pronunciation is the most common defect, and you cannot hear the result.**
Text-to-speech engines read unfamiliar names and some acronyms wrongly: piper-plus spelled "Orito" as "O-R-I-T-O" and read "AI" as "eye".
Before the first voice run, list every product name, person's name and acronym in the narration, and add entries for them to `voice.pronounce`.
[references/voice.md](references/voice.md) explains the dictionary and what each engine accepts.

### 5. Compose the music (`music.json`)

Write the score: a chord progression on `pad` or `keys`, a bass line, drums for a playful video, and sound effects at the moments they belong to, timed by their scene or line.

Read [references/music.md](references/music.md) for the fields and the instruments, then run `vvv validate <dir>`.
It checks the score against `script.json` too, such as the scenes and lines that its times name.

### 6. Draw the movie (`movie.js`)

Write a draw function per scene.
Keep it a pure function of time: use the `t` the runtime passes in and `rng(seed)` from `vvv`, never `Date.now()`, `performance.now()` or `Math.random()`.
A frame that depends on anything else renders differently in preview, check and render.

Leave the bottom of the frame clear when subtitles are on: they take about the lowest 200 px of 1080.
Put explicit `\n` in Japanese subtitle text where a line should break, because automatic breaks can split a word.

Read [references/movie-js.md](references/movie-js.md) for the drawing API, the three.js layer and images.
To move something in step with a sound, such as a dog that jumps on each bark, read the sound's times with `s.notes(name)`.

Then run `vvv validate <dir>`.
It checks the names in `movie.js` against `script.json`, such as scene ids and fields, and draws the first, middle and last frame of each scene.

### 7. Look at frames, then fix

Run `vvv frames <dir>` and read `<dir>/out/sheet.png` with the Read tool.
It is a grid of thumbnails, each labelled with its time and scene.
Look for clipped or overlapping text, elements under the subtitles, empty or broken scenes, and anything off-brand.
Use `--at 1.2,4.5` to look at chosen moments, such as each line's start and each transition.
Add `--full` to also write each of those frames at full size, as `<dir>/out/frame-<t>.png`, when a thumbnail is too small to judge.
`vvv info <dir>` prints the timeline, which gives the times worth checking: they count from the start of the movie, while `s.line()` in `movie.js` counts from the start of the scene.
`info` needs only `script.json` and the voice clips, so it also works before `movie.js` exists.

Repeat until the frames look right.
This loop is how you see the video; skip it and defects reach the user.

### 8. Check every frame

Run `vvv check <dir>`.
It validates the movie, then draws every frame without encoding and reports draw errors with their time range, and text that overflows its box.
A contact sheet samples only some frames, so a bug that shows at one moment, such as an array index that goes out of range before an animation starts, passes `frames` and fails here.
Fix every error and warning, then run it again.

### 9. Render and deliver

Run `vvv render <dir>`.
It writes `<dir>/out/<dir-name>.mp4` with H.264 video and Opus audio, and prints the video's length.
Confirm that it is the length the user asked for.

When the Artifact tool is available, publish a small page that plays the video: pass the MP4, and a poster frame from `vvv frames --at <t> --full`, as supporting files.
When the movie has chapters, give the page a chapter list as [player-page.md](references/player-page.md) shows.
After a re-render, pass the MP4 again when you republish: a publish that leaves the file out keeps the old video.
Copy the chapters from `vvv info` into the page again too, because their times move when the voice changes.
Say which voice engine and voice spoke, and list anything the user should check by ear, such as the pronunciation of names.

## When the user asks for changes

Edit the storyboard, the score or `movie.js`, then repeat from the step the change affects.
A text change needs `vvv voice` again; a drawing or music change needs only validate, frames, check and render.
Re-render after every change before you show the video again.
