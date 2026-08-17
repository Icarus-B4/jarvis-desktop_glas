'use client';

import React, { Component, ReactNode } from 'react';
import { VoiceOrb3D } from '@/components/voice-orb-3d';

type Props = {
  levels?: number[];
  paused?: boolean;
  className?: string;
};

type State = { hasError: boolean };

/** Verhindert WebGL-Abstürze in Electron – ohne diesen Fallback bleibt oft nur das Grid sichtbar. */
class OrbErrorBoundary extends Component<
  { children: ReactNode; className?: string },
  State
> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.warn('[SafeVoiceOrb] WebGL/Three.js Fallback:', error.message);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          className={`flex items-center justify-center rounded-full bg-cyan-500/15 ring-2 ring-cyan-400/30 shadow-[0_0_60px_rgba(0,242,255,0.25)] animate-pulse ${this.props.className ?? 'size-full min-h-[12rem] min-w-[12rem]'}`}
          aria-hidden
        />
      );
    }
    return this.props.children;
  }
}

export function SafeVoiceOrb({ levels, paused, className }: Props) {
  return (
    <OrbErrorBoundary className={className}>
      <VoiceOrb3D levels={levels} paused={paused} className={className} />
    </OrbErrorBoundary>
  );
}
