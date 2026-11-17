/**
 * CourtScribe 30-second POV walkthrough — reproducible pipeline.
 *
 *   1. Generates audio assets with macOS `say` (voiceover + a synthetic speech file used as the
 *      fake microphone, so the level meter and the downloaded recording are real).
 *   2. Captures the REAL app with Playwright (local Chrome, 1920×1080), following the beat sheet.
 *   3. Composes the final MP4 inside Chrome: captured footage + captions + cursor + subtle zooms
 *      + voiceover, encoded with Chrome's built-in H.264/AAC MediaRecorder.
 *
 * Usage:  DEMO_BASE_URL=http://localhost:5173 node demo/make-video.mjs
 * Needs:  `npm run dev` already running (app + ws server), macOS, Google Chrome.
 * Output: demo/output/courtscribe-walkthrough.mp4, thumbnail.png, the downloaded recording, timeline.json
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import WebSocket from 'ws';

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = join(ROOT, 'output');
const BASE = process.env.DEMO_BASE_URL ?? 'http://localhost:5173';
const WS = process.env.DEMO_STREAM_URL ?? 'ws://localhost:8787';
const VOICE = process.env.DEMO_VOICE ?? 'Daniel';
const W = 1920, H = 1080, DURATION = 30;

// ---------------- beat sheet ----------------
export const BEATS = [
  { at: 0, caption: 'Your courtroom workspace', vo: 'This is CourtScribe, my workspace for today’s hearing.' },
  { at: 4, caption: 'Start recording proceedings', vo: 'I pick my microphone and start recording the proceedings.' },
  { at: 9, caption: 'Follow incoming transcript segments', vo: 'Segments arrive from a separate demo stream, with speakers and timestamps.' },
  { at: 15, caption: 'Find statements instantly', vo: 'I search for “Exhibit”, and jump straight to the statement.' },
  { at: 20, caption: 'Save your courtroom audio', vo: 'Pause, resume, then stop, and download the audio.' },
  { at: 25, caption: 'CourtScribe — A more reliable courtroom workflow', vo: 'The stream is connected, and the reliability dashboard tracks it.' },
];

const MIC_SCRIPT = [
  'Witness, please state your name for the record.', '[[slnc 700]]',
  'My name is Rajesh Kumar.', '[[slnc 900]]',
  'Where were you on the evening of the incident?', '[[slnc 700]]',
  'I was at home. I heard a sound and went outside.', '[[slnc 900]]',
  'Please look at Exhibit P3. Have you seen this document before?', '[[slnc 700]]',
  'Yes. That is my signature.', '[[slnc 900]]',
  'The court will note the answer. Counsel, you may continue.',
].join(' ');

function sh(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8' });
}
function wavDuration(file) {
  const m = sh('afinfo', [file]).match(/estimated duration: ([\d.]+)/);
  return m ? Number(m[1]) : NaN;
}

// ---------------- 1. audio assets ----------------
function makeAudio() {
  const voice = BEATS.map((b, i) => {
    const file = join(OUT, `vo-${i}.wav`);
    sh('say', ['-v', VOICE, '-r', '175', '--file-format=WAVE', '--data-format=LEI16@48000', '-o', file, b.vo]);
    const seconds = wavDuration(file);
    const slot = (BEATS[i + 1]?.at ?? DURATION) - b.at - 0.4;
    if (seconds > slot) console.warn(`  ! voiceover ${i} is ${seconds.toFixed(1)}s for a ${slot.toFixed(1)}s slot`);
    return { file, seconds, at: b.at + 0.3 };
  });
  const mic = join(OUT, 'fake-mic-synthetic-speech.wav');
  sh('say', ['-v', 'Rishi', '-r', '165', '--file-format=WAVE', '--data-format=LEI16@48000', '-o', mic, MIC_SCRIPT]);
  return { voice, mic };
}

// ---------------- stream server setup (harness only) ----------------
function configureServer(config) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS);
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'config', config }));
      setTimeout(() => (ws.close(), resolve()), 150);
    });
    ws.on('error', reject);
  });
}

// ---------------- 2. capture ----------------
const CURSOR_SCRIPT = `(() => {
  const install = () => {
    if (document.getElementById('__demo_cursor')) return;
    const c = document.createElement('div');
    c.id = '__demo_cursor';
    c.innerHTML = '<svg width="28" height="28" viewBox="0 0 24 24"><path d="M4 2l15 9-6.5 1.6L9 19z" fill="#111827" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    Object.assign(c.style, { position: 'fixed', left: '0', top: '0', zIndex: 2147483647, pointerEvents: 'none', transform: 'translate(-200px,-200px)', transition: 'none' });
    const ring = document.createElement('div');
    Object.assign(ring.style, { position: 'fixed', width: '36px', height: '36px', marginLeft: '-18px', marginTop: '-18px', borderRadius: '50%', border: '3px solid rgba(43,94,167,.7)', zIndex: 2147483646, pointerEvents: 'none', opacity: '0', transition: 'opacity .35s, transform .35s' });
    document.documentElement.append(ring, c);
    addEventListener('mousemove', (e) => { c.style.transform = 'translate(' + (e.clientX - 3) + 'px,' + (e.clientY - 2) + 'px)'; }, true);
    addEventListener('mousedown', (e) => { ring.style.left = e.clientX + 'px'; ring.style.top = e.clientY + 'px'; ring.style.transition = 'none'; ring.style.opacity = '1'; ring.style.transform = 'scale(.4)'; requestAnimationFrame(() => { ring.style.transition = 'opacity .45s, transform .45s'; ring.style.opacity = '0'; ring.style.transform = 'scale(1.4)'; }); }, true);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install); else install();
})();`;

async function capture(micFile) {
  const videoDir = join(OUT, 'raw');
  rmSync(videoDir, { recursive: true, force: true });
  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${micFile}`],
  });
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, acceptDownloads: true, recordVideo: { dir: videoDir, size: { width: W, height: H } } });
  await context.addInitScript(CURSOR_SCRIPT);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const t0 = Date.now();
  const now = () => (Date.now() - t0) / 1000;
  const until = async (t) => { const d = t - now(); if (d > 0) await page.waitForTimeout(d * 1000); else if (d < -0.4) console.warn(`  ! running ${(-d).toFixed(1)}s late at ${t}s`); };
  const zooms = [];
  const zoom = async (locator, from, to, scale = 1.25) => { const b = await locator.boundingBox(); if (b) zooms.push({ from, to, box: b, scale }); };
  let mouse = { x: W / 2, y: H / 2 };
  const glide = async (x, y, steps = 28) => { await page.mouse.move(x, y, { steps }); mouse = { x, y }; };
  const glideTo = async (locator, steps) => { const b = await locator.boundingBox(); if (!b) throw new Error('not visible: ' + locator); await glide(b.x + b.width / 2, b.y + b.height / 2, steps); };
  const click = async (locator, steps) => { await glideTo(locator, steps); await page.waitForTimeout(120); await page.mouse.down(); await page.waitForTimeout(70); await page.mouse.up(); };
  const panel = page.locator('[data-tour="recording-panel"]');

  // 0–4 — open CourtScribe and the courtroom session
  await page.goto(`${BASE}/workspace`);
  await page.getByRole('heading', { name: 'Courtroom' }).waitFor();
  await page.mouse.move(W / 2, H / 2);
  await until(0.8);
  await click(page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Workspace' }));
  await zoom(page.getByRole('heading', { name: 'Case details' }).locator('xpath=ancestor::section'), 1.2, 3.8, 1.18);
  await glideTo(page.getByText('CR/2026/00421').nth(1), 30);
  await until(2.6);
  await glideTo(page.getByText('Witness Deposition').last(), 22);

  // 4–9 — microphone + start recording
  await until(4);
  const select = panel.getByRole('combobox');
  await zoom(panel, 4.4, 8.6, 1.22);
  await click(select, 26);
  await page.keyboard.press('Escape');
  await select.selectOption({ index: 1 });
  await until(5.8);
  await click(panel.getByRole('button', { name: '● Start Recording' }), 20);
  await panel.getByRole('button', { name: 'Pause' }).waitFor();
  await until(7.6);
  await glideTo(page.getByText('Recording audio'), 24);

  // 9–15 — live transcript (independent demo stream)
  await until(8.3);
  await click(page.getByRole('button', { name: 'Connect live feed' }), 22);
  await page.getByRole('status').filter({ hasText: /^Connected/ }).waitFor();
  await click(page.getByRole('button', { name: 'Start feed' }), 14);
  const transcript = page.getByRole('heading', { name: 'Transcript', exact: true }).locator('xpath=ancestor::section');
  await transcript.scrollIntoViewIfNeeded();
  await page.locator('main').evaluate((m) => m.scrollBy({ top: 520, behavior: 'smooth' }));
  await until(10.4);
  await zoom(page.locator('[aria-label="Transcript"]'), 10.4, 14.6, 1.2);
  await glideTo(page.locator('[aria-label="Transcript"]'), 30);

  // 15–20 — search and open a statement
  await until(15);
  await click(page.getByPlaceholder(/Search speaker or text/), 24);
  await page.keyboard.type('Exhibit', { delay: 85 });
  await page.getByText(/^\d[\d,]* \/ \d[\d,]*$/).waitFor({ timeout: 4000 });
  await zoom(transcript, 16.2, 19.6, 1.15);
  await until(17.4);
  await click(page.locator('[data-transcript-row]', { has: page.locator('mark') }).first(), 26);
  await until(19.4);

  // 20–25 — pause, resume, stop, download (a real file must come out)
  await until(20);
  await page.locator('main').evaluate((m) => m.scrollTo({ top: 0, behavior: 'smooth' }));
  await page.waitForTimeout(450);
  await zoom(panel, 20.6, 24.8, 1.22);
  await click(panel.getByRole('button', { name: 'Pause' }), 24);
  await until(21.6);
  await click(panel.getByRole('button', { name: 'Resume' }), 10);
  await until(22.6);
  await click(panel.getByRole('button', { name: '■ Stop Recording' }), 14);
  const download = panel.getByRole('link', { name: 'Download' }).first();
  await download.waitFor();
  await until(23.6);
  const [dl] = await Promise.all([page.waitForEvent('download'), click(download, 18)]);
  const savedRecording = join(OUT, dl.suggestedFilename());
  await dl.saveAs(savedRecording);
  if (statSync(savedRecording).size === 0) throw new Error('Downloaded recording is empty — refusing to show it as saved');

  // 25–30 — connection status, then the reliability dashboard
  await until(25);
  const streamStatus = page.getByRole('status').filter({ hasText: /^Connected/ });
  await zoom(streamStatus.locator('xpath=ancestor::section'), 25.2, 26.9, 1.2);
  await glideTo(streamStatus, 26);
  await until(26.9);
  await click(page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Connection & Reliability' }), 26);
  await page.getByRole('heading', { name: 'Connection & Reliability' }).waitFor();
  await glide(W * 0.55, H * 0.42, 30);
  await until(DURATION + 0.6);

  const timeline = { capturedAt: new Date().toISOString(), beats: BEATS, zooms, savedRecording, recordingBytes: statSync(savedRecording).size, errors };
  await context.close(); // finalises the video file
  await browser.close();
  const raw = readdirSync(videoDir).find((f) => f.endsWith('.webm'));
  return { webm: join(videoDir, raw), timeline };
}

// ---------------- 3. compose (in Chrome) ----------------
const COMPOSE = String.raw`
<canvas id="c" width="${W}" height="${H}"></canvas>
<script>
window.compose = async ({ webm, voice, beats, zooms, duration }) => {
  const toBlob = (b64, type) => new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type });
  const video = document.createElement('video');
  video.src = URL.createObjectURL(toBlob(webm, 'video/webm'));
  video.muted = true;
  await new Promise((r) => (video.oncanplaythrough = r));
  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d');
  const ac = new AudioContext({ sampleRate: 48000 });
  const dest = ac.createMediaStreamDestination();
  const clips = await Promise.all(voice.map(async (v) => ({ at: v.at, buf: await ac.decodeAudioData(await toBlob(v.wav, 'audio/wav').arrayBuffer()) })));
  const stream = new MediaStream([...canvas.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const rec = new MediaRecorder(stream, { mimeType: 'video/mp4;codecs=avc1.640028,mp4a.40.2', videoBitsPerSecond: 9_000_000, audioBitsPerSecond: 160_000 });
  const parts = [];
  rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
  const ease = (x) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);
  const view = (t) => {
    for (const z of zooms) {
      const ramp = 0.6, a = z.from, b = z.to;
      if (t < a || t > b) continue;
      const k = t < a + ramp ? ease((t - a) / ramp) : t > b - ramp ? ease((b - t) / ramp) : 1;
      const s = 1 + (z.scale - 1) * k;
      const cx = z.box.x + z.box.width / 2, cy = z.box.y + z.box.height / 2;
      const w = ${W} / s, h = ${H} / s;
      const x = Math.min(Math.max(${W} / 2 + (cx - ${W} / 2) * k - w / 2, 0), ${W} - w);
      const y = Math.min(Math.max(${H} / 2 + (cy - ${H} / 2) * k - h / 2, 0), ${H} - h);
      return [x, y, w, h];
    }
    return [0, 0, ${W}, ${H}];
  };
  const roundRect = (x, y, w, h, r) => { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); };
  const draw = (t) => {
    const [sx, sy, sw, sh] = view(t);
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, ${W}, ${H});
    // caption (lower third) with fade
    const beat = [...beats].reverse().find((b) => t >= b.at);
    if (beat) {
      const next = beats[beats.indexOf(beat) + 1]?.at ?? duration;
      const alpha = Math.min(1, (t - beat.at) / 0.35, (next - t) / 0.35);
      ctx.save();
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.font = '600 44px -apple-system, "Helvetica Neue", Inter, sans-serif';
      const tw = ctx.measureText(beat.caption).width;
      roundRect((${W} - tw) / 2 - 36, ${H} - 150, tw + 72, 84, 18);
      ctx.fillStyle = 'rgba(10,20,38,0.86)';
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(beat.caption, ${W} / 2, ${H} - 108);
      ctx.restore();
    }
    // Honest labelling of demo inputs: one centred row of chips along the top edge, clear of controls and new rows.
    const notes = ['Demo build · synthetic case data'];
    if (t >= 4 && t < 25) notes.push('Microphone: synthetic test speech');
    if (t >= 9 && t < 20) notes.push('Transcript: separate demo stream, not generated from the recording');
    ctx.save();
    ctx.font = '500 21px -apple-system, "Helvetica Neue", sans-serif';
    const gap = 12;
    const widths = notes.map((n) => ctx.measureText(n).width + 26);
    let x = (${W} - widths.reduce((a, b) => a + b, 0) - gap * (notes.length - 1)) / 2;
    const y = 18;
    notes.forEach((n, i) => {
      roundRect(x, y, widths[i], 36, 10);
      ctx.fillStyle = 'rgba(255,251,235,0.95)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(217,119,6,0.85)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#7c4a03';
      ctx.textBaseline = 'middle';
      ctx.fillText(n, x + 13, y + 18);
      x += widths[i] + gap;
    });
    ctx.restore();
  };
  let thumb = null;
  // Thumbnail: the whole workspace (no zoom/captions) mid-recording, with a title band.
  const makeThumb = () => {
    const tc = document.createElement('canvas');
    tc.width = ${W};
    tc.height = ${H};
    const g = tc.getContext('2d');
    g.drawImage(video, 0, 0, ${W}, ${H});
    g.fillStyle = 'rgba(10,20,38,0.88)';
    g.fillRect(0, ${H} - 210, ${W}, 210);
    g.fillStyle = '#fff';
    g.font = '700 76px -apple-system, "Helvetica Neue", sans-serif';
    g.textBaseline = 'alphabetic';
    g.fillText('CourtScribe', 72, ${H} - 112);
    g.font = '500 38px -apple-system, "Helvetica Neue", sans-serif';
    g.fillStyle = '#cbd5e1';
    g.fillText('30-second courtroom walkthrough · recording, live transcript, search', 72, ${H} - 52);
    g.font = '500 26px -apple-system, "Helvetica Neue", sans-serif';
    g.fillStyle = '#fbbf24';
    g.textAlign = 'right';
    g.fillText('Prototype · synthetic demo data', ${W} - 72, ${H} - 52);
    return tc.toDataURL('image/png');
  };
  draw(0);
  rec.start(1000);
  const start = ac.currentTime + 0.05;
  for (const c of clips) { const s = ac.createBufferSource(); s.buffer = c.buf; s.connect(dest); s.start(start + c.at); }
  await video.play();
  await new Promise((resolve) => {
    const tick = () => {
      const t = video.currentTime;
      draw(t);
      if (!thumb && t >= 9.6) thumb = makeThumb();
      if (t >= duration || video.ended) return resolve();
      video.requestVideoFrameCallback(tick);
    };
    video.requestVideoFrameCallback(tick);
  });
  video.pause();
  await new Promise((r) => { rec.onstop = r; rec.stop(); });
  const mp4 = new Blob(parts, { type: 'video/mp4' });
  window.__mp4 = new Uint8Array(await mp4.arrayBuffer());
  window.__thumb = thumb;
  return { bytes: window.__mp4.length };
};
window.chunk = (i, size) => { let s = ''; const a = window.__mp4.subarray(i, i + size); for (let j = 0; j < a.length; j += 0x8000) s += String.fromCharCode(...a.subarray(j, j + 0x8000)); return btoa(s); };
</script>`;

async function compose(webm, voice, timeline) {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await page.setContent(COMPOSE);
  const b64 = (f) => readFileSync(f).toString('base64');
  const { bytes } = await page.evaluate((args) => window.compose(args), {
    webm: b64(webm),
    voice: voice.map((v) => ({ at: v.at, wav: b64(v.file) })),
    beats: BEATS,
    zooms: timeline.zooms,
    duration: DURATION,
  });
  const out = [];
  for (let i = 0; i < bytes; i += 4 * 1024 * 1024) out.push(Buffer.from(await page.evaluate(([i, s]) => window.chunk(i, s), [i, 4 * 1024 * 1024]), 'base64'));
  const mp4 = join(OUT, 'courtscribe-walkthrough.mp4');
  writeFileSync(mp4, Buffer.concat(out));
  const thumb = await page.evaluate(() => window.__thumb);
  writeFileSync(join(OUT, 'thumbnail.png'), Buffer.from(thumb.split(',')[1], 'base64'));
  await browser.close();
  return mp4;
}

// ---------------- run ----------------
mkdirSync(OUT, { recursive: true });
console.log('1/3 audio assets…');
const { voice, mic } = makeAudio();
for (const [i, v] of voice.entries()) console.log(`  vo ${i}: ${v.seconds.toFixed(1)}s @ ${v.at}s`);
console.log('2/3 capturing the app…');
await configureServer({ running: false, rate: 10, duplicateRate: 0, reorderRate: 0 });
let captured;
try {
  captured = await capture(mic);
} finally {
  await configureServer({ running: false, rate: 50 });
}
writeFileSync(join(OUT, 'timeline.json'), JSON.stringify(captured.timeline, null, 2));
if (captured.timeline.errors.length) console.warn('  ! page errors during capture:', captured.timeline.errors);
console.log(`  recording downloaded in-app: ${captured.timeline.savedRecording} (${captured.timeline.recordingBytes} bytes)`);
console.log('3/3 composing MP4…');
const mp4 = await compose(captured.webm, voice, captured.timeline);
console.log('done:', mp4, `${(statSync(mp4).size / 1048576).toFixed(1)} MB`);
