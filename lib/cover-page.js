// The cover page's script. lib/cover.js inlines it into out/index.html, inside a function that
// first defines clock(seconds), the time format of lib/chapters.js.
// The page's data is the JSON in <script id="cover-data">: { duration, chapters: [{ title, start }], text }.

const DATA = JSON.parse(document.getElementById('cover-data').textContent);
const T = DATA.text;
const $ = (id) => document.getElementById(id);
const player = $('player');
const video = $('video');
const play = $('play');
const seek = $('seek');
const mute = $('mute');
const volume = $('volume');
const speed = $('speed');
const fullPage = $('full-page');
const fullScreen = $('full-screen');
const items = [...document.querySelectorAll('#chapters li')];

const show = (el, on) => el.toggleAttribute('hidden', !on);
/** Set a control's label, keeping the shortcut key that its title ends with, such as " (k)". */
const label = (el, text) => {
  el.setAttribute('aria-label', text);
  const key = / \(.\)$/.exec(el.title);
  el.title = text + (key ? key[0] : '');
};
const fill = (el, ratio) => el.style.setProperty('--fill', `${(ratio * 100).toFixed(2)}%`);
const isFullPage = () => document.body.classList.contains('full-page');

// Playing and pausing.
const toggle = () => (video.paused || video.ended ? video.play() : video.pause());
$('big-play').addEventListener('click', () => video.play());
play.addEventListener('click', toggle);
// On a touch screen, a tap on the picture while the controls are hidden only shows them.
let tapShowsControls = false;
player.addEventListener('pointerdown', (e) => {
  tapShowsControls = e.pointerType !== 'mouse' && player.classList.contains('idle');
  wake();
});
video.addEventListener('click', () => { if (!tapShowsControls) toggle(); });
const showPlaying = () => {
  const on = !video.paused && !video.ended;
  if (on) player.classList.add('started');
  show(play.querySelector('.i-play'), !on);
  show(play.querySelector('.i-pause'), on);
  label(play, on ? T.pause : T.play);
  wake();
};
video.addEventListener('play', showPlaying);
video.addEventListener('pause', showPlaying);
video.addEventListener('ended', showPlaying);

// The position, the seek bar and the chapters.
let seeking = false;
const showTime = (t) => {
  $('now').textContent = clock(t);
  if (!seeking) seek.value = String(t);
  fill(seek, t / DATA.duration);
  const current = DATA.chapters.findLastIndex((c) => t >= c.start);
  items.forEach((li, i) => li.classList.toggle('current', i === current));
  $('now-chapter').textContent = current >= 0 ? DATA.chapters[current].title : '';
};
const goTo = (t) => {
  const to = Math.min(DATA.duration, Math.max(0, t));
  video.currentTime = to;
  showTime(to);
};
seek.addEventListener('input', () => { seeking = true; goTo(Number(seek.value)); });
seek.addEventListener('change', () => { seeking = false; });
video.addEventListener('timeupdate', () => showTime(video.currentTime));
items.forEach((li, i) => li.querySelector('button').addEventListener('click', () => { goTo(DATA.chapters[i].start); video.play(); }));

// Sound and speed.
const showVolume = () => {
  const silent = video.muted || video.volume === 0;
  show(mute.querySelector('.i-sound'), !silent);
  show(mute.querySelector('.i-muted'), silent);
  label(mute, silent ? T.unmute : T.mute);
  volume.value = String(video.muted ? 0 : video.volume);
  fill(volume, video.muted ? 0 : video.volume);
};
mute.addEventListener('click', () => { video.muted = !video.muted; if (!video.muted && video.volume === 0) video.volume = 1; });
volume.addEventListener('input', () => { video.volume = Number(volume.value); video.muted = video.volume === 0; });
video.addEventListener('volumechange', showVolume);
// iPhone and iPad ignore a script that sets the volume, so the slider would do nothing there.
video.volume = 0.5;
if (video.volume !== 0.5) player.classList.add('fixed-volume');
video.volume = 1;
// Leave the keyboard to the shortcuts once a speed is picked.
speed.addEventListener('change', () => { video.playbackRate = Number(speed.value); speed.blur(); });

// Full page: the player fills the browser window. Full screen: it fills the screen.
const setFullPage = (on) => {
  document.body.classList.toggle('full-page', on);
  fullPage.setAttribute('aria-pressed', String(on));
  label(fullPage, on ? T.exitFullPage : T.fullPage);
};
fullPage.addEventListener('click', () => setFullPage(!isFullPage()));
const inFullScreen = () => document.fullscreenElement === player;
/** Where the page cannot go full screen, such as on iPhone or in a frame that forbids it, show the video full screen or fill the window. */
const fallBack = () => {
  if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();
  else setFullPage(true);
};
const toggleFullScreen = () => {
  if (inFullScreen()) document.exitFullscreen();
  else if (document.fullscreenEnabled && player.requestFullscreen) player.requestFullscreen().catch(fallBack);
  else fallBack();
};
fullScreen.addEventListener('click', toggleFullScreen);
document.addEventListener('fullscreenchange', () => {
  const on = inFullScreen();
  fullScreen.setAttribute('aria-pressed', String(on));
  show(fullScreen.querySelector('.i-enter'), !on);
  show(fullScreen.querySelector('.i-exit'), on);
  label(fullScreen, on ? T.exitFullScreen : T.fullScreen);
});

// While the video plays, the controls hide after a moment without pointer movement.
let idleTimer = 0;
function wake() {
  player.classList.remove('idle');
  clearTimeout(idleTimer);
  if (!video.paused) idleTimer = setTimeout(() => player.classList.add('idle'), 2500);
}
player.addEventListener('pointermove', wake);
player.addEventListener('focusin', wake);

// Keyboard shortcuts. The arrow keys seek by 5 s, also when the seek bar has focus;
// only the volume slider and the speed menu keep their own arrow keys.
document.addEventListener('keydown', (e) => {
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  const own = e.target === volume || e.target === speed;
  switch (e.key) {
    case ' ': if (e.target.closest('button') || own) return; toggle(); break;
    case 'k': toggle(); break;
    case 'ArrowLeft': if (own) return; goTo(video.currentTime - 5); break;
    case 'ArrowRight': if (own) return; goTo(video.currentTime + 5); break;
    case 'm': video.muted = !video.muted; break;
    case 'f': toggleFullScreen(); break;
    case 'p': setFullPage(!isFullPage()); break;
    case 'Escape': if (isFullPage() && !inFullScreen()) setFullPage(false); else return; break;
    default: return;
  }
  e.preventDefault();
  wake();
});

showTime(0);
showVolume();
