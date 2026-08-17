import React, { Component, ReactNode } from "react";
import { VoiceOrb3D } from "./voice-orb-3d";
import { VoiceOrb2D } from "./VoiceOrb2D";

type OrbProps = {
  levels?: number[];
  paused?: boolean;
  className?: string;
};

type OrbState = { hasError: boolean };

// Prevents a hard WebGL/Three.js crash from blanking the orb area: on failure it
// falls back to the plain 2D canvas orb (no Tailwind dependency).
class OrbErrorBoundary extends Component<
  OrbProps & { children: ReactNode },
  OrbState
> {
  state: OrbState = { hasError: false };

  static getDerivedStateFromError(): OrbState {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.warn("[SafeVoiceOrb] WebGL/Three.js fallback active:", error.message);
  }

  render() {
    if (this.state.hasError) {
      return (
        <VoiceOrb2D
          levels={this.props.levels}
          paused={this.props.paused}
          className={this.props.className}
        />
      );
    }
    return this.props.children;
  }
}

export function SafeVoiceOrb({ levels = [], paused = false, className = "voice-orb-canvas" }: OrbProps) {
  return (
    <OrbErrorBoundary levels={levels} paused={paused} className={className}>
      <VoiceOrb3D levels={levels} paused={paused} className={className} />
    </OrbErrorBoundary>
  );
}
