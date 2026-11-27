/**
 * Damage you can see (Kelbo, 27 November 2026): mud, dust, snow, stone chips
 * and dents drawn on a truck by its own material, with no extra textures and
 * no extra draw calls.
 *
 * A truck's paint is one shared material (`Truck`, from the HD pass). The
 * grimy truck gets its own copy of it with a few lines added to three.js's
 * shader, which work out for each pixel:
 *
 * - **Where it is on the truck**, in the body's own space (`uGrimeSpace`), so
 *   the mud line stays put while the body bounces: height above the ground,
 *   how near a wheel arch, and which way the surface faces.
 * - **A splotchy pattern** (value noise) that breaks the edges up, so the mud
 *   isn't a ruler-straight band. Wheels and tires get a second copy whose
 *   pattern is in their own space, so it turns with them.
 * - **Then, in order:** chipped paint low down, dents (the surface shading is
 *   bent, as if the panel were pushed in, with scraped paint), a film of
 *   dust (more low down and at the back), mud from the ground up and packed
 *   into the arches with splashes above, and snow on whatever faces up and
 *   packed low down.
 *
 * The Lite graphics tier (`grimeDetail` off) draws a simpler version: one
 * layer of the pattern, no chips, and dents as scraped paint only.
 */
import * as THREE from 'three'
import { GRIME, GRIME_LOOK } from '../data/grime'
import type { Grime } from '../sim/grime'

/** The values the shader reads, shared by a truck's two grime materials. */
export interface GrimeUniforms {
  uGrimeSpace: { value: THREE.Matrix4 }
  /** mud, dust, snow, chips */
  uGrime: { value: THREE.Vector4 }
  uGrimeWet: { value: number }
  /** Tire radius, front axle x, rear axle x (m), and half the track (m). */
  uGrimeShape: { value: THREE.Vector4 }
  uMudColour: { value: THREE.Color }
  /** Each dent's centre (body space, m) and radius (m); and how deep, with how wide across the truck it reaches. */
  uDents: { value: THREE.Vector4[] }
  uDentAmount: { value: THREE.Vector2[] }
}

export function grimeUniforms(): GrimeUniforms {
  return {
    uGrimeSpace: { value: new THREE.Matrix4() },
    uGrime: { value: new THREE.Vector4() },
    uGrimeWet: { value: 0 },
    uGrimeShape: { value: new THREE.Vector4(0.4, 1.5, -1.5, 0.8) },
    uMudColour: { value: new THREE.Color(GRIME_LOOK.mud.summer) },
    uDents: { value: Array.from({ length: GRIME.maxDents }, () => new THREE.Vector4(0, -10, 0, 0.01)) },
    uDentAmount: { value: Array.from({ length: GRIME.maxDents }, () => new THREE.Vector2(0, 1)) },
  }
}

/** Put a raid moment's grime into the uniforms (the dents' places are worked out by the truck). */
export function setGrimeUniforms(u: GrimeUniforms, g: Grime, dents: readonly { centre: THREE.Vector3; radius: number; across: number; amount: number }[]): void {
  u.uGrime.value.set(g.mud, g.dust, g.snow, g.chips)
  u.uGrimeWet.value = g.wet
  u.uMudColour.value.set(GRIME_LOOK.mud[g.season])
  for (let i = 0; i < GRIME.maxDents; i++) {
    const d = dents[i]
    if (d) {
      u.uDents.value[i]!.set(d.centre.x, d.centre.y, d.centre.z, d.radius)
      u.uDentAmount.value[i]!.set(d.amount, d.across)
    } else {
      u.uDentAmount.value[i]!.set(0, 1)
    }
  }
}

const hex = (c: string): string => {
  const v = new THREE.Color(c)
  return `vec3(${v.r.toFixed(4)}, ${v.g.toFixed(4)}, ${v.b.toFixed(4)})`
}

const VERTEX_HEAD = /* glsl */ `
uniform mat4 uGrimeSpace;
varying vec3 vGrimeBody;
varying vec3 vGrimePattern;
varying vec3 vGrimeUp;
`

const VERTEX_BODY = /* glsl */ `
vGrimeBody = (uGrimeSpace * modelMatrix * vec4(transformed, 1.0)).xyz;
vGrimeUp = normalize(mat3(uGrimeSpace * modelMatrix) * objectNormal);
#ifdef GRIME_SPIN
  vGrimePattern = transformed;
#else
  vGrimePattern = vGrimeBody;
#endif
`

