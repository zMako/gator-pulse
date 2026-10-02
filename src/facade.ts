import * as THREE from 'three'
import { env, SKY_GLSL } from './sky'

// Buildings are plain extrusions; this patches MeshStandardMaterial so the walls get procedural
// windows while still using three's own lighting, shadows and fog.
// Per-vertex aInfo = (seed, building height, on-campus flag).

const VERTEX_HEAD = /* glsl */ `
attribute vec3 aInfo;
varying vec3 vWp;
varying vec3 vOn;
varying vec3 vInfo;
`

const VERTEX_BODY = /* glsl */ `
vWp = (modelMatrix * vec4(position, 1.0)).xyz;
vOn = normal;
vInfo = aInfo;
`

const FRAGMENT_HEAD = /* glsl */ `
uniform float uNight;
uniform float uTime;
${SKY_GLSL}
varying vec3 vWp;
varying vec3 vOn;
varying vec3 vInfo;
float gpHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float gpBand(float lo, float hi, float x, float fw) {
  return smoothstep(lo - fw, lo + fw, x) * (1.0 - smoothstep(hi - fw, hi + fw, x));
}
`

const FRAGMENT_BODY = /* glsl */ `
vec3 gpEmit = vec3(0.0);
float gpRough = 0.92;
{
  vec3 on = normalize(vOn);
  float seed = vInfo.x;
  float bh = vInfo.y;
  float campus = vInfo.z;

  // Wall colour: concrete to sandstone, with the occasional brick building.
  vec3 wall = mix(vec3(0.60, 0.585, 0.56), vec3(0.70, 0.64, 0.55), gpHash(vec2(seed, 7.7)));
  wall = mix(wall, vec3(0.50, 0.33, 0.27), step(0.86, gpHash(vec2(seed, 2.3))));
  wall *= 0.82 + 0.3 * gpHash(vec2(seed, 4.2));
  wall *= mix(vec3(mix(0.86, 0.42, uNight)), vec3(1.0), campus);

  if (on.y > 0.5) {
    diffuseColor.rgb = mix(vec3(0.46, 0.46, 0.48), wall, 0.3);
  } else if (on.y < -0.5 || bh < 1.0) {
    diffuseColor.rgb = wall * 0.8;
  } else {
    vec2 along = normalize(vec2(-on.z, on.x));
    float u = dot(vWp.xz, along);
    float v = vWp.y;
    float fh = 3.7;
    float floors = floor(bh / fh);
    float style = floor(gpHash(vec2(seed, 9.1)) * 3.0);
    float cw = style < 0.5 ? 3.2 : (style < 1.5 ? 2.6 : 1.9);
    vec2 g = vec2(u / cw, v / fh);
    vec2 cell = floor(g);
    vec2 f = fract(g);
    vec2 fw = fwidth(g);

    // Three facade styles: punched windows, ribbon windows, curtain wall.
    float win;
    vec2 room = cell;
    if (style < 0.5) {
      win = gpBand(0.20, 0.80, f.x, fw.x) * gpBand(0.26, 0.80, f.y, fw.y);
    } else if (style < 1.5) {
      win = gpBand(0.035, 0.965, f.x, fw.x) * gpBand(0.36, 0.78, f.y, fw.y);
      room = vec2(floor(cell.x / 3.0), cell.y);
    } else {
      win = gpBand(0.06, 0.94, f.x, fw.x) * gpBand(0.07, 0.93, f.y, fw.y);
      room = vec2(floor(cell.x / 2.0), cell.y);
    }
    win *= step(cell.y, floors - 0.5);
    win *= 1.0 - smoothstep(0.30, 0.75, max(fw.x, fw.y));

    float r = gpHash(room + seed * 91.7);
    float chance = mix(0.11, 0.32, campus) + (cell.y < 0.5 ? 0.25 : 0.0);
    float lit = step(1.0 - chance, r + 0.05 * sin(uTime * 0.35 + r * 60.0)) * uNight;
    vec3 lamp = mix(vec3(1.0, 0.70, 0.36), vec3(0.72, 0.86, 1.0), step(0.82, gpHash(room * 1.7 + seed)));
    lamp *= 1.1 + 1.7 * gpHash(room + 3.1);

    vec3 view = normalize(vWp - cameraPosition);
    vec3 refl = reflect(view, on);
    float fresnel = pow(1.0 - max(dot(-view, on), 0.0), 3.0);
    vec3 mirror = gpSky(vec3(refl.x, max(refl.y, 0.0) + mix(0.3, 0.04, uNight), refl.z));
    mirror *= mix(0.45, 1.0, smoothstep(-0.4, 0.1, refl.y)) * (mix(0.15, 0.26, uNight) + 0.74 * fresnel);

    wall *= mix(0.64, 1.0, smoothstep(0.0, 8.0, v));
    wall *= 1.0 - 0.3 * (1.0 - smoothstep(0.0, 0.07, f.y));
    wall *= 1.0 + 0.16 * smoothstep(bh - 0.9, bh - 0.6, v);

    diffuseColor.rgb = mix(wall, vec3(0.03, 0.04, 0.055), win);
    gpEmit = mix(mirror, lamp, lit) * win;
    gpRough = mix(0.92, 0.18, win);
  }
}
`

export function facadeMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0 })
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      uNight: env.uNight,
      uTime: env.uTime,
      uZenith: env.uZenith,
      uHorizon: env.uHorizon,
      uGlow: env.uGlow,
      uSunDir: env.uSunDir,
    })
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_HEAD}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERTEX_BODY}`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_HEAD}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAGMENT_BODY}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = gpRough;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += gpEmit;')
  }
  return material
}
