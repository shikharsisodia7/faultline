/**
 * Seeded pseudo-random number generator (sfc32, public domain).
 *
 * Every stochastic decision in the simulator draws from one of these, so a
 * (scenario, seed) pair always reproduces the exact same run. `Math.random`
 * is never used by the engine.
 */
export class Rng {
  private a: number
  private b: number
  private c: number
  private d: number

  constructor(seed: number) {
    // Splitmix-style seed expansion so nearby seeds diverge immediately.
    let s = seed >>> 0
    const next = () => {
      s = (s + 0x9e3779b9) >>> 0
      let z = s
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b)
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35)
      return (z ^ (z >>> 16)) >>> 0
    }
    this.a = next()
    this.b = next()
    this.c = next()
    this.d = next()
    for (let i = 0; i < 12; i++) this.nextUint()
  }

  nextUint(): number {
    this.a >>>= 0
    this.b >>>= 0
    this.c >>>= 0
    this.d >>>= 0
    let t = (this.a + this.b) | 0
    this.a = this.b ^ (this.b >>> 9)
    this.b = (this.c + (this.c << 3)) | 0
    this.c = (this.c << 21) | (this.c >>> 11)
    this.d = (this.d + 1) | 0
    t = (t + this.d) | 0
    this.c = (this.c + t) | 0
    return t >>> 0
  }

  /** Uniform in [0, 1). */
  next(): number {
    return this.nextUint() / 4294967296
  }

  /** Exponential with the given mean (inverse transform). */
  exponential(mean: number): number {
    if (mean <= 0) return 0
    return -Math.log(1 - this.next()) * mean
  }

  /** Lognormal parameterized by its mean and coefficient of variation. */
  lognormal(mean: number, cv: number): number {
    if (mean <= 0) return 0
    const sigma2 = Math.log(1 + cv * cv)
    const mu = Math.log(mean) - sigma2 / 2
    // Box–Muller
    const u1 = Math.max(this.next(), 1e-12)
    const u2 = this.next()
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
    return Math.exp(mu + Math.sqrt(sigma2) * z)
  }

  bernoulli(p: number): boolean {
    return this.next() < p
  }

  /** Integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n)
  }

  /** Hex string of `bytes` bytes (trace / span ids). */
  hex(bytes: number): string {
    let out = ''
    for (let i = 0; i < bytes; i++) out += this.int(256).toString(16).padStart(2, '0')
    return out
  }
}
