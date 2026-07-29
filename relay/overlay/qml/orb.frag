#version 440

// The orb.
//
// A droplet is pulled out of the right bezel, stretches until it necks,
// pinches off, and the free half rounds up into a glass bubble while the
// other half recoils into the bezel and vanishes.
//
// Everything is a signed distance field, and the pinch-off is two metaballs
// rather than one shape being moved. A body blob travels outward, an anchor
// blob stays welded to the edge, and a smooth minimum joins them. While the
// join width is wide they are one form with a neck; as it narrows the neck
// thins on its own, exactly as surface tension does, and when it reaches zero
// they are simply two shapes. Nothing is keyframed to "break" -- the break is
// what the maths does.
//
// The material arrives *after* the break, which is what the reference frames
// show: first a featureless black tab indistinguishable from the bezel, then
// a black sphere, and only once it is round do the caustic and the dispersion
// appear. Glass that fades in while the droplet is still forming reads as a
// picture of a bubble; glass that arrives as it rounds up reads as one.
//
// The body is left translucent so Hyprland's own backdrop blur shows through.
// What is drawn here is only what glass adds on top of a blurred backdrop.

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

layout(std140, binding = 0) uniform buf {
    mat4  qt_Matrix;
    float qt_Opacity;
    vec2  size;        // item size in px
    float time;        // seconds since the orb appeared
    float emerge;      // 0 = inside the bezel, 1 = formed. Driven LINEARLY.
    float level;       // 0..1 loudness, drives listening and speaking
    float thinking;    // 0..1 blend into the thinking look
    float speaking;    // 0..1 blend into the speaking look
    float radius;      // orb radius in px
    float plainBody;   // 1 when hyprglass supplies the material instead
};

// Where the neck lets go. Before this the droplet is one shape welded to the
// bezel; after it, two.
const float BREAK = 0.50;

float smin(float a, float b, float k) {
    if (k <= 0.0001) return min(a, b);
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
}

// One decaying overshoot. Not a bounce: a droplet that has just let go
// wobbles once and settles, it does not boing.
float elasticOut(float t) {
    return 1.0 - exp(-6.5 * t) * cos(8.5 * t);
}

float easeOut(float t) { return 1.0 - pow(1.0 - t, 2.6); }

// An ellipse, as a distance. Scaling the space and rescaling the result keeps
// the gradient near unit length, which matters because the antialiasing width
// is derived from it.
float sdEllipse(vec2 p, vec2 c, float r, vec2 scale) {
    vec2 q = (p - c) / scale;
    return (length(q) - r) * min(scale.x, scale.y);
}

