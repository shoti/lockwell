// @ts-check
/**
 * @file 2×3 affine matrices for the photo editor, in the order a canvas's setTransform takes them.
 */

/**
 * [a, b, c, d, e, f]: a point (x, y) goes to (a·x + c·y + e, b·x + d·y + f).
 * @typedef {[number, number, number, number, number, number]} Matrix
 */
/** @typedef {{ x: number, y: number }} Point */

/** @returns {Matrix} */
export const identity = () => [1, 0, 0, 1, 0, 0];

/**
 * `m` after `n`: the matrix that applies `n` first, then `m`.
 * @param {Matrix} m
 * @param {Matrix} n
 * @returns {Matrix}
 */
export function multiply(m, n) {
  const [a, b, c, d, e, f] = m;
  const [a2, b2, c2, d2, e2, f2] = n;
  return [a * a2 + c * b2, b * a2 + d * b2, a * c2 + c * d2, b * c2 + d * d2, a * e2 + c * f2 + e, b * e2 + d * f2 + f];
}

/**
 * Several matrices in one, the last applied first, as when they are written
 * one after another: compose(A, B, C) applies C, then B, then A.
 * @param {...Matrix} matrices
 * @returns {Matrix}
 */
export const compose = (...matrices) => matrices.reduce(multiply, identity());

/**
 * @param {Matrix} m
 * @returns {Matrix}
 */
export function invert(m) {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (!det) throw new Error('This matrix squashes the picture to a line, so it cannot be undone.');
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

/**
 * @param {Matrix} m
 * @param {Point} point
 * @returns {Point}
 */
export const apply = ([a, b, c, d, e, f], { x, y }) => ({ x: a * x + c * y + e, y: b * x + d * y + f });

/** @param {number} x @param {number} y @returns {Matrix} */
export const translate = (x, y) => [1, 0, 0, 1, x, y];

/** @param {number} x @param {number} [y] @returns {Matrix} */
export const scale = (x, y = x) => [x, 0, 0, y, 0, 0];

/**
 * A turn about the origin. With y pointing down, as on a canvas, a positive angle turns clockwise.
 * @param {number} radians
 * @returns {Matrix}
 */
export function rotate(radians) {
  const [cos, sin] = [Math.cos(radians), Math.sin(radians)];
  return [cos, sin, -sin, cos, 0, 0];
}

/**
 * A quarter turn, exactly: no 6e-17 where there should be 0.
 * @param {number} quarters  Clockwise.
 * @returns {Matrix}
 */
export function turn(quarters) {
  const [cos, sin] = [[1, 0], [0, 1], [-1, 0], [0, -1]][((quarters % 4) + 4) % 4];
  return [cos, sin, -sin, cos, 0, 0];
}