/** Everything the fragment shader adds before main(): uniforms, a hash, value noise. */
function fragmentHead(): string {
  return /* glsl */ `
uniform vec4 uGrime;
uniform float uGrimeWet;
uniform vec4 uGrimeShape;
uniform vec3 uMudColour;
uniform vec4 uDents[${GRIME.maxDents}];
uniform vec2 uDentAmount[${GRIME.maxDents}];
varying vec3 vGrimeBody;
varying vec3 vGrimePattern;
varying vec3 vGrimeUp;

float grimeHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
// Smooth value noise, 0 to 1.
float grimeNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(grimeHash(i), grimeHash(i + vec3(1, 0, 0)), f.x),
                 mix(grimeHash(i + vec3(0, 1, 0)), grimeHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(grimeHash(i + vec3(0, 0, 1)), grimeHash(i + vec3(1, 0, 1)), f.x),
                 mix(grimeHash(i + vec3(0, 1, 1)), grimeHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
`
}

/** Colour: worked out after the paint's own colour, before the lighting. */
function fragmentColour(): string {
  return /* glsl */ `
float grimeDentH = 0.0;
float grimeMat = 0.0;
// The layers' roughness, laid over the paint's own once three.js has read it:
// the paint shows through by (1 - grimeCover), the layers add grimeRough.
float grimeRough = 0.0;
float grimeCover = 0.0;
{
  float r = uGrimeShape.x;
  float h = vGrimeBody.y;
  vec3 up = normalize(vGrimeUp);
  float n1 = grimeNoise(vGrimePattern * 2.6);
#ifdef GRIME_LITE
  float n2 = n1;
#else
  float n2 = grimeNoise(vGrimePattern * 9.0 + 7.0);
#endif
  float low = 1.0 - smoothstep(0.0, r * 3.0, h);
  vec3 c = diffuseColor.rgb;
  #define GRIME_LAYER(t, a) grimeRough = grimeRough * (1.0 - (a)) + (t) * (a); grimeCover = 1.0 - (1.0 - grimeCover) * (1.0 - (a));

#ifndef GRIME_LITE
  // Stone chips: small flecks of bare primer, low down and on the front.
  float front = smoothstep(uGrimeShape.z, uGrimeShape.y + r, vGrimeBody.x);
  float chipAt = step(1.0 - 0.14 * uGrime.w * (0.4 + front) * low, grimeNoise(vGrimePattern * 38.0));
  c = mix(c, ${hex(GRIME_LOOK.chip)}, chipAt);
  GRIME_LAYER(${GRIME_LOOK.rough.chip.toFixed(2)}, chipAt)
#endif

  // Dents: a bowl pushed into the panel, with the paint scraped where it hit hardest.
  for (int i = 0; i < ${GRIME.maxDents}; i++) {
    float amt = uDentAmount[i].x;
    if (amt <= 0.0) continue;
    vec3 d = vGrimeBody - uDents[i].xyz;
    d.z *= uDentAmount[i].y;
    float s = length(d) / uDents[i].w;
    if (s >= 1.0) continue;
    float bowl = (1.0 - s * s) * (1.0 - s * s);
    grimeDentH -= amt * bowl * (0.75 + 0.5 * n2);
    // Scratches run along the truck: a pattern stretched lengthways.
    float scrape = amt * (1.0 - smoothstep(0.3, 0.85, s)) * smoothstep(0.38, 0.46, grimeNoise(vec3(vGrimeBody.x * 3.0, vGrimeBody.y * 28.0, vGrimeBody.z * 3.0)));
    // Darker in the hollow, and a crease round its edge.
    float crease = smoothstep(0.55, 0.75, s) * (1.0 - smoothstep(0.75, 0.95, s));
    c = mix(c * (1.0 - amt * (0.3 * bowl + 0.35 * crease)), ${hex(GRIME_LOOK.scrape)}, scrape * 0.85);
    GRIME_LAYER(${GRIME_LOOK.rough.scrape.toFixed(2)}, scrape)
  }

  // Dust: a film all over, thicker low down, at the back and on top.
  float rear = 1.0 - smoothstep(uGrimeShape.z - r, uGrimeShape.y, vGrimeBody.x);
  float dust = uGrime.y * (0.45 + 0.35 * low + 0.15 * rear + 0.2 * max(up.y, 0.0)) * (0.65 + 0.6 * n1);
  dust = clamp(dust, 0.0, ${GRIME_LOOK.dustMax.toFixed(2)});
  c = mix(c, ${hex(GRIME_LOOK.dust)}, dust);
  GRIME_LAYER(${GRIME_LOOK.rough.dust.toFixed(2)}, dust)

  // Mud: up from the ground to a ragged line that climbs as more builds up,
  // packed into the wheel arches, and splashed in spots above the line.
  float mud = uGrime.x;
  float line = r * (1.2 + 2.6 * mud) + (n1 - 0.5) * r * 0.9;
  float body = 1.0 - smoothstep(line - r * 0.2, line + r * 0.2, h);
  vec2 toF = vec2(vGrimeBody.x - uGrimeShape.y, h - r);
  vec2 toR = vec2(vGrimeBody.x - uGrimeShape.z, h - r);
  float arch = 1.0 - smoothstep(r * 0.95, r * 1.45, min(length(toF), length(toR)));
  #ifdef GRIME_LITE
  float n3 = n1;
#else
  float n3 = grimeNoise(vGrimePattern * 34.0 + 3.0);
#endif
  // Splashes: spots where two patterns both run high, thinning out with height.
  float spot = n3 * 0.65 + n2 * 0.35;
  float splash = smoothstep(0.84 - 0.1 * mud, 0.87 - 0.1 * mud, spot) * (1.0 - smoothstep(line, line + r * 2.0, h));
  float under = (1.0 - smoothstep(-0.7, -0.2, up.y)) * smoothstep(0.0, 0.3, mud);
  float m = max(max(body * smoothstep(0.25, 0.5, n2 + mud * 0.35), arch * smoothstep(0.0, 0.35, mud)), max(splash, under));
#ifdef GRIME_SPIN
  // Wheels: the rims still show through in places.
  m *= 0.55 + 0.45 * smoothstep(0.3, 0.6, n1);
#endif
  m *= min(1.0, mud * 2.5);
  vec3 mudColour = mix(uMudColour, ${hex(GRIME_LOOK.wetMud)}, uGrimeWet);
  c = mix(c, mudColour, m);
  GRIME_LAYER(mix(${GRIME_LOOK.rough.mud.toFixed(2)}, ${GRIME_LOOK.rough.wetMud.toFixed(2)}, uGrimeWet), m)

  // Snow: on whatever faces up, and packed low down and in the arches.
  float snow = uGrime.z;
  float top = smoothstep(0.5, 0.8, up.y + (n1 - 0.5) * 0.35) * smoothstep(0.05, 0.5, snow);
  float packed = max(1.0 - smoothstep(r * (0.4 + 1.3 * snow), r * (0.6 + 1.5 * snow), h + (n2 - 0.5) * r * 0.5), arch * 0.85)
    * smoothstep(0.56 - 0.22 * snow, 0.62 - 0.22 * snow, n2 * 0.6 + n1 * 0.4);
#ifdef GRIME_SPIN
  // Turning tires throw most of it off again: a little in the tread.
  packed *= 0.15;
  top *= 0.4;
#endif
  float sn = clamp(max(top, packed) * min(1.0, snow * 2.0), 0.0, 1.0);
  c = mix(c, ${hex(GRIME_LOOK.snow)}, sn);
  GRIME_LAYER(${GRIME_LOOK.rough.snow.toFixed(2)}, sn)

  diffuseColor.rgb = c;
  // Mud, dust and snow aren't metal.
  grimeMat = max(max(m, sn), dust * 0.8);
}
`
}