// Exact distance to a tapered capsule: the segment a->b with radius r1 at one
// end and r2 at the other. Two of these in series are what make the filament
// read as liquid -- wide where it leaves the bezel, tapering to a thread,
// then flaring back out into the bulb. A single blend between two circles can
// only ever give a symmetric dumbbell, which is what "a stretching circle"
// looks like.
float sdRoundCone(vec2 p, vec2 a, vec2 b, float r1, float r2) {
    vec2  ba = b - a;
    float l2 = dot(ba, ba);
    if (l2 < 0.0001) return length(p - a) - max(r1, r2);
    float rr = r1 - r2;
    float a2 = l2 - rr * rr;
    float il2 = 1.0 / l2;

    vec2  pa = p - a;
    float y = dot(pa, ba);
    float z = y - l2;
    vec2  xp = pa * l2 - ba * y;
    float x2 = dot(xp, xp);
    float y2 = y * y * l2;
    float z2 = z * z * l2;

    float k = sign(rr) * rr * rr * x2;
    if (sign(z) * a2 * z2 > k) return sqrt(x2 + z2) * il2 - r2;
    if (sign(y) * a2 * y2 < k) return sqrt(x2 + y2) * il2 - r1;
    return (sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}

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
    vec2  px    = qt_TexCoord0 * size;
    float edgeX = size.x;                 // the right bezel
    float midY  = size.y * 0.5;
    float r     = radius;
    float p     = clamp(emerge, 0.0, 1.0);

    // Two phases, each with its own 0..1 progress.
    float a = clamp(p / BREAK, 0.0, 1.0);                  // stretching
    float b = clamp((p - BREAK) / (1.0 - BREAK), 0.0, 1.0); // free

    // How far out the body finally sits.
    float reach = r * 1.70;

    // Everything grows out of nothing at the very start of the pull, and
    // shrinks back into nothing at the end of the retract. Without this the
    // root is still 0.95r wide at p = 0 with its centre just inside the
    // edge, so a slice of it stays on screen forever -- a permanent bump at
    // the bezel that never melts away.
    float birth = smoothstep(0.0, 0.13, a);

    // --- the body -------------------------------------------------------
    // Creeps out while attached, then springs the rest of the way once the
    // neck lets go.
    // Travels most of the way out *while still attached*. That distance is
    // what there is for the neck to span -- creep out slowly and the two
    // blobs simply overlap, and the whole thing reads as two circles side by
    // side instead of one stretching form.
    float travel = (p < BREAK)
        ? reach * mix(0.20, 0.82, easeOut(a)) * birth
        : reach * mix(0.82, 1.0, elasticOut(b));
    vec2  bodyC = vec2(edgeX - travel, midY);

    // Small while attached, swelling only as it lets go. This is what leaves
    // room for a filament at all: a bulb near full size during the stretch
    // occupies the whole span and there is nowhere for a thread to be, which
    // is why the earlier version could only ever look like a stretching
    // circle. It is also what actually happens -- the drop gathers its mass
    // as the thread feeds into it, then rounds up once it is free.
    float rBody = r * (p < BREAK ? mix(0.16, 0.42, a) * birth
                                 : mix(0.42, 1.0, min(1.0, pow(b, 0.55) * 1.6)));

    // Round while attached, deforming only once it is free.
    //
    // The elongation you see during the pull is the *neck*, not a squashed
    // body -- which is both what actually happens to a droplet and what the
    // maths needs: an ellipse distance is anisotropic, so blending one into
    // the anchor gives smin two non-comparable numbers and it produces a
    // notch where a waist should be. Deform only after the break, when there
    // is nothing left to blend with.
    float sx = (p < BREAK) ? 1.0
                           : 1.0 + 0.30 * exp(-6.0 * b) * cos(10.0 * b);
    vec2  bodyScale = vec2(sx, 1.0 / sx);

    // --- the filament ---------------------------------------------------
    // Three radii along the pull: broad where it leaves the bezel, thin at
    // the waist, and the bulb at the tip. The waist is what pinches.
    // The root stays broad the whole way through: the filament leaves the
    // bezel wide and narrows as it goes, rather than being a second ball.
    float rootR = r * (p < BREAK ? mix(0.95, 0.62, a) * birth
                                 : 0.62 * (1.0 - smoothstep(0.0, 0.28, b)));
    // The thread. Thins slowly, then all at once -- the exponent is the whole
    // character of the parting: linear and it deflates, this and it snaps.
    float waistR = r * (p < BREAK ? mix(0.30, 0.010, pow(a, 1.5)) * birth : 0.0);

    // The root sits mostly *inside* the bezel, so what is drawn is a broad
    // shallow swell across the edge rather than a ball beside it.
    vec2 rootC  = vec2(edgeX + rootR * 0.55, midY);
    // Three quarters of the way out, so the taper is long and the thread is
    // short -- the shape of a filament rather than an hourglass.
    vec2 waistC = vec2(edgeX - travel * 0.74, midY);

    // --- surface motion --------------------------------------------------
    // Applied to the BODY only, never to the combined field.
    //
    // Subtracting the voice term from `d` after the union looks equivalent
    // and is not: once the neck breaks the root collapses to a zero-radius
    // point at the bezel, and subtracting from its distance carves a small
    // disc around that point. The result was a bead at the screen edge
    // pulsing in time with every word.
    vec2  rel  = px - bodyC;
    float ang  = atan(rel.y, rel.x);
    float spin = time * (0.6 + 2.4 * thinking);
    float wob  = (sin(ang * 3.0 + spin) + sin(ang * 5.0 - spin * 0.7)) * 0.5
               * r * (0.006 + 0.026 * level + 0.012 * thinking) * b;
    float voice = r * (sin(time * 1.6) * 0.012
                     + level * (0.085 + 0.05 * speaking)) * b;

    float dBody = sdEllipse(px, bodyC, rBody + voice, bodyScale) - wob;
    float d;
    if (p < BREAK) {
        // root -> waist -> bulb, each an exact tapered capsule. A small
        // smooth minimum only rounds the two joints; the profile itself is
        // the cones, so it stays a filament rather than becoming a blob.
        float dRoot = sdRoundCone(px, rootC, waistC, rootR, waistR);
        float dNeck = sdRoundCone(px, waistC, bodyC, waistR, rBody);
        d = smin(smin(dRoot, dNeck, r * 0.18), dBody, r * 0.10);
    } else {
        // Broken. The bulb is on its own; whatever is left at the root
        // recoils through the edge and is gone. Once it has gone, drop it
        // entirely rather than leaving a zero-radius point in the field.
        d = (rootR > 0.001) ? min(dBody, length(px - rootC) - rootR) : dBody;
    }

    // --- coverage --------------------------------------------------------
    float aa   = max(fwidth(d), 0.75);
    float mask = 1.0 - smoothstep(-aa, aa, d);
    if (mask <= 0.001) {
        fragColor = vec4(0.0);
        return;
    }

    // How much of the glass has arrived. Zero until the neck breaks: before
    // that this is a black tab being pulled out of a black bezel, and it
    // should be indistinguishable from one.
    float glass = smoothstep(0.0, 0.62, b);
    // ...and never near the bezel, whatever the phase. Anything within about
    // a radius of the edge stays pure black, so the root and the recoil read
    // as screen surround rather than as a piece of glass being reabsorbed.
    // On an OLED that black is the panel being off, which is most of why the
    // droplet looks like it is made of the bezel.
    glass *= smoothstep(0.0, r * 0.85, edgeX - px.x);

    float rn    = clamp(length(rel) / max(r, 1.0), 0.0, 1.4);
    float rim   = smoothstep(0.55, 1.0, rn);
    float below = clamp(rel.y / max(r, 1.0), -1.0, 1.0) * 0.5 + 0.5;
    vec2  u     = rel / max(r, 1.0);
    float upper = clamp(-u.y, 0.0, 1.0);

    // --- material --------------------------------------------------------
    // Pure black until the glass arrives -- not a dark blue that merely looks
    // black, because on an OLED the difference between 0 and nearly-0 is the
    // difference between the pixel being off and being lit.
    vec3  tint = mix(vec3(0.0), vec3(0.035, 0.042, 0.058), glass);
    // Thin in the middle, dense at the rim, and heavier at the top than the
    // bottom: how a real lens reads, and why the orb stays dark against a
    // bright backdrop while the desktop still shows through the middle.
    float density = mix(0.34, 0.74, rim) - 0.11 * below + 0.17 * upper;
    // While still attached it is not glass at all -- it is bezel. Opaque
    // black, so the tab that emerges looks like part of the screen surround.
    density = mix(0.99, density, glass);

    vec3 col = tint;

    if (plainBody < 0.5) {
        // The caustic: light focused through the lens into a band low on the
        // body. It bows, because a lens is curved and a straight line across
        // a sphere reads as a decal stuck on top of one.
        float bandY = mix(0.30, 0.21, level) + 0.03 * sin(time * 0.7);
        float bow   = 0.13 * u.x * u.x;
        float dy    = u.y - (bandY + bow);
        float thick = 0.085 + 0.045 * level + 0.02 * speaking;

        float sides = smoothstep(1.0, 0.30, abs(u.x));
        float grain = noise(vec2(rel.x * 0.05, time * 0.35)) * 0.25 + 0.75;
        float reachC = sides * grain * (0.52 + 0.70 * level + 0.30 * speaking);

        // Dispersion. Three copies of the band at different heights is what a
        // prism does, and it is the whole reason this reads as glass rather
        // than as a dark circle with a highlight on it.
        float sep = (0.098 + 0.032 * speaking) * (0.55 + 0.45 * rim);
        float cr = exp(-pow(dy + sep,       2.0) / (thick * thick));
        float cg = exp(-pow(dy,             2.0) / (thick * thick));
        float cb = exp(-pow(dy - sep * 0.8, 2.0) / (thick * thick));

        vec3 rainbow = cr * vec3(1.00, 0.32, 0.10)
                     + cg * vec3(0.35, 1.00, 0.45)
                     + cb * vec3(0.25, 0.45, 1.00);
        col += rainbow * reachC * 0.52 * glass;

        float core = exp(-(dy * dy) / (thick * thick * 2.2));
        col += vec3(core) * vec3(1.00, 0.95, 0.88) * reachC * 0.42 * glass;

        // While thinking there is no voice to react to, so the orb turns over
        // instead: a highlight travelling around the rim. Without it a long
        // model call is indistinguishable from a frozen frame.
        if (thinking > 0.01) {
            float t = time * 1.5;
            vec2  od = u - vec2(cos(t), sin(t)) * 0.72;
            col += vec3(exp(-dot(od, od) * 11.0))
                 * vec3(0.55, 0.74, 1.00) * 0.30 * thinking * glass;
        }

        float fres = pow(rim, 3.0);
        col += vec3(fres) * mix(0.01, 0.26, below) * vec3(0.90, 0.95, 1.00) * glass;

        // A broad, weak sheen high on the body. A tight hot spot looks like a
        // plastic bead.
        vec2 gl = u - vec2(-0.30, -0.42);
        col += vec3(exp(-dot(gl, gl) * 7.0) * 0.055) * vec3(0.92, 0.96, 1.00) * glass;

        density += fres * 0.10 * glass;
    } else {
        density = mix(0.99, mix(0.44, 0.66, rim), glass);
    }

    // The wet lip exactly on the boundary: bright below, nothing above. Most
    // of what sells the surface, and it appears with the rest of the glass.
    float lip = smoothstep(2.0, 0.0, abs(d)) * mix(0.03, 0.68, below) * glass;
    col += vec3(lip) * vec3(0.95, 0.97, 1.00);
    density = min(1.0, density + lip * 0.35);

    fragColor = vec4(col, density) * mask * qt_Opacity;
}
