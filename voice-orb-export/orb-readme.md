# Voice Orb 3D – Standalone Export

Animierter 3D-Orb basierend auf Bruno Simons Perlin-Noise-Shader.
Reagiert auf Audio-Levels mit organischer Verformung, Fresnel-Glow und Bloom.

## Dateien

| Datei | Beschreibung |
|---|---|
| `voice-orb-3d.tsx` | Haupt-Komponente mit Perlin-4D Vertex/Fragment Shader, Bloom & Vignette Postprocessing |
| `safe-voice-orb.tsx` | Error-Boundary-Wrapper (verhindert WebGL-Abstürze) |

## NPM-Abhängigkeiten

```bash
npm install three @react-three/fiber @react-three/postprocessing
npm install -D @types/three
```

## Nutzung

```tsx
import { VoiceOrb3D } from './voice-orb-3d';
// ODER mit Error-Boundary:
import { SafeVoiceOrb } from './safe-voice-orb';

// Einfach (idle Orb ohne Audio)
<VoiceOrb3D />

// Mit Audio-Levels (Array von 0.0–1.0 Werten)
<VoiceOrb3D levels={[0.3, 0.5, 0.1, 0, 0, 0, 0, 0]} />

// Pausieren (GPU-Schonung wenn nicht sichtbar)
<VoiceOrb3D paused={true} />
```

## Props

| Prop | Typ | Default | Beschreibung |
|---|---|---|---|
| `levels` | `number[]` | `[0,0,0,0,0,0,0,0]` | Audio-Frequenzbänder (low/mid/high in Index 0–2) |
| `paused` | `boolean` | `false` | Render-Loop pausieren |
| `className` | `string` | `'w-full h-full'` | CSS-Klassen für den Container |

## Import-Pfad anpassen

In `safe-voice-orb.tsx` den Import von `@/components/voice-orb-3d` auf deinen lokalen Pfad ändern.

## Hinweise

- Erfordert React 18+ mit Client-Rendering (`'use client'`)
- Der Fallback in `SafeVoiceOrb` nutzt Tailwind-Klassen – bei Nicht-Tailwind-Projekten den Fallback-Div anpassen
- Sphere-Subdivision ist auf 512×512 gesetzt (hohe Qualität) – bei Performance-Problemen reduzieren
