# Thanos Snap v2 — Meet, Teams & Zoom

Snap your fingers during a video call and disappear like Thanos — your
own video frame dissolves into pixels, then your camera turns off AND
your mic mutes. Snap again and you come back.

## What's new in v2.0 (vs v1.1)

- **Mic mute/unmute:** disappearing now also mutes your mic; returning
  unmutes it. If the mic button can't be found, you get a toast saying
  so — it never silently pretends.
- **True pixel dissolve:** instead of a generic gold burst, the extension
  captures your actual video frame, samples ~2,500 pixels into particles
  coloured by the sampled pixel, and animates them drifting up and fading
  over ~3 seconds. If the frame can't be read (e.g. a tainted canvas),
  it falls back to the v1 gold burst.
- **Multi-platform:** works on Google Meet, Microsoft Teams and Zoom
  (web client), with per-site camera/mic button matching. Background
  auto-inject and the popup now cover all three sites.

## Supported sites

- Google Meet — `meet.google.com` (camera + mic verified by design:
  aria-labels "Turn off camera" / "Turn off microphone")
- Microsoft Teams — `teams.microsoft.com`, `teams.live.com`
- Zoom web — `*.zoom.us`

## Install (2 minutes, no Chrome Web Store needed)

1. Open Chrome and go to `chrome://extensions`
2. Turn on **Developer mode** (top-right toggle)
3. Click **Load unpacked** and select this `meet-thanos-snap-v2` folder
4. Join a call. Chrome will ask for mic permission for the site —
   click **Allow** (the mic is only used to hear snaps)

> If the extension was installed after you already joined a call, the
> background worker injects it into the open tab automatically. If you
> never see the "Thanos Snap ready" toast, reload the tab once.

**Upgrading from v1.1:** remove the v1.1 extension first
(`chrome://extensions` → Remove), then load v2.0 unpacked. Your
settings (on/off, sensitivity) carry over automatically.

## How it works

- **Snap detection:** the extension listens to your mic with the Web Audio
  API and looks for the sharp, short burst a finger snap makes
  (energy spike in the 1.5–6 kHz band with a fast attack). Echo
  cancellation and noise suppression are turned off for the listener
  stream, because they would eat the snap transient.
- **On snap:** your current video frame is sampled into ~2,500
  pixel-coloured particles that drift up and fade over ~3 seconds,
  while an opaque copy of the frame fades out over the tile — so the
  tile itself appears to turn to dust. After ~650 ms the extension
  clicks the site's own camera-off and mic-mute buttons.
- **Snap again:** camera back on, mic unmuted.
- **Fallback:** `Alt+S` anywhere in the meeting triggers the same thing —
  useful if the mic is blocked or the room is noisy.

## Popup settings

Click the extension icon in Chrome's toolbar:

- **Snap detection** on/off
- **Sensitivity** — Low (loud snaps only), Medium, High (quiet room)
- **Test the snap effect** — plays the dissolve + camera/mic toggle
  without snapping
- Status line shows which site it is listening on, and whether you are
  currently invisible

## Privacy

- All audio analysis happens **locally in your browser**. No audio is
  recorded, uploaded, or sent anywhere. The extension makes no external
  requests at all.
- The extension only runs on Meet, Teams and Zoom web pages. It does not
  read your messages, contacts, or anything else.
- Permissions used: `storage` (your on/off + sensitivity settings),
  `tabs` (so the popup can find the meeting tab) and `scripting` (so
  already-open meeting tabs get the extension on install).

## Limitations (honest ones)

- **Teams and Zoom button labels were NOT verified live.** Their
  selectors are best-effort guesses from the apps' public UI wording
  (Teams: "Turn off camera" / "Mute microphone"; Zoom web: "Stop Video"
  / "Mute"). If a button isn't found, the extension tells you with a
  toast instead of failing silently — and the dissolve still plays.
  Meet's labels are the ones the code was built and reasoned against.
- Snap detection works best in a quiet room. Loud claps, pen clicks, or
  a door slam can occasionally trigger it — lower the sensitivity if so.
- Chrome may show the mic as "in use" by both the meeting app and the
  extension; that is normal, they share the same device.
- If a site changes its button labels, the extension falls back to the
  site's own keyboard shortcut where one exists (Meet: Ctrl+E camera,
  Ctrl+D mic). Teams and Zoom have no shortcut fallback in v2.
- The pixel dissolve needs to read your own video frame. If the browser
  refuses (tainted canvas), it falls back to the gold-particle burst.
- This is a fun toy, not a privacy tool — the camera/mic toggles use
  the meeting app itself, so the app still knows you turned them off.

## Files

- `manifest.json` — Manifest V3, v2.0.0, runs on Meet + Teams + Zoom web
- `content.js` — snap detection + pixel dissolve + per-site camera/mic toggle
- `background.js` — auto-injects into already-open meeting tabs
- `popup.html` / `popup.js` — settings popup (finds any of the three sites)
- `styles.css` — toast + dust canvas styles
- `icons/` — extension icons
