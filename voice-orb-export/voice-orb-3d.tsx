'use client';

import React, { useMemo, useRef, useEffect, Suspense } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';

// Original Perlin Noise Shaders aus Bruno Simons Repo
const perlinNoise = `
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x*34.0)+10.0)*x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
  vec3 fade(vec3 t) { return t*t*t*(t*(t*6.0-15.0)+10.0); }
  vec4 fade(vec4 t) { return t*t*t*(t*(t*6.0-15.0)+10.0); }

  float perlin4d(vec4 P) {
    vec4 Pi0 = floor(P); vec4 Pi1 = Pi0 + 1.0;
    Pi0 = mod289(Pi0); Pi1 = mod289(Pi1);
    vec4 Pf0 = fract(P); vec4 Pf1 = Pf0 - 1.0;
    vec4 ix = vec4(Pi0.x, Pi1.x, Pi0.x, Pi1.x); vec4 iy = vec4(Pi0.yy, Pi1.yy);
    vec4 iz0 = vec4(Pi0.zzzz); vec4 iz1 = vec4(Pi1.zzzz);
    vec4 iw0 = vec4(Pi0.wwww); vec4 iw1 = vec4(Pi1.wwww);
    vec4 ixy = permute(permute(ix) + iy);
    vec4 ixy0 = permute(ixy + iz0); vec4 ixy1 = permute(ixy + iz1);
    vec4 ixy00 = permute(ixy0 + iw0); vec4 ixy01 = permute(ixy0 + iw1);
    vec4 ixy10 = permute(ixy1 + iw0); vec4 ixy11 = permute(ixy1 + iw1);
    vec4 gx00 = ixy00 * (1.0 / 7.0); vec4 gy00 = floor(gx00) * (1.0 / 7.0); vec4 gz00 = floor(gy00) * (1.0 / 6.0);
    gx00 = fract(gx00) - 0.5; gy00 = fract(gy00) - 0.5; gz00 = fract(gz00) - 0.5;
    vec4 gw00 = vec4(0.75) - abs(gx00) - abs(gy00) - abs(gz00);
    vec4 sw00 = step(gw00, vec4(0.0)); gx00 -= sw00 * (step(0.0, gx00) - 0.5); gy00 -= sw00 * (step(0.0, gy00) - 0.5);
    vec4 gx01 = ixy01 * (1.0 / 7.0); vec4 gy01 = floor(gx01) * (1.0 / 7.0); vec4 gz01 = floor(gy01) * (1.0 / 6.0);
    gx01 = fract(gx01) - 0.5; gy01 = fract(gy01) - 0.5; gz01 = fract(gz01) - 0.5;
    vec4 gw01 = vec4(0.75) - abs(gx01) - abs(gy01) - abs(gz01);
    vec4 sw01 = step(gw01, vec4(0.0)); gx01 -= sw01 * (step(0.0, gx01) - 0.5); gy01 -= sw01 * (step(0.0, gy01) - 0.5);
    vec4 gx10 = ixy10 * (1.0 / 7.0); vec4 gy10 = floor(gx10) * (1.0 / 7.0); vec4 gz10 = floor(gy10) * (1.0 / 6.0);
    gx10 = fract(gx10) - 0.5; gy10 = fract(gy10) - 0.5; gz10 = fract(gz10) - 0.5;
    vec4 gw10 = vec4(0.75) - abs(gx10) - abs(gy10) - abs(gz10);
    vec4 sw10 = step(gw10, vec4(0.0)); gx10 -= sw10 * (step(0.0, gx10) - 0.5); gy10 -= sw10 * (step(0.0, gy10) - 0.5);
    vec4 gx11 = ixy11 * (1.0 / 7.0); vec4 gy11 = floor(gx11) * (1.0 / 7.0); vec4 gz11 = floor(gy11) * (1.0 / 6.0);
    gx11 = fract(gx11) - 0.5; gy11 = fract(gy11) - 0.5; gz11 = fract(gz11) - 0.5;
    vec4 gw11 = vec4(0.75) - abs(gx11) - abs(gy11) - abs(gz11);
    vec4 sw11 = step(gw11, vec4(0.0)); gx11 -= sw11 * (step(0.0, gx11) - 0.5); gy11 -= sw11 * (step(0.0, gy11) - 0.5);
    vec4 g0000 = vec4(gx00.x,gy00.x,gz00.x,gw00.x); vec4 g1000 = vec4(gx00.y,gy00.y,gz00.y,gw00.y);
    vec4 g0100 = vec4(gx00.z,gy00.z,gz00.z,gw00.z); vec4 g1100 = vec4(gx00.w,gy00.w,gz00.w,gw00.w);
    vec4 g0010 = vec4(gx10.x,gy10.x,gz10.x,gw10.x); vec4 g1010 = vec4(gx10.y,gy10.y,gz10.y,gw10.y);
    vec4 g0110 = vec4(gx10.z,gy10.z,gz10.z,gw10.z); vec4 g1110 = vec4(gx10.w,gy10.w,gz10.w,gw10.w);
    vec4 g0001 = vec4(gx01.x,gy01.x,gz01.x,gw01.x); vec4 g1001 = vec4(gx01.y,gy01.y,gz01.y,gw01.y);
    vec4 g0101 = vec4(gx01.z,gy01.z,gz01.z,gw01.z); vec4 g1101 = vec4(gx01.w,gy01.w,gz01.w,gw01.w);
    vec4 g0011 = vec4(gx11.x,gy11.x,gz11.x,gw11.x); vec4 g1011 = vec4(gx11.y,gy11.y,gz11.y,gw11.y);
    vec4 g0111 = vec4(gx11.z,gy11.z,gz11.z,gw11.z); vec4 g1111 = vec4(gx11.w,gy11.w,gz11.w,gw11.w);
    vec4 norm00 = taylorInvSqrt(vec4(dot(g0000, g0000), dot(g0100, g0100), dot(g1000, g1000), dot(g1100, g1100)));
    g0000 *= norm00.x; g0100 *= norm00.y; g1000 *= norm00.z; g1100 *= norm00.w;
    vec4 norm01 = taylorInvSqrt(vec4(dot(g0001, g0001), dot(g0101, g0101), dot(g1001, g1001), dot(g1101, g1101)));
    g0001 *= norm01.x; g0101 *= norm01.y; g1001 *= norm01.z; g1101 *= norm01.w;
    vec4 norm10 = taylorInvSqrt(vec4(dot(g0010, g0010), dot(g0110, g0110), dot(g1010, g1010), dot(g1110, g1110)));
    g0010 *= norm10.x; g0110 *= norm10.y; g1010 *= norm10.z; g1110 *= norm10.w;
    vec4 norm11 = taylorInvSqrt(vec4(dot(g0011, g0011), dot(g0111, g0111), dot(g1011, g1011), dot(g1111, g1111)));
    g0011 *= norm11.x; g0111 *= norm11.y; g1011 *= norm11.z; g1111 *= norm11.w;
    float n0000 = dot(g0000, Pf0); float n1000 = dot(g1000, vec4(Pf1.x, Pf0.yzw));
    float n0100 = dot(g0100, vec4(Pf0.x, Pf1.y, Pf0.zw)); float n1100 = dot(g1100, vec4(Pf1.xy, Pf0.zw));
    float n0010 = dot(g0010, vec4(Pf0.xy, Pf1.z, Pf0.w)); float n1010 = dot(g1010, vec4(Pf1.x, Pf0.y, Pf1.z, Pf0.w));
    float n0110 = dot(g0110, vec4(Pf0.x, Pf1.yz, Pf0.w)); float n1110 = dot(g1110, vec4(Pf1.xyz, Pf0.w));
    float n0001 = dot(g0001, vec4(Pf0.xyz, Pf1.w)); float n1001 = dot(g1001, vec4(Pf1.x, Pf0.yz, Pf1.w));
    float n0101 = dot(g0101, vec4(Pf0.x, Pf1.y, Pf0.z, Pf1.w)); float n1101 = dot(g1101, vec4(Pf1.xy, Pf0.z, Pf1.w));
    float n0011 = dot(g0011, vec4(Pf0.xy, Pf1.zw)); float n1011 = dot(g1011, vec4(Pf1.x, Pf0.y, Pf1.zw));
    float n0111 = dot(g0111, vec4(Pf0.x, Pf1.yzw)); float n1111 = dot(g1111, Pf1);
    vec4 fade_xyzw = fade(Pf0.xyzw);
    vec4 n_0w = mix(vec4(n0000, n1000, n0100, n1100), vec4(n0001, n1001, n0101, n1101), fade_xyzw.w);
    vec4 n_1w = mix(vec4(n0010, n1010, n0110, n1110), vec4(n0011, n1011, n0111, n1111), fade_xyzw.w);
    vec4 n_zw = mix(n_0w, n_1w, fade_xyzw.z);
    vec2 n_yzw = mix(n_zw.xy, n_zw.zw, fade_xyzw.y);
    return 2.2 * mix(n_yzw.x, n_yzw.y, fade_xyzw.x);
  }
`;

