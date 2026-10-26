/* Thanos Snap v2 — content script.
   Works on Google Meet, Microsoft Teams and Zoom (web client).
   Listens to the mic for a finger snap (raw audio, processed locally,
   nothing ever leaves the device). On a snap: your own video frame
   dissolves into pixels, then your camera turns off AND your mic mutes.
   Snap again and you come back. Fallback: Alt+S. */

(() => {
  'use strict';

  /* ---------- which site are we on? ---------- */

  function detectSite() {
    const h = location.hostname;
    if (h.endsWith('meet.google.com')) return 'meet';
    if (h.endsWith('teams.microsoft.com') || h.endsWith('teams.live.com')) return 'teams';
    if (h.endsWith('zoom.us')) return 'zoom';
    return 'meet';
  }

  const SITE_LABELS = { meet: 'Meet', teams: 'Teams', zoom: 'Zoom' };

  /* Per-site control buttons. Phrases are matched against a button's
     aria-label / data-tooltip / title / text, case-insensitively.
     `match` is the loose word used to narrow the candidate buttons,
     `shortcut` is the site's own keyboard shortcut (Meet only — used as
     a fallback when the button can't be found).
     NOTE: Teams and Zoom labels below are best-effort guesses from their
     public UI wording — they were NOT verified live. */
  const SITE_CONTROLS = {
    meet: {
      camera: { off: ['turn off camera'], on: ['turn on camera'], match: 'camera', shortcut: 'e' },
      mic: { off: ['turn off microphone'], on: ['turn on microphone'], match: 'microphone', shortcut: 'd' },
    },
    teams: {
      camera: { off: ['turn off camera', 'turn camera off'], on: ['turn on camera', 'turn camera on'], match: 'camera', shortcut: null },
      mic: { off: ['mute microphone', 'mute mic', 'turn off microphone'], on: ['unmute microphone', 'unmute mic', 'turn on microphone'], match: 'mic', shortcut: null },
    },
    zoom: {
      camera: { off: ['stop video'], on: ['start video'], match: 'video', shortcut: null },
      mic: { off: ['mute'], on: ['unmute'], match: 'mute', shortcut: null },
    },
  };

  const SENS = {
    low:    { mult: 6.0, rise: 3.5, floor: 55 },
    medium: { mult: 4.0, rise: 2.5, floor: 40 },
    high:   { mult: 2.8, rise: 1.8, floor: 28 },
  };

  const state = {
    site: detectSite(),
    enabled: true,
    sensitivity: 'medium',
    listening: false,
    micDenied: false,
    invisible: false,
    cooldownUntil: 0,
    audioCtx: null,
    analyser: null,
    freqData: null,
    baseline: 0,
    prevEnergy: 0,
    stream: null,
  };

  /* ---------- settings ---------- */

  chrome.storage.sync.get({ enabled: true, sensitivity: 'medium' }, (s) => {
    state.enabled = s.enabled;
    state.sensitivity = SENS[s.sensitivity] ? s.sensitivity : 'medium';
    // Visible proof the script is alive in this tab — if you never see
    // this toast, the content script never loaded (reload the tab).
    setTimeout(() => {
      if (state.enabled) toast('Thanos Snap ready — snap or press Alt+S');
    }, 1200);
    if (state.enabled) startListening();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    if (changes.enabled) {
      state.enabled = changes.enabled.newValue;
      state.enabled ? startListening() : stopListening();
    }
    if (changes.sensitivity) {
      state.sensitivity = changes.sensitivity.newValue;
    }
  });

  /* ---------- messages from popup ---------- */

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'status') {
      sendResponse({
        enabled: state.enabled,
        listening: state.listening,
        micDenied: state.micDenied,
        invisible: state.invisible,
        sensitivity: state.sensitivity,
        site: SITE_LABELS[state.site],
      });
      return true;
    }
    if (msg.type === 'test-snap') {
      doSnap();
      sendResponse({ ok: true });
      return true;
    }
    return false;
  });

  /* ---------- keyboard fallback: Alt+S (capture phase, so the app can't eat it) ---------- */

  window.addEventListener(
    'keydown',
    (e) => {
      if (e.altKey && e.key && e.key.toLowerCase() === 's') {
        e.preventDefault();
        e.stopPropagation();
        doSnap();
      }
    },
    true
  );

  /* ---------- mic + snap detection ---------- */

  async function startListening() {
    if (state.listening || state.stream) return;
    try {
      // Raw audio: echo cancellation / noise suppression OFF, otherwise
      // Chrome's processing eats the sharp snap transient.
      state.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch (err) {
      state.micDenied = true;
      toast('Mic access needed for snap detection — Alt+S still works.');
      return;
    }
    state.micDenied = false;
    state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (state.audioCtx.state === 'suspended') {
      const resume = () => state.audioCtx && state.audioCtx.resume();
      document.addEventListener('click', resume, { once: true });
      document.addEventListener('keydown', resume, { once: true });
    }
    const source = state.audioCtx.createMediaStreamSource(state.stream);
    state.analyser = state.audioCtx.createAnalyser();
    state.analyser.fftSize = 2048;
    source.connect(state.analyser);
    state.freqData = new Uint8Array(state.analyser.frequencyBinCount);
    state.baseline = 0;
    state.prevEnergy = 0;
    state.listening = true;
    detectLoop();
  }

  function stopListening() {
    state.listening = false;
    if (state.stream) {
      state.stream.getTracks().forEach((t) => t.stop());
      state.stream = null;
    }
    if (state.audioCtx) {
      state.audioCtx.close().catch(() => {});
      state.audioCtx = null;
    }
    state.analyser = null;
  }

  function detectLoop() {
    if (!state.listening || !state.analyser) return;
    state.analyser.getByteFrequencyData(state.freqData);

    // Band energy, 1500–6000 Hz: where a finger snap lives.
    const binHz = state.audioCtx.sampleRate / state.analyser.fftSize;
    const lo = Math.floor(1500 / binHz);
    const hi = Math.min(Math.ceil(6000 / binHz), state.freqData.length - 1);
    let sum = 0;
    for (let i = lo; i <= hi; i++) sum += state.freqData[i];
    const energy = sum / (hi - lo + 1);

    // Slow baseline of the room, fast attack = snap.
    state.baseline = state.baseline === 0 ? energy : state.baseline * 0.98 + energy * 0.02;
    const cfg = SENS[state.sensitivity];
    const now = Date.now();
    if (
      now > state.cooldownUntil &&
      energy > cfg.floor &&
      energy > state.baseline * cfg.mult &&
      state.prevEnergy > 0 &&
      energy / state.prevEnergy > cfg.rise
    ) {
      state.cooldownUntil = now + 1500;
      doSnap();
    }
    state.prevEnergy = energy;
    requestAnimationFrame(detectLoop);
  }

  /* ---------- the snap ---------- */

  function doSnap() {
    if (!state.enabled) return;
    if (state.invisible) {
      // Snap again: come back.
      state.invisible = false;
      toggleCamera(false);
      toggleMic(false);
      toast('You are back — camera on, mic unmuted.');
    } else {
      state.invisible = true;
      pixelDissolve();
      setTimeout(() => {
        toggleCamera(true);
        toggleMic(true);
      }, 650);
      toast('Snap! You disappeared — camera off, mic muted.');
    }
  }

  /* ---------- per-site camera / mic controls ---------- */

  function labelOf(b) {
    return (
      (b.getAttribute('aria-label') || '') +
      ' ' +
      (b.getAttribute('data-tooltip') || '') +
      ' ' +
      (b.getAttribute('title') || '') +
      ' ' +
      (b.textContent || '')
    ).toLowerCase();
  }

  function phraseIn(label, phrase) {
    const esc = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('\\b' + esc + '\\b').test(label);
  }

  // Returns 'clicked' | 'shortcut' | 'not-found'.
  function toggleControl(kind, wantOff) {
    const cfg = SITE_CONTROLS[state.site][kind];
    const phrases = wantOff ? cfg.off : cfg.on;
    const all = [...document.querySelectorAll('button')];
    let best = null;
    let bestScore = 0;
    for (const b of all) {
      const label = labelOf(b);
      if (!label.includes(cfg.match)) continue;
      let score = 0.5;
      for (const p of phrases) {
        if (label.trim() === p) score = Math.max(score, 3);
        else if (label.startsWith(p)) score = Math.max(score, 2);
        else if (phraseIn(label, p)) score = Math.max(score, 1);
      }
      if (score > bestScore) {
        bestScore = score;
        best = b;
      }
    }
    if (best) {
      best.click();
      return 'clicked';
    }
    if (cfg.shortcut) {
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', { key: cfg.shortcut, ctrlKey: true, bubbles: true })
      );
      return 'shortcut';
    }
    return 'not-found';
  }

  function toggleCamera(wantOff) {
    const res = toggleControl('camera', wantOff);
    if (res === 'not-found') {
      toast('Camera button not found on ' + SITE_LABELS[state.site] + ' — toggle it yourself once.');
    } else if (res === 'shortcut') {
      toast('Camera button not found — tried the Meet shortcut, check it worked.');
    }
  }

  function toggleMic(wantOff) {
    const res = toggleControl('mic', wantOff);
    if (res === 'not-found') {
      toast('Mic button not found on ' + SITE_LABELS[state.site] + ' — mute it yourself once.');
    } else if (res === 'shortcut') {
      toast('Mic button not found — tried the Meet shortcut, check it worked.');
    }
  }

  /* ---------- pixel dissolve (true frame dissolve, gold fallback) ---------- */

  function findSelfVideo() {
    const videos = [...document.querySelectorAll('video')].filter(
      (v) => v.readyState >= 2 && v.videoWidth > 0 && v.offsetWidth > 40
    );
    // Your own video is usually the muted <video> element.
    const self = videos.find((v) => v.muted);
    if (self) return self;
    videos.sort((a, b) => b.offsetWidth * b.offsetHeight - a.offsetWidth * a.offsetHeight);
    return videos[0] || null;
  }

  function findSelfTileRect() {
    const video = findSelfVideo();
    return video ? video.getBoundingClientRect() : null;
  }

  function pixelDissolve() {
    const video = findSelfVideo();
    const rect = video ? video.getBoundingClientRect() : null;
    if (!video || !rect) {
      goldBurst();
      return;
    }

    let frame;
    try {
      const capW = Math.min(video.videoWidth, 240);
      const capH = Math.max(1, Math.round((capW * video.videoHeight) / video.videoWidth));
      const off = document.createElement('canvas');
      off.width = capW;
      off.height = capH;
      const octx = off.getContext('2d');
      octx.drawImage(video, 0, 0, capW, capH);
      frame = octx.getImageData(0, 0, capW, capH); // throws if the canvas is tainted
    } catch (e) {
      goldBurst();
      return;
    }

    // Sample ~2,500 pixels from the frame; each becomes a particle
    // coloured by the pixel it came from.
    const total = frame.width * frame.height;
    const stride = Math.max(1, Math.floor(Math.sqrt(total / 2500)));
    const parts = [];
    for (let y = 0; y < frame.height; y += stride) {
      for (let x = 0; x < frame.width; x += stride) {
        const i = (y * frame.width + x) * 4;
        const a = frame.data[i + 3];
        if (a < 30) continue;
        const sx = rect.left + (x / frame.width) * rect.width + (Math.random() - 0.5) * 2;
        const sy = rect.top + (y / frame.height) * rect.height + (Math.random() - 0.5) * 2;
        const ang = Math.random() * Math.PI * 2;
        const speed = 0.2 + Math.random() * 1.6;
        parts.push({
          x: sx,
          y: sy,
          vx: Math.cos(ang) * speed,
          vy: Math.sin(ang) * speed - (0.4 + Math.random() * 0.9),
          size: 1 + Math.random() * 2.6,
          color: 'rgb(' + frame.data[i] + ',' + frame.data[i + 1] + ',' + frame.data[i + 2] + ')',
          life: 1,
          decay: 0.004 + Math.random() * 0.008,
        });
      }
    }
    if (!parts.length) {
      goldBurst();
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.className = 'thanos-dust-canvas';
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');

    // An opaque copy of the captured frame, drawn over the tile so the
    // tile itself appears to turn to dust as it fades out.
    const cover = document.createElement('canvas');
    cover.width = frame.width;
    cover.height = frame.height;
    cover.getContext('2d').putImageData(frame, 0, 0);

    const start = performance.now();
    const DURATION = 3000;
    (function frameFn(now) {
      const elapsed = now - start;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const coverAlpha = Math.max(0, 1 - elapsed / 1100);
      if (coverAlpha > 0) {
        ctx.globalAlpha = coverAlpha;
        ctx.drawImage(cover, rect.left, rect.top, rect.width, rect.height);
      }
      ctx.globalAlpha = 1;
      for (const p of parts) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.015;
        p.life -= p.decay;
        if (p.life <= 0) continue;
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (elapsed < DURATION) requestAnimationFrame(frameFn);
      else canvas.remove();
    })(start);
  }

  // Fallback when the video frame can't be read: the v1 gold burst.
  function goldBurst() {
    const rect = findSelfTileRect();
    const origin = rect
      ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, r: Math.max(rect.width, rect.height) / 2 }
      : { x: window.innerWidth / 2, y: window.innerHeight / 2, r: 160 };

    const canvas = document.createElement('canvas');
    canvas.className = 'thanos-dust-canvas';
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');

    const colors = ['#f5c542', '#e8b84b', '#ffffff', '#d4a017', '#fff3b0'];
    const parts = [];
    for (let i = 0; i < 160; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = 0.6 + Math.random() * 3.4;
      parts.push({
        x: origin.x + (Math.random() - 0.5) * origin.r * 1.4,
        y: origin.y + (Math.random() - 0.5) * origin.r * 1.4,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed - 0.8,
        size: 1 + Math.random() * 3.2,
        color: colors[Math.floor(Math.random() * colors.length)],
        life: 1,
        decay: 0.008 + Math.random() * 0.014,
      });
    }

    const start = performance.now();
    (function frame(now) {
      const elapsed = now - start;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const p of parts) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.02;
        p.life -= p.decay;
        if (p.life <= 0) continue;
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (elapsed < 1300) requestAnimationFrame(frame);
      else canvas.remove();
    })(start);
  }

  /* ---------- toast ---------- */

  function toast(msg) {
    document.querySelectorAll('.thanos-snap-toast').forEach((t) => t.remove());
    const el = document.createElement('div');
    el.className = 'thanos-snap-toast';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.classList.add('thanos-snap-toast--out'), 2600);
    setTimeout(() => el.remove(), 3100);
  }
})();
