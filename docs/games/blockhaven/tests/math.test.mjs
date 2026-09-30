// core/math.js: column-major 4x4 matrices and frustum culling.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';
const {
  mat4, multiply, invert, translation, rotationX, rotationY, rotationZ, scaling, compose,
  perspective, viewMatrix, forward, frustumPlanes, boxVisible,
} = await load('core/math.js');

const close = (a, b, eps = 1e-5, msg = '') => {
  assert.equal(a.length, b.length, msg);
  for (let i = 0; i < a.length; i++) assert.ok(Math.abs(a[i] - b[i]) < eps, `${msg} [${i}] ${a[i]} != ${b[i]}`);
};
const I = mat4();
const apply = (m, [x, y, z]) => [0, 1, 2].map(r => m[r] * x + m[4 + r] * y + m[8 + r] * z + m[12 + r]);
const sample = () => compose(translation(3, -2, 5), rotationY(0.7), rotationX(-0.3), rotationZ(1.1), scaling(2, 0.5, 3));

test('mat4() is the identity', () => {
  close(I, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
});

test('identity is neutral for multiply', () => {
  const a = sample();
  close(multiply(mat4(), I, a), a);
  close(multiply(mat4(), a, I), a);
});

test('invert(A) * A = I', () => {
  const a = sample(), inv = invert(mat4(), a);
  close(multiply(mat4(), inv, a), I, 1e-4, 'inv*A');
  close(multiply(mat4(), a, inv), I, 1e-4, 'A*inv');
});

test('rotations undo each other; translation moves points', () => {
  for (const rot of [rotationX, rotationY, rotationZ]) close(multiply(mat4(), rot(0.9), rot(-0.9)), I, 1e-6, rot.name);
  close(apply(translation(1, 2, 3), [4, 5, 6]), [5, 7, 9]);
  close(apply(scaling(2, 3, 4), [1, 1, 1]), [2, 3, 4]);
});

test('multiply tolerates aliasing out === a', () => {
  const a = sample(), b = rotationY(0.4), expected = multiply(mat4(), a, b);
  close(multiply(a, a, b), expected);
});

test('forward(0,0) looks down -Z; view matrix maps the eye to the origin', () => {
  close(forward(0, 0), [0, 0, -1]);
  close(forward(0, Math.PI / 2), [0, 1, 0], 1e-6);
  close(apply(viewMatrix([10, 20, 30], 0.5, 0.2), [10, 20, 30]), [0, 0, 0], 1e-4);
});

test('frustum culling keeps boxes in front and drops boxes behind', () => {
  const proj = perspective(mat4(), Math.PI / 3, 1.5, 0.1, 500);
  const planes = frustumPlanes(multiply(mat4(), proj, viewMatrix([0, 0, 0], 0, 0)));
  assert.equal(planes.length, 6);
  assert.equal(boxVisible(planes, -1, -1, -11, 1, 1, -9), true, 'box ahead');
  assert.equal(boxVisible(planes, -1, -1, 9, 1, 1, 11), false, 'box behind');
  assert.equal(boxVisible(planes, -1, -1, -900, 1, 1, -800), false, 'box past far plane');
});