const vertexShader = `
  #define M_PI 3.1415926535897932384626433832795

  uniform vec3 uLightAColor;
  uniform vec3 uLightAPosition;
  uniform float uLightAIntensity;
  uniform vec3 uLightBColor;
  uniform vec3 uLightBPosition;
  uniform float uLightBIntensity;
  uniform vec2 uSubdivision;
  uniform vec3 uOffset;
  uniform float uDistortionFrequency;
  uniform float uDistortionStrength;
  uniform float uDisplacementFrequency;
  uniform float uDisplacementStrength;
  uniform float uFresnelOffset;
  uniform float uFresnelMultiplier;
  uniform float uFresnelPower;
  uniform float uTime;

  varying vec3 vColor;

  ${perlinNoise}

  vec3 getDisplacedPosition(vec3 _position) {
    vec3 distortedPosition = _position;
    distortedPosition += perlin4d(vec4(distortedPosition * uDistortionFrequency + uOffset, uTime)) * uDistortionStrength;
    float perlinStrength = perlin4d(vec4(distortedPosition * uDisplacementFrequency + uOffset, uTime));
    vec3 displacedPosition = _position;
    displacedPosition += normalize(_position) * perlinStrength * uDisplacementStrength;
    return displacedPosition;
  }

  void main() {
    vec3 displacedPosition = getDisplacedPosition(position);
    vec4 viewPosition = viewMatrix * vec4(displacedPosition, 1.0);
    gl_Position = projectionMatrix * viewPosition;

    float distanceA = (M_PI * 2.0) / uSubdivision.x;
    float distanceB = M_PI / uSubdivision.y;
    vec3 biTangent = cross(normal, tangent.xyz);
    vec3 positionA = position + tangent.xyz * distanceA;
    vec3 displacedPositionA = getDisplacedPosition(positionA);
    vec3 positionB = position + biTangent.xyz * distanceB;
    vec3 displacedPositionB = getDisplacedPosition(positionB);
    vec3 computedNormal = normalize(cross(displacedPositionA - displacedPosition, displacedPositionB - displacedPosition));

    vec3 viewDirection = normalize(displacedPosition - cameraPosition);
    float fresnel = uFresnelOffset + (1.0 + dot(viewDirection, computedNormal)) * uFresnelMultiplier;
    fresnel = pow(max(0.0, fresnel), uFresnelPower);

    float lightAIntensity = max(0.0, -dot(computedNormal, normalize(-uLightAPosition))) * uLightAIntensity;
    float lightBIntensity = max(0.0, -dot(computedNormal, normalize(-uLightBPosition))) * uLightBIntensity;
    
    // EXAKTE Bruno Simon Farbmischung
    vec3 color = vec3(0.0);
    color = mix(color, uLightAColor, lightAIntensity * fresnel);
    color = mix(color, uLightBColor, lightBIntensity * fresnel);
    color = mix(color, vec3(1.0), clamp(pow(max(0.0, fresnel - 0.8), 3.0), 0.0, 1.0));
    vColor = color;
  }
`;

