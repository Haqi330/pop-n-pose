/* POP N POSE – public/app.js
   Kamera, sesi foto, filter, bingkai, layout, stiker/teks, motion preview, unduh, QR. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const el = {
    video: $('camera-stream'), wrapper: $('camera-wrapper'), countdown: $('countdown-overlay'),
    flash: $('flash-effect'), errBox: $('camera-error-box'), btnRetry: $('btn-retry-camera'),
    camSel: $('camera-select'), ratioSel: $('aspect-ratio-select'), layoutSel: $('layout-select'),
    timerSel: $('timer-select'), frames: $('frame-carousel'), filters: $('filter-buttons'),
    btnStart: $('btn-start-photo'), progress: $('photo-progress'),
    screenCapture: $('screen-capture'), screenResult: $('screen-result'),
    canvas: $('result-canvas'), stickers: $('sticker-palette'), textInput: $('custom-text-input'),
    btnText: $('btn-add-text'), btnMotion: $('btn-toggle-motion'), btnRetake: $('btn-retake'),
    btnDownload: $('btn-download-direct'), btnQR: $('btn-generate-qr'),
    qrModal: $('qr-modal'), qrImage: $('qr-image'), qrStatus: $('qr-status-text'), btnCloseQR: $('btn-close-qr'),
  };
  const ctx = el.canvas.getContext('2d');

  /* ---------- Konfigurasi ---------- */
  const UPLOAD_URL = '/api/upload';          // POST {image: dataURL} -> {url, qr?}
  const PHOTO_W = 600;
  const PAD = 36, GAP = 20, FOOTER = 110;
  const INK = '#1E1236';
  const FRAME_BG = { none: '#ffffff', 'frame-1': '#FF4D8D', 'frame-2': '#FFD23F', 'frame-3': '#35C4FF', 'frame-4': '#3EDBA0' };
  const CSS_FILTER = {
    normal: 'none', grayscale: 'grayscale(1)', sepia: 'sepia(1)', contrast: 'contrast(1.5)',
    invert: 'invert(1)', warm: 'sepia(.3) saturate(1.4) brightness(1.05)', cool: 'hue-rotate(-15deg) saturate(1.1) brightness(1.03)',
  };
  const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';

  /* ---------- State ---------- */
  let stream = null, mirrored = true, busy = false, devicesListed = false;
  let filter = 'normal', frame = 'none';
  let photos = [], items = [];
  const frameImgs = {};
  let motionTimer = null, motionStep = 0;
  let drag = null, raf = 0, uploadCtl = null;

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const setProgress = (t) => { if (el.progress) el.progress.textContent = t; };

  /* ---------- Kamera ---------- */
  function stopCamera() {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null; el.video.srcObject = null;
  }

  async function listCameras() {
    if (devicesListed) return;
    const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    if (!cams.length) return;
    const current = stream?.getVideoTracks()[0]?.getSettings().deviceId;
    el.camSel.innerHTML = '';
    cams.forEach((c, i) => {
      const o = document.createElement('option');
      o.value = c.deviceId; o.textContent = c.label || `Kamera ${i + 1}`;
      if (c.deviceId === current) o.selected = true;
      el.camSel.appendChild(o);
    });
    devicesListed = true;
  }

  async function startCamera() {
    stopCamera();
    el.errBox.classList.add('hidden');
    el.btnStart.disabled = true;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('unsupported');
      const v = { width: { ideal: 1280 }, height: { ideal: 960 } };
      const sel = el.camSel.value;
      if (sel === 'user' || sel === 'environment') v.facingMode = { ideal: sel };
      else if (sel) v.deviceId = { exact: sel };
      stream = await navigator.mediaDevices.getUserMedia({ video: v, audio: false });
      el.video.srcObject = stream;
      await el.video.play().catch(() => {});
      const fm = stream.getVideoTracks()[0].getSettings().facingMode;
      mirrored = fm ? fm === 'user' : true;
      el.video.classList.toggle('mirror', mirrored);
      el.video.style.filter = CSS_FILTER[filter];
      await listCameras().catch(() => {});
      el.btnStart.disabled = false;
      setProgress('Siap? Pilih gaya di panel, lalu tekan Mulai Foto.');
    } catch (e) {
      console.error('Kamera gagal:', e);
      el.errBox.classList.remove('hidden');
      setProgress('Kamera tidak aktif.');
    }
  }

  /* ---------- Filter piksel (konsisten di semua browser) ---------- */
  function applyFilter(c, w, h, name) {
    if (name === 'normal') return;
    const img = c.getImageData(0, 0, w, h), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      let r = d[i], g = d[i + 1], b = d[i + 2];
      switch (name) {
        case 'grayscale': r = g = b = 0.299 * r + 0.587 * g + 0.114 * b; break;
        case 'sepia': { const R = 0.393 * r + 0.769 * g + 0.189 * b, G = 0.349 * r + 0.686 * g + 0.168 * b, B = 0.272 * r + 0.534 * g + 0.131 * b; r = R; g = G; b = B; break; }
        case 'contrast': r = (r - 128) * 1.5 + 128; g = (g - 128) * 1.5 + 128; b = (b - 128) * 1.5 + 128; break;
        case 'invert': r = 255 - r; g = 255 - g; b = 255 - b; break;
        case 'warm': r = r * 1.1 + 10; b *= 0.88; break;
        case 'cool': r *= 0.9; b = b * 1.1 + 10; break;
      }
      d[i] = r; d[i + 1] = g; d[i + 2] = b;
    }
    c.putImageData(img, 0, 0);
  }

  function ratioValue() { return el.ratioSel.value === '1:1' ? 1 : 4 / 3; }

  function captureFrame() {
    const vw = el.video.videoWidth, vh = el.video.videoHeight, r = ratioValue();
    let sw = vw, sh = vw / r;
    if (sh > vh) { sh = vh; sw = vh * r; }
    const sx = (vw - sw) / 2, sy = (vh - sh) / 2;
    const c = document.createElement('canvas');
    c.width = PHOTO_W; c.height = Math.round(PHOTO_W / r);
    const g = c.getContext('2d', { willReadFrequently: true });
    if (mirrored) { g.translate(c.width, 0); g.scale(-1, 1); }
    g.drawImage(el.video, sx, sy, sw, sh, 0, 0, c.width, c.height);
    g.setTransform(1, 0, 0, 1, 0, 0);
    applyFilter(g, c.width, c.height, filter);
    return c;
  }

  /* ---------- Sesi foto ---------- */
  function doFlash() {
    el.flash.classList.remove('is-flashing');
    void el.flash.offsetWidth;
    el.flash.classList.add('is-flashing');
  }

  async function startSession() {
    if (busy || !stream) return;
    busy = true; el.btnStart.disabled = true;
    photos = []; items = [];
    const total = el.layoutSel.value === 'grid-4' ? 4 : 3;
    const secs = parseInt(el.timerSel.value, 10) || 3;
    try {
      for (let i = 0; i < total; i++) {
        setProgress(`Foto ${i + 1} dari ${total}. Bersiap!`);
        for (let s = secs; s > 0; s--) {
          el.countdown.textContent = s;
          el.countdown.classList.remove('hidden');
          await wait(1000);
        }
        el.countdown.classList.add('hidden');
        doFlash();
        photos.push(captureFrame());
        await wait(600);
      }
      stopCamera();
      await showResult();
    } catch (e) {
      console.error(e);
      el.countdown.classList.add('hidden');
      setProgress('Sesi foto terhenti. Coba lagi.');
    } finally {
      busy = false;
    }
  }

  /* ---------- Render hasil ---------- */
  function cols() { return el.layoutSel.value === 'grid-4' ? 2 : 1; }

  function loadFrameImage(id) {
    if (id === 'none' || id in frameImgs) return;
    frameImgs[id] = null;
    const img = new Image();
    img.onload = () => { frameImgs[id] = img; if (photos.length) renderResult(); };
    img.src = `frames/${id}.png`;       // opsional; kalau tidak ada, pakai bingkai warna
  }

  function renderResult(reveal = photos.length) {
    if (!photos.length) return;
    const pw = photos[0].width, ph = photos[0].height, c = photos.length === 4 ? 2 : 1, rows = Math.ceil(photos.length / c);
    const W = PAD * 2 + c * pw + (c - 1) * GAP;
    const H = PAD + rows * ph + (rows - 1) * GAP + FOOTER;
    if (el.canvas.width !== W || el.canvas.height !== H) { el.canvas.width = W; el.canvas.height = H; }

    ctx.fillStyle = FRAME_BG[frame] || '#fff';
    ctx.fillRect(0, 0, W, H);
    if (frame !== 'none') { ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 6; ctx.strokeRect(14, 14, W - 28, H - 28); }

    photos.forEach((p, i) => {
      const x = PAD + (i % c) * (pw + GAP), y = PAD + Math.floor(i / c) * (ph + GAP);
      if (i < reveal) ctx.drawImage(p, x, y);
      else { ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fillRect(x, y, pw, ph); }
      ctx.strokeStyle = INK; ctx.lineWidth = 5; ctx.strokeRect(x, y, pw, ph);
    });

    // Footer
    const fy = H - FOOTER / 2;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '56px "Bagel Fat One", Impact, sans-serif';
    ctx.lineJoin = 'round'; ctx.lineWidth = 9; ctx.strokeStyle = INK; ctx.fillStyle = '#fff';
    ctx.strokeText('POP N POSE', W / 2, fy - 8); ctx.fillText('POP N POSE', W / 2, fy - 8);
    ctx.font = '700 22px Nunito, sans-serif'; ctx.fillStyle = INK;
    ctx.fillText(new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }), W / 2, fy + 34);

    const img = frameImgs[frame];
    if (img) ctx.drawImage(img, 0, 0, W, H);

    drawItems();
  }

  function drawItems() {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    items.forEach((it) => {
      ctx.save();
      ctx.translate(it.x, it.y);
      if (it.type === 'sticker') {
        ctx.font = `${it.size}px ${EMOJI_FONT}`;
        it.w = it.h = it.size * 1.1;
        ctx.fillText(it.text, 0, 0);
      } else {
        ctx.font = `${it.size}px "Bagel Fat One", Impact, sans-serif`;
        ctx.lineJoin = 'round'; ctx.lineWidth = it.size * 0.16; ctx.strokeStyle = INK; ctx.fillStyle = '#fff';
        it.w = ctx.measureText(it.text).width + 10; it.h = it.size * 1.2;
        ctx.strokeText(it.text, 0, 0); ctx.fillText(it.text, 0, 0);
      }
      ctx.restore();
    });
  }

  function scheduleRender() {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; renderResult(); });
  }

  async function showResult() {
    try { await document.fonts.load('40px "Bagel Fat One"'); } catch (_) {}
    loadFrameImage(frame);
    renderResult();
    el.screenCapture.classList.add('hidden');
    el.screenResult.classList.remove('hidden');
    el.screenResult.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------- Stiker & teks ---------- */
  function addItem(type, text) {
    if (!photos.length || !text) return;
    stopMotion();
    const W = el.canvas.width, H = el.canvas.height;
    items.push({
      type, text,
      size: type === 'sticker' ? Math.round(W * 0.14) : Math.round(W * 0.07),
      x: W / 2 + (Math.random() - 0.5) * W * 0.3,
      y: H / 2 + (Math.random() - 0.5) * H * 0.3,
    });
    renderResult();
  }

  function toCanvasXY(e) {
    const r = el.canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (el.canvas.width / r.width), y: (e.clientY - r.top) * (el.canvas.height / r.height) };
  }
  function hit(p) {
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (Math.abs(p.x - it.x) <= (it.w || 0) / 2 && Math.abs(p.y - it.y) <= (it.h || 0) / 2) return i;
    }
    return -1;
  }

  el.canvas.title = 'Seret stiker untuk memindah, klik dua kali untuk menghapus';
  el.canvas.addEventListener('pointerdown', (e) => {
    const p = toCanvasXY(e), i = hit(p);
    if (i < 0) return;
    stopMotion();
    const it = items.splice(i, 1)[0]; items.push(it);   // naikkan ke paling atas
    drag = { it, dx: it.x - p.x, dy: it.y - p.y };
    el.canvas.setPointerCapture(e.pointerId);
  });
  el.canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const p = toCanvasXY(e);
    drag.it.x = p.x + drag.dx; drag.it.y = p.y + drag.dy;
    scheduleRender();
  });
  const endDrag = () => { drag = null; };
  el.canvas.addEventListener('pointerup', endDrag);
  el.canvas.addEventListener('pointercancel', endDrag);
  el.canvas.addEventListener('dblclick', (e) => {
    const i = hit(toCanvasXY(e));
    if (i >= 0) { items.splice(i, 1); renderResult(); }
  });

  /* ---------- Motion preview ---------- */
  function stopMotion() {
    if (motionTimer) { clearInterval(motionTimer); motionTimer = null; }
    el.btnMotion.setAttribute('aria-pressed', 'false');
    if (photos.length) renderResult();
  }
  function toggleMotion() {
    if (motionTimer) { stopMotion(); return; }
    if (!photos.length) return;
    motionStep = 0;
    el.btnMotion.setAttribute('aria-pressed', 'true');
    const n = photos.length;
    const tick = () => { renderResult(Math.min(motionStep, n)); motionStep = (motionStep + 1) % (n + 3); };
    tick();
    motionTimer = setInterval(tick, 650);
  }

  /* ---------- Unduh & QR ---------- */
  function download() {
    stopMotion();
    el.canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `popnpose-${Date.now()}.png`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }, 'image/png');
  }

  function closeQR() {
    if (uploadCtl) uploadCtl.abort();
    el.qrModal.classList.add('hidden');
  }

  async function generateQR() {
    stopMotion();
    el.qrImage.classList.add('hidden');
    el.qrImage.removeAttribute('src');
    el.qrStatus.textContent = 'Mengunggah foto…';
    el.qrModal.classList.remove('hidden');
    el.btnQR.disabled = true;
    uploadCtl = new AbortController();
    try {
      const res = await fetch(UPLOAD_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: el.canvas.toDataURL('image/png') }), signal: uploadCtl.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const url = data.url || data.link || data.downloadUrl;
      const qr = data.qr || data.qrImage || data.qrCode ||
        (url ? `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(url)}` : null);
      if (!qr) throw new Error('Respons server tidak berisi QR');
      el.qrImage.src = qr;
      el.qrImage.classList.remove('hidden');
      el.qrStatus.textContent = 'Scan QR ini dengan ponselmu untuk mengunduh foto.';
    } catch (e) {
      if (e.name === 'AbortError') return;
      console.error(e);
      el.qrStatus.textContent = 'QR gagal dibuat. Periksa koneksi server lalu coba lagi.';
    } finally {
      el.btnQR.disabled = false;
    }
  }

  /* ---------- Retake ---------- */
  function retake() {
    stopMotion(); closeQR();
    photos = []; items = [];
    el.screenResult.classList.add('hidden');
    el.screenCapture.classList.remove('hidden');
    startCamera();
  }

  /* ---------- Event UI ---------- */
  function pickActive(container, selector, target, attr) {
    container.querySelectorAll(selector).forEach((b) => {
      const on = b === target;
      b.classList.toggle('is-active', on);
      b.setAttribute(attr, on ? 'true' : 'false');
    });
  }

  el.filters.addEventListener('click', (e) => {
    const b = e.target.closest('[data-filter]'); if (!b) return;
    filter = b.dataset.filter;
    pickActive(el.filters, '[data-filter]', b, 'aria-pressed');
    el.video.style.filter = CSS_FILTER[filter] || 'none';
  });
  el.frames.addEventListener('click', (e) => {
    const b = e.target.closest('[data-frame]'); if (!b) return;
    frame = b.dataset.frame;
    pickActive(el.frames, '[data-frame]', b, 'aria-selected');
    loadFrameImage(frame);
  });
  el.stickers.addEventListener('click', (e) => {
    const b = e.target.closest('[data-sticker]'); if (b) addItem('sticker', b.dataset.sticker);
  });
  const addText = () => {
    const t = el.textInput.value.trim();
    if (!t) { el.textInput.focus(); return; }
    addItem('text', t); el.textInput.value = '';
  };
  el.btnText.addEventListener('click', addText);
  el.textInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addText(); });

  el.camSel.addEventListener('change', () => { if (!busy) startCamera(); });
  el.ratioSel.addEventListener('change', () => { el.wrapper.dataset.ratio = el.ratioSel.value; });
  el.btnRetry.addEventListener('click', startCamera);
  el.btnStart.addEventListener('click', startSession);
  el.btnMotion.addEventListener('click', toggleMotion);
  el.btnRetake.addEventListener('click', retake);
  el.btnDownload.addEventListener('click', download);
  el.btnQR.addEventListener('click', generateQR);
  el.btnCloseQR.addEventListener('click', closeQR);
  el.qrModal.addEventListener('click', (e) => { if (e.target === el.qrModal) closeQR(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !el.qrModal.classList.contains('hidden')) closeQR(); });

  /* ---------- Init ---------- */
  el.wrapper.dataset.ratio = el.ratioSel.value;
  startCamera();
})();
