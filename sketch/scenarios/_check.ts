/** Compile-time assertions: `expectType<Equals<A, B>>(true)` fails to compile unless A and B are the same type. */
export type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
export declare function expectType<T extends true>(value: T): void
