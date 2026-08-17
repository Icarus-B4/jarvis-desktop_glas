import React from "react";

export function OrbHudRings(): React.ReactElement {
  return (
    <svg className="orb-hud-rings" viewBox="0 0 1000 1000" aria-hidden="true">
      {/* Outer rotating ring */}
      <g className="orb-hud-rot orb-hud-rot--outer">
        <circle cx="500" cy="500" r="480" className="orb-hud-line orb-hud-line--faint" />
        <circle cx="500" cy="500" r="460" className="orb-hud-line orb-hud-line--wide" />
        <circle cx="500" cy="500" r="440" className="orb-hud-line orb-hud-line--dots" />
      </g>

      {/* Segments counterclockwise */}
      <g className="orb-hud-rot orb-hud-rot--segments">
        <circle cx="500" cy="500" r="410" className="orb-hud-line orb-hud-line--containment" />
        <circle cx="500" cy="500" r="390" className="orb-hud-line orb-hud-line--arc" />
      </g>

      {/* Amber alert/status accents */}
      <g className="orb-hud-rot orb-hud-rot--amber">
        <circle cx="500" cy="500" r="360" className="orb-hud-line orb-hud-line--amber" />
        <circle cx="500" cy="500" r="340" className="orb-hud-line orb-hud-line--amber orb-hud-line--amber-short" />
      </g>

      {/* Inner containment & diagnostic sweep */}
      <g className="orb-hud-rot orb-hud-rot--inner">
        <circle cx="500" cy="500" r="300" className="orb-hud-line orb-hud-line--inner" />
        <circle cx="500" cy="500" r="280" className="orb-hud-line orb-hud-line--faint" />
      </g>

      {/* Radar sweep */}
      <g className="orb-hud-sweep">
        <path d="M 500 500 L 500 20 A 480 480 0 0 1 839 160 Z" />
        <line x1="500" y1="500" x2="839" y2="160" />
      </g>

      {/* Diagnostic nodes */}
      <g className="orb-hud-node" transform="translate(500, 20)">
        <circle r="4" />
        <circle r="9" className="orb-hud-node__halo" />
      </g>
      <g className="orb-hud-node" transform="translate(980, 500)">
        <circle r="4" />
        <circle r="9" className="orb-hud-node__halo" />
      </g>
      <g className="orb-hud-node" transform="translate(500, 980)">
        <circle r="4" />
        <circle r="9" className="orb-hud-node__halo" />
      </g>
      <g className="orb-hud-node" transform="translate(20, 500)">
        <circle r="4" />
        <circle r="9" className="orb-hud-node__halo" />
      </g>
    </svg>
  );
}