/** Finish: the grime's roughness, and no metal under it. */
const FRAGMENT_FINISH = /* glsl */ `
roughnessFactor = roughnessFactor * (1.0 - grimeCover) + grimeRough;
metalnessFactor *= 1.0 - grimeMat;
`

/**
 * The dents' shading: bend the surface by how fast the dent's depth changes
 * from pixel to pixel (the same sum three.js uses for a bump map).
 */
const FRAGMENT_DENTS = /* glsl */ `
#ifndef GRIME_LITE
{
  float hgt = grimeDentH * ${GRIME_LOOK.dentDepth.toFixed(3)};
  vec3 sx = dFdx(-vViewPosition);
  vec3 sy = dFdy(-vViewPosition);
  vec3 r1 = cross(sy, normal);
  vec3 r2 = cross(normal, sx);
  float det = dot(sx, r1) * faceDirection;
  vec2 dh = vec2(dFdx(hgt), dFdy(hgt));
  vec3 grad = sign(det) * (dh.x * r1 + dh.y * r2);
  if (abs(det) > 0.0) normal = normalize(abs(det) * normal - grad);
}
#endif
`

/**
 * A grimy copy of the truck's shared material. `spin` is the wheels' copy
 * (its pattern turns with them); `lite` is the Lite tier's simpler one.
 */
export function grimeMaterial(base: THREE.MeshStandardMaterial, u: GrimeUniforms, spin: boolean, lite: boolean): THREE.MeshStandardMaterial {
  const m = base.clone()
  m.name = `${base.name}-grime`
  const defines: Record<string, string> = {}
  if (spin) defines.GRIME_SPIN = ''
  if (lite) defines.GRIME_LITE = ''
  m.defines = { ...(m.defines ?? {}), ...defines }
  m.customProgramCacheKey = () => `grime-${spin ? 's' : 'b'}-${lite ? 'l' : 'f'}`
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u)
    shader.vertexShader = VERTEX_HEAD + shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>\n${VERTEX_BODY}`)
    shader.fragmentShader = fragmentHead() + shader.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>\n${fragmentColour()}`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>\n${FRAGMENT_FINISH}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${FRAGMENT_DENTS}`)
  }
  return m
}
