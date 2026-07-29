#version 440

// The orb.
//
// A dark glass bubble that pulls out of the right bezel, hangs there while
// Relay listens and thinks, and pulses while it speaks.
//
// Everything is a signed distance field. The pull-out is the whole trick: a
// smooth minimum between a slab welded to the right edge and a free-floating
// circle. Blend them hard and they are one blob joined by a neck; separate
// them and the neck thins, snaps, and leaves a sphere. That is the same
// metaball maths a dynamic island uses, and it is why this reads as liquid
// rather than as a shape being moved.
//
// The surface is NOT lit as an opaque object. Hyprland blurs whatever is
// behind this layer, and the body is left translucent so that blur shows
// through. What is drawn here is only what glass adds on top of a blurred
// backdrop: a dark tint, a bright caustic band low on the body, colour
// splitting at the rim, and a fresnel edge lit from below -- matching the
// references, where the light comes off the desktop underneath.

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

layout(std140, binding = 0) uniform buf {
    mat4  qt_Matrix;
    float qt_Opacity;
    vec2  size;        // item size in px
    float time;        // seconds since the orb appeared
    float emerge;      // 0 = inside the bezel, 1 = fully detached
    float level;       // 0..1 loudness, drives listening and speaking
    float thinking;    // 0..1 blend into the thinking look
    float speaking;    // 0..1 blend into the speaking look
    float radius;      // orb radius in px
    float plainBody;   // 1 when hyprglass supplies the material instead
};

const float PI = 3.14159265;

// Polynomial smooth minimum. `k` is the width of the join: large while the
// droplet is still attached, near zero once it has pulled free.
float smin(float a, float b, float k) {
    if (k <= 0.0001) return min(a, b);
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
}

float sdCircle(vec2 p, vec2 c, float r) {
    return length(p - c) - r;
}

// The bezel itself: a slab hanging off the right edge, so the droplet has
// something to be made of before it separates.
float sdBezel(vec2 p, float edgeX, float halfHeight, float depth) {
    vec2 d = abs(vec2(p.x - (edgeX + depth), p.y)) - vec2(depth, halfHeight);
    return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}

// Cheap value noise, used only to keep the caustic from looking like a
// perfectly straight line.
float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
               mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

