# A page that plays the video, with chapters

Chrome shows no chapters from inside an MP4, so a page that plays a VVV movie draws its own chapter list.
The page holds the chapters itself, copied from the `chapters` that `vvv info <dir>` prints.
It does not load `chapters.vtt`: a browser refuses a track file from another origin or into a sandboxed page, and the list would stay empty.

Publish the MP4 and a poster frame as supporting files under the names that the markup uses, or change the names in the markup.
Adapt the markup and script to the page's design:

```html
<video id="video" controls playsinline preload="metadata" poster="poster.png" src="movie.mp4"></video>
<ol id="chapters"></ol>
<script>
  // The "chapters" from `vvv info <dir>`, as they are.
  const CHAPTERS = [
    { "title": "Why teams stall", "start": 0, "end": 12.4 },
    { "title": "Set up your team", "start": 12.4, "end": 31.9 }
  ];
  const video = document.getElementById('video');
  const list = document.getElementById('chapters');
  const clock = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

  const items = CHAPTERS.map((c) => {
    const button = document.createElement('button');
    button.textContent = `${clock(c.start)}  ${c.title}`;
    button.onclick = () => { video.currentTime = c.start; video.play(); };
    const item = document.createElement('li');
    item.append(button);
    list.append(item);
    return item;
  });

  function showCurrent() {
    const current = CHAPTERS.findLastIndex((c) => video.currentTime >= c.start);
    items.forEach((item, i) => item.classList.toggle('current', i === current));
  }
  video.addEventListener('timeupdate', showCurrent);
  showCurrent();
</script>
```

Style `li.current` so that the chapter now playing stands out.
