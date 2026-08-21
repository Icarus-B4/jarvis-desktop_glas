# Barehands Gesture Tuning (Jarvis Desktop)

Ported from upstream `jaredrhod/barehands` (`barehands.md` / `TROUBLESHOOTING.md`).
This board is the hand-tracked glass interface; the upstream project is the reference
design. Ed's `backend/src/barehands/stage.html` is a TypeScript-port of the upstream
`stage.html` and shares the same gesture engine.

## When to tune

If any gesture misfires for Ed's hand, camera angle, or lighting — DO NOT guess at
thresholds. Upstream's `TROUBLESHOOTING.md` ships a **TUNING CLINIC** protocol. Use it.

## The TUNING CLINIC protocol

1. **Sample both poses.** Open the gesture debug overlay (the P-sampler). Hold the
   CORRECT pose, record the live metric values. Then hold the IMPOSTOR pose (the one
   that falsely triggers, or that the correct pose is mistaken for) and record those.
2. **Find the separating metric.** Look for the one number that is reliably different
   between the two samples — e.g. finger-spread distance vs. palm-flat distance, or
   wrist-to-camera depth. Most misfires come from one metric overlapping between poses.
3. **Cut mid-canyon.** Set the threshold exactly halfway between the two sampled
   clusters. That maximizes the gap on both sides and is far more robust than nudging
   a number until it "feels right".

## Where the gestures live

In `backend/src/barehands/stage.html`:
- **THE PALM ENGINE** — the core gesture set for imperfect, real-world hands
  (≈ line 2159 in the current port).
- **THE FORCE PULL v6 / THE CLAW** — Jared's pull/grab gesture design
  (≈ line 2254).

Tune **inside those blocks only**. Never touch the tracker glue (MediaPipe
HandLandmarker setup, WebGL init) — that part is fragile and camera-specific.

## Common upstream gestures (for reference)

- Tap the ring → orbs bloom.
- Tap a folder orb → tap a note → it opens.
- Pinch the title bar, drag it; tap the bar to close.
- Two hands to stretch something huge.
- Clap (palms flat together, fingers up) → sweep the board clean.
- Throw → fling something aside.

If any of these misfire for Ed, sample the pose vs. the impostor and cut mid-canyon
in the PALM ENGINE block.

## Safety notes

- The media airlock (`backend/src/barehands/media/`) is the ONLY folder the board will
  ever stage files from. Never widen it.
- The ring-state is fed by Jarvis' agent loop (`updateBarehandsLiveState` in
  `server.ts`); it does not need `./state/` files like the upstream Python server.