const fragmentShader = `
  varying vec3 vColor;
  void main() {
    gl_FragColor = vec4(vColor, 1.0);
  }
`;

// Innere Komponente: Nutzt useRef für die Levels, um Stale Closures zu vermeiden
function SphereMesh({ levelsRef, paused = false }: { levelsRef: React.MutableRefObject<number[]>, paused?: boolean }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  // Brunos Easing-Variablen
  // Easing: up = wie schnell der Wert steigt, down = wie schnell er fällt
  const variationsRef = useRef({
    volume: { current: 0.152, target: 0.152, up: 0.008, down: 0.003 },
    low: { current: 0.0003, target: 0.0003, up: 0.003, down: 0.002 },
    mid: { current: 3.587, target: 3.587, up: 0.006, down: 0.004 },
    high: { current: 0.65, target: 0.65, up: 0.006, down: 0.002 },
  });

  // Farben und Licht passend zum Referenzbild (leuchtend, nicht dunkel)
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uOffset: { value: new THREE.Vector3() },
      uDistortionFrequency: { value: 1.5 },
      uDistortionStrength: { value: 0.65 },
      uDisplacementFrequency: { value: 2.12 },
      uDisplacementStrength: { value: 0.152 },
      uSubdivision: { value: new THREE.Vector2(512, 512) },
      // Licht A: Warmes Orange-Rot (oben rechts im Referenzbild)
      uLightAColor: { value: new THREE.Color('#ff0080') },
      uLightAPosition: {
        value: new THREE.Vector3().setFromSpherical(new THREE.Spherical(1, 0.615, 2.049)),
      },
      uLightAIntensity: { value: 1.8 },
      // Licht B: Helles Cyan-Blau (unten links im Referenzbild)
      uLightBColor: { value: new THREE.Color('#00aaff') },
      uLightBPosition: {
        value: new THREE.Vector3().setFromSpherical(new THREE.Spherical(1, 2.561, -1.844)),
      },
      uLightBIntensity: { value: 2.0 },
      // Fresnel: Breiter Glow (niedrigere Power = breiterer Schein)
      uFresnelOffset: { value: -1.2 },
      uFresnelMultiplier: { value: 3.0 },
      uFresnelPower: { value: 1.5 },
    }),
    []
  );

  useFrame((_state, delta) => {
    if (paused) return; // GPU-Schonung: Render-Loop pausieren
    
    const vars = variationsRef.current;
    const dt = delta * 1000;
    // KORREKT: Levels über Ref lesen, nicht über Props
    const levels = levelsRef.current;

    // Audio-Mapping: Organische Deformation, etwas sensibler
    const maxLevel = Math.max(levels[0], levels[1], levels[2]);
    // Volume → Displacement: 0.152 (still) bis ~0.35 (laut)
    vars.volume.target = 0.152 + maxLevel * 0.2;
    // Low → Zeitgeschwindigkeit
    vars.low.target = 0.0003 + levels[0] * 0.002;
    // Mid → Fresnel-Glow: 3.0 (still) bis ~4.0 (laut)
    vars.mid.target = 3.0 + levels[1] * 1.0;
    // High → Distortion: 0.65 (still) bis ~0.95 (laut)
    vars.high.target = 0.65 + levels[2] * 0.3;

    // Easing
    for (const key in vars) {
      const v = (vars as any)[key];
      const easing = v.target > v.current ? v.up : v.down;
      v.current += (v.target - v.current) * easing * dt;
    }

    if (materialRef.current) {
      const u = materialRef.current.uniforms;
      const timeFrequency = vars.low.current;
      u.uTime.value += dt * timeFrequency;
      u.uDisplacementStrength.value = vars.volume.current;
      u.uDistortionStrength.value = vars.high.current;
      u.uFresnelMultiplier.value = vars.mid.current;

      const offsetTime = u.uTime.value * 300.3;
      const phi =
        (Math.sin(offsetTime * 0.001) * Math.sin(offsetTime * 0.00321) * 0.5 + 0.5) * Math.PI;
      const theta =
        (Math.sin(offsetTime * 0.0001) * Math.sin(offsetTime * 0.000321) * 0.5 + 0.5) * Math.PI * 2;
      const dir = new THREE.Vector3().setFromSpherical(new THREE.Spherical(1, phi, theta));
      dir.multiplyScalar(timeFrequency * 2);
      u.uOffset.value.add(dir);
    }
  });

  return (
    <mesh ref={meshRef} scale={1.2}>
      <sphereGeometry args={[1, 512, 512]} onUpdate={self => self.computeTangents()} />
      <shaderMaterial
        ref={materialRef}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        transparent={true}
        defines={{ USE_TANGENT: '' }}
      />
    </mesh>
  );
}

// Äußere Komponente: Empfängt Levels als Prop, synchronisiert über Ref
export function VoiceOrb3D({
  levels = new Array(8).fill(0),
  paused = false,
  className = 'w-full h-full',
}: {
  levels?: number[];
  paused?: boolean;
  className?: string;
}) {
  const levelsRef = useRef(levels);

  // Ref immer synchron halten
  useEffect(() => {
    levelsRef.current = levels;
  }, [levels]);

  return (
    <div className={`relative flex items-center justify-center ${className}`}>
      <Canvas camera={{ position: [0, 0, 3], fov: 45 }} gl={{ antialias: true, alpha: true }}>
        <Suspense fallback={null}>
          <SphereMesh levelsRef={levelsRef} paused={paused} />
        </Suspense>

        <EffectComposer enableNormalPass={false}>
          <Bloom luminanceThreshold={0.0} intensity={0.6} radius={0.4} mipmapBlur />
          <Vignette eskil={false} offset={0.1} darkness={1.1} />
        </EffectComposer>
      </Canvas>
    </div>
  );
}
