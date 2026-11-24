# Voice engines and pronunciation

`vvv voice <dir>` speaks every line of `script.json` into `<dir>/voice/<line id>.wav` and writes `voice/manifest.json`.
It regenerates a clip only when the line's text or voice settings change, so a good take stays.
`--force` regenerates every clip.

## piper-plus (default)

Offline, free, and quick: about a second per line on a CPU.
It has one voice, Tsukuyomi-chan, a young female voice, which speaks Japanese, English, Chinese, Spanish, French and Portuguese.
It suits casual and cartoon videos; for business narration, prefer `google`.

```json
"voice": { "engine": "piper-plus", "lengthScale": 1.0 }
```

`lengthScale` above 1 slows every line down, and `noise` (default 0.4) sets how much the delivery varies.
`model` names the voice model; `tsukuyomi`, the default, is the only one.

Per line, `voice.pitch` raises (above 1) or lowers (below 1) the voice without changing its speed, and `voice.speed` speeds it up or slows it down.
One voice can play several characters this way: for example, pitch 1.06 for a girl, 0.9 for a boy, and 0.74 with speed 0.92 for an old man.

**Credit and terms.**
Every video that uses this voice must show the credit `Piper Plus:つくよみちゃん`; VVV adds `音声: Piper Plus:つくよみちゃん` to the credits card.
The voice's terms forbid using it to attack people, to advocate for or against a political position, religion or ideology, and to distribute the audio as material for others.
Read the [model card](https://huggingface.co/ayousanz/piper-plus-tsukuyomi-chan) before a video is published.

## google: Chirp 3 HD

Google Cloud Text-to-Speech with Chirp 3 HD voices: natural and professional, in English, Japanese, Chinese, Spanish, French and Portuguese.
No credit line is required.

```json
"voice": {
  "engine": "google",
  "google": { "project": "my-gcp-project", "voice": "Charon", "speakingRate": 1.0 }
}
```

- `project` pays for the requests and needs the Text-to-Speech API: `gcloud services enable texttospeech.googleapis.com --project=<project>`.
- `voice` is a Chirp 3 HD voice name, such as Charon, Orus or Puck (male) and Kore, Aoede or Leda (female).
- Per line, `voice.name` picks another voice and `voice.speakingRate` another rate.

Credentials come from Application Default Credentials.
If a request fails to authenticate, ask the user to run `gcloud auth application-default login`.
A 30-second script costs well under a cent.

Google does not repeat a take exactly, so a regenerated line can come out a little different.
VVV keeps clips until their line changes, so this shows only after an edit.

## The pronunciation dictionary

`voice.pronounce` maps words to how they should be spoken, per language.
VVV applies it to every line's spoken text, including `speech`; subtitles keep the original word.
Matching is case-sensitive.
For Latin text it covers whole words only, so `AI` does not change `AIDS`; Japanese has no word boundaries, so a Japanese entry matches wherever its characters appear.

```json
"pronounce": {
  "en": { "Orito": "[[ ˈ o ʊ ɾ i t o ʊ ]]", "AI": "ay eye", "ID": "eye dee" }
}
```

A value is either a respelling, which replaces the word in the spoken text, or IPA in `[[ ]]`, one symbol per space-separated token.

- **piper-plus** reads the IPA directly, and misreads acronyms such as "AI" ("eye") and "ID" ("id"), so respell them as above.
- **google** sends IPA entries as custom pronunciations, and reads acronyms correctly without help.

Chirp 3 HD accepts only phonemes of the line's language.
English entries need English vowels such as `oʊ` and `iː`; it rejects a bare `o`.

For a Japanese entry, respell the word in hiragana, for example `"渋谷": "しぶや"`.
The `spoke …` lines that `vvv voice` prints show each line's text after the dictionary.

You cannot listen to the result, so be explicit with names: add an entry for every product name and person's name in the narration before the first voice run, and tell the user which entries you added so they can check them by ear.
