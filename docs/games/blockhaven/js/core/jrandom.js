// java.util.Random (Minecraft's LegacyRandomSource): the same numbers from the same seed, for the
// places where Java's randomness shows (each column of rain and snow has its own).
const MULT = 0x5deece66dn, MASK = (1n << 48n) - 1n;

export class JavaRandom {
  constructor(seed) { this.seed = (BigInt.asIntN(64, BigInt(seed)) ^ MULT) & MASK; this.nextNextGaussian = null; }
  next(bits) {
    this.seed = (this.seed * MULT + 0xbn) & MASK;
    return Number(BigInt.asIntN(32, this.seed >> BigInt(48 - bits)));
  }
  nextInt(bound) {
    if ((bound & -bound) === bound) return Number((BigInt(bound) * BigInt(this.next(31))) >> 31n);
    let bits, val;
    do { bits = this.next(31); val = bits % bound; } while (bits - val + (bound - 1) > 0x7fffffff);
    return val;
  }
  nextFloat() { return this.next(24) / (1 << 24); }
  nextDouble() { return (this.next(26) * 134217728 + this.next(27)) / 9007199254740992; }
  nextGaussian() {
    if (this.nextNextGaussian !== null) { const g = this.nextNextGaussian; this.nextNextGaussian = null; return g; }
    let v1, v2, s;
    do { v1 = 2 * this.nextDouble() - 1; v2 = 2 * this.nextDouble() - 1; s = v1 * v1 + v2 * v2; } while (s >= 1 || s === 0);
    const m = Math.sqrt(-2 * Math.log(s) / s);
    this.nextNextGaussian = v2 * m;
    return v1 * m;
  }
}