void main() {
    vec2 px = qt_TexCoord0 * size;
    float edgeX = size.x;                   // the right bezel

    // --- shape -----------------------------------------------------------
    // Travel: how far the body has moved away from the edge. Eased so it
    // leaves quickly and settles slowly, like something under tension.
    float ease = 1.0 - pow(1.0 - clamp(emerge, 0.0, 1.0), 3.0);
    float travel = mix(0.0, radius * 2.05, ease);
    vec2  centre = vec2(edgeX - travel, size.y * 0.5);

    // Breathing. While listening the body swells with the voice; while
    // speaking it pulses on the syllable; while thinking it just idles.
    float idleBreath = sin(time * 1.6) * 0.012;
    float voice = level * (0.085 + 0.05 * speaking);
    float r = radius * (1.0 + idleBreath + voice);

    // Surface tension: a few sine lobes around the rim so the body is never
    // a perfect circle. Rotates while thinking so the orb keeps moving even
    // when nothing is being said.
    vec2  rel = px - centre;
    float ang = atan(rel.y, rel.x);
    float spin = time * (0.6 + 2.4 * thinking);
    float wobble = (sin(ang * 3.0 + spin) * 0.5 + sin(ang * 5.0 - spin * 0.7) * 0.5)
                 * r * (0.006 + 0.026 * level + 0.012 * thinking);

    float dBody  = sdCircle(px, centre, r + wobble);
    float dBezel = sdBezel(px, edgeX, r * 0.62, r * 0.5);

    // The neck. Wide while attached, gone once free -- squared so it thins
    // fast at the end and the separation reads as a snap.
    float k = r * 1.25 * pow(1.0 - clamp(emerge, 0.0, 1.0), 2.0);
    float d = smin(dBody, dBezel, k);

    // --- coverage --------------------------------------------------------
    float aa = max(fwidth(d), 0.75);
    float mask = 1.0 - smoothstep(-aa, aa, d);
    if (mask <= 0.001) {
        fragColor = vec4(0.0);
        return;
    }

    // Normalised position within the body, for shading.
    float rn = clamp(length(rel) / max(r, 1.0), 0.0, 1.4);
    float rim = smoothstep(0.55, 1.0, rn);          // 0 centre -> 1 edge
    // Down-facing weight. The references are lit from below: the desktop is
    // bright, the bezel above is dark.
    float below = clamp(rel.y / max(r, 1.0), -1.0, 1.0) * 0.5 + 0.5;

    // --- material --------------------------------------------------------
    // Dark, slightly blue tint. Alpha, not colour, is what lets Hyprland's
    // blur read through: the body is mostly transparent in the middle and
    // densest at the edge, which is how a thick lens actually behaves.
    vec3  tint = vec3(0.035, 0.042, 0.058);
    // Thin in the middle, dense at the rim: the way a real lens reads, and
    // the only reason the blurred desktop behind is visible at all. Push
    // this up and the orb stops being glass and becomes a dark ball.
    float density = mix(0.56, 0.90, rim) - 0.13 * below;

    vec3 col = tint;

    // Position inside the body, -1..1, y down.
    vec2 u = rel / max(r, 1.0);
    float upper = clamp(-u.y, 0.0, 1.0);     // 1 at the top of the body

    // Light comes from below, so the top of the glass is the dense, dark
    // part and the bottom is where everything happens.
    // Heavier at the top than the bottom. This is what keeps the orb dark
    // against a bright backdrop -- the references sit on a white sky and are
    // still nearly black across the top third.
    density += 0.22 * upper;

    if (plainBody < 0.5) {
        // The caustic: light focused through the lens into a band low on the
        // body. It bows, because a lens is curved and a straight line across
        // a sphere reads as a decal stuck on top of it.
        float bandY = mix(0.30, 0.21, level) + 0.03 * sin(time * 0.7);
        float bow   = 0.13 * u.x * u.x;
        float dy    = u.y - (bandY + bow);
        float thick = 0.085 + 0.045 * level + 0.02 * speaking;

        // Fade before the rim, so the band belongs to the body rather than
        // running off the edge of it.
        float sides = smoothstep(1.0, 0.30, abs(u.x));
        float grain = noise(vec2(rel.x * 0.05, time * 0.35)) * 0.25 + 0.75;
        float reach = sides * grain * (0.52 + 0.70 * level + 0.30 * speaking);

        // Dispersion. Three copies of the band at different heights is what
        // a prism does, and it is the whole reason the references look like
        // glass rather than like a dark circle with a highlight.
        float sep = (0.098 + 0.032 * speaking) * (0.55 + 0.45 * rim);
        float cr = exp(-pow(dy + sep,       2.0) / (thick * thick));
        float cg = exp(-pow(dy,             2.0) / (thick * thick));
        float cb = exp(-pow(dy - sep * 0.8, 2.0) / (thick * thick));

        // Warm above, cool below -- the order in the reference frames.
        vec3 rainbow = cr * vec3(1.00, 0.32, 0.10)
                     + cg * vec3(0.35, 1.00, 0.45)
                     + cb * vec3(0.25, 0.45, 1.00);
        col += rainbow * reach * 0.52;

        // A softer, warmer white core sitting on the rainbow, which is what
        // keeps it reading as one bright band and not as three stripes. Kept
        // deliberately below the rainbow's brightness -- push it further and
        // it bleaches the colour straight back out again.
        float core = exp(-(dy * dy) / (thick * thick * 2.2));
        col += vec3(core) * vec3(1.00, 0.95, 0.88) * reach * 0.42;

        // While thinking there is no voice to react to, so the orb turns
        // over instead: a highlight travelling around the rim. Without it a
        // long model call is indistinguishable from a frozen frame.
        if (thinking > 0.01) {
            float a = time * 1.5;
            vec2  od = u - vec2(cos(a), sin(a)) * 0.72;
            col += vec3(exp(-dot(od, od) * 11.0))
                 * vec3(0.55, 0.74, 1.00) * 0.30 * thinking;
        }

        // Fresnel rim: bright below, almost nothing above.
        float fres = pow(rim, 3.0);
        col += vec3(fres) * mix(0.01, 0.26, below) * vec3(0.90, 0.95, 1.00);

        // A broad sheen high on the body. Wide and weak: a tight hot spot
        // looks like a plastic bead.
        vec2 gl = u - vec2(-0.30, -0.42);
        col += vec3(exp(-dot(gl, gl) * 7.0) * 0.055) * vec3(0.92, 0.96, 1.00);

        density += fres * 0.10;
    } else {
        // hyprglass is drawing refraction, dispersion and fresnel for the
        // whole surface. Adding our own on top would double every highlight,
        // so the body stays plain and only the tint remains ours.
        density = mix(0.50, 0.72, rim);
    }

    // A thin bright lip exactly on the boundary, present in every reference
    // frame and most of what sells the wet edge.
    float lip = smoothstep(2.0, 0.0, abs(d)) * mix(0.03, 0.68, below);
    col += vec3(lip) * vec3(0.95, 0.97, 1.00);
    density = min(1.0, density + lip * 0.35);

    fragColor = vec4(col, density) * mask * qt_Opacity;
}
