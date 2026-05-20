#version 300 es
// Hero fragment shader (GLSL ES 3.00 / WebGL2).
// Composition: a 2D signal field rendered as topographic isolines.
// Not a 3D primitive, not a particle field. Per DESIGN.md §7.

precision highp float;

uniform vec2  u_resolution;
uniform float u_time;
uniform vec2  u_mouse;        // 0..1
uniform vec2  u_flow;         // smoothed mouse velocity (-1..1)
uniform float u_scroll;       // smoothed scroll velocity (-1..1)
uniform float u_seed;         // per-visitor (0..1)
uniform float u_intro;        // 0..1 reveal progress
uniform vec3  u_bg;           // background ink (0..1)
uniform vec3  u_fg;           // foreground ink (0..1)
uniform vec3  u_accent;       // accent color (0..1)
uniform float u_dpr;
uniform float u_reduced;      // 1 if prefers-reduced-motion

in  vec2 v_uv;
out vec4 fragColor;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * vnoise(p);
    p = p * 2.05 + vec2(11.7, 4.3);
    a *= 0.5;
  }
  return v;
}

float isoline(float field, float density, float thickness) {
  float scaled = field * density;
  float dist = abs(fract(scaled) - 0.5);
  float w = max(thickness, fwidth(scaled) * 1.3);
  return 1.0 - smoothstep(w * 0.6, w, dist);
}

void main() {
  vec2 uv = v_uv;
  vec2 aspect = vec2(u_resolution.x / u_resolution.y, 1.0);
  vec2 p = (uv - 0.5) * aspect;

  vec2 mouse = (u_mouse - 0.5) * aspect;
  vec2 toMouse = mouse - p;
  float mouseFalloff = exp(-2.5 * dot(toMouse, toMouse));
  vec2 disp = u_flow * 0.18 * mouseFalloff;

  float seedShift = (u_seed - 0.5) * 4.0;
  vec2 q = p * 1.4 + vec2(seedShift, -seedShift * 0.7);
  q += disp;

  vec2 warp = vec2(
    fbm(q + vec2(0.0, u_time * 0.05)),
    fbm(q + vec2(5.2, u_time * 0.04 + 1.3))
  );
  q += (warp - 0.5) * 1.6;

  float f = fbm(q);

  float density = mix(8.0, 14.0, clamp(0.5 + u_scroll * 0.5, 0.0, 1.0));
  float thickness = mix(0.012, 0.006, clamp(0.5 + u_scroll * 0.5, 0.0, 1.0));

  float lines = isoline(f, density, thickness);

  float gradMag = length(vec2(dFdx(f), dFdy(f)));
  float accentMix = smoothstep(0.015, 0.04, gradMag) * (0.20 + 0.30 * mouseFalloff);

  float intro = u_reduced > 0.5 ? 1.0 : u_intro;
  float introMask = step(1.0 - intro - hash21(floor(uv * 22.0)) * 0.25, uv.y);
  lines *= introMask;

  float vignette = smoothstep(1.20, 0.45, length((uv - 0.5) * vec2(1.4, 1.0)));
  float grain = (hash21(uv * u_resolution * 0.5) - 0.5) * 0.008;

  vec3 col = u_bg + grain;
  vec3 lineCol = mix(u_fg, u_accent, accentMix);

  col = mix(col, lineCol, lines * 0.55 * vignette);
  col = mix(col, u_accent, mouseFalloff * 0.06 * intro);

  fragColor = vec4(col, 1.0);
}
