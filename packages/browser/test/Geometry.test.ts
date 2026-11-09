/** Projective frame mappings retain corners, including collapsed affine planes. */
import { assert, describe, it } from "@effect/vitest"
import * as Geometry from "../src/internal/geometry.ts"

describe("frame plane geometry", () => {
  it("maps a content origin through perspective without taking intermediate bounds", () => {
    const matrix = Geometry.fromQuad(
      [
        { x: 10, y: 20 },
        { x: 50 / 1.2, y: 25 / 1.2 },
        { x: 55 / 1.15, y: 55 / 1.15 },
        { x: 15 / .95, y: 50 / .95 }
      ],
      20,
      10,
      2,
      3
    )
    assert.isNotNull(matrix)
    const point = Geometry.project(matrix!, { x: 1, y: 1 })
    assert.closeTo(point.x, 18 / 1.01, 1e-10)
    assert.closeTo(point.y, 32.75 / 1.01, 1e-10)
  })

  it("retains an affine projection whose horizontal axis collapses", () => {
    const matrix = Geometry.fromQuad(
      [{ x: 10, y: 20 }, { x: 10, y: 20 }, { x: 15, y: 50 }, { x: 15, y: 50 }],
      20,
      10,
      0,
      0
    )
    assert.isNotNull(matrix)
    assert.deepStrictEqual(Geometry.project(matrix!, { x: 4, y: 2 }), { x: 11, y: 26 })
  })
})
