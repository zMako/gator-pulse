import * as THREE from 'three'

// One set of uniform objects shared by the sky dome and the building facades, so the windows
// reflect the same sky the dome draws.
export const env = {
  uNight: { value: 1 },
  uTime: { value: 0 },
  uZenith: { value: new THREE.Color() },
  uHorizon: { value: new THREE.Color() },
  uGlow: { value: new THREE.Color() },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uSunColor: { value: new THREE.Color() },
  uSunDisc: { value: 0 },
  uStars: { value: 0 },
}

export const SKY_GLSL = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGlow;
uniform vec3 uSunDir;
vec3 gpSky(vec3 d) {
  float h = max(d.y, 0.0);
  vec3 c = mix(uHorizon, uZenith, pow(h, 0.5));
  float az = pow(max(dot(normalize(d.xz + vec2(1e-5)), normalize(uSunDir.xz)), 0.0), 3.0);
  // The glow starts just above the horizon so distant fogged ground meets the sky seamlessly.
  c += uGlow * az * exp(-h * 7.0) * smoothstep(0.0, 0.035, d.y);
  return c;
}
`

export function skyDome(): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    uniforms: env,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      ${SKY_GLSL}
      uniform vec3 uSunColor;
      uniform float uSunDisc;
      uniform float uStars;
      varying vec3 vDir;
      float gpHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        vec3 d = normalize(vDir);
        vec3 c = gpSky(d);
        float s = max(dot(d, uSunDir), 0.0);
        c += uSunColor * (smoothstep(0.9993, 0.9997, s) * 9.0 + pow(s, 220.0) * 0.9 + pow(s, 14.0) * 0.16) * uSunDisc;
        vec2 cell = floor(d.xz / (0.35 + d.y) * 260.0);
        c += vec3(0.9, 0.95, 1.0) * step(0.9972, gpHash(cell)) * smoothstep(0.12, 0.5, d.y) * uStars;
        gl_FragColor = vec4(c, 1.0);
      }`,
  })
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(5000, 48, 24), material)
  mesh.renderOrder = -10
  mesh.frustumCulled = false
  return mesh
}
