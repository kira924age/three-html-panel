import { BoxGeometry, BufferGeometry, CylinderGeometry, PlaneGeometry, Ray, Vector2, Vector3 } from "three"
import { describe, expect, it } from "vitest"
import { Surface } from "./surface"

const towards = (origin: Vector3, target: Vector3) => new Ray(origin, target.clone().sub(origin).normalize())

describe("Surface", () => {
  it("needs UVs", () => {
    const geometry = new BufferGeometry().setAttribute("position", new PlaneGeometry().getAttribute("position"))
    expect(() => new Surface(geometry)).toThrow(/UVs/)
  })

  describe("on a flat rectangle", () => {
    // 2 wide, 1 high, facing +z.
    const surface = new Surface(new PlaneGeometry(2, 1))

    it("gives the UV a ray meets", () => {
      const uv = surface.uvFromRay(towards(new Vector3(0.5, 0.25, 1), new Vector3(0.5, 0.25, 0)))!
      expect(uv.x).toBeCloseTo(0.75)
      expect(uv.y).toBeCloseTo(0.75)
    })

    it("carries the UVs on past the edge, and meets the plane from behind", () => {
      const outside = surface.uvFromRay(towards(new Vector3(1.5, -1, 1), new Vector3(1.5, -1, 0)))!
      expect(outside.x).toBeCloseTo(1.25)
      expect(outside.y).toBeCloseTo(-0.5)
      const behind = surface.uvFromRay(towards(new Vector3(0, 0, -1), new Vector3(0, 0, 0)))!
      expect(behind.x).toBeCloseTo(0.5)
      expect(behind.y).toBeCloseTo(0.5)
    })

    it("gives null for a ray parallel to it or pointing away", () => {
      expect(surface.uvFromRay(new Ray(new Vector3(3, 0, 1), new Vector3(1, 0, 0)))).toBeNull()
      expect(surface.uvFromRay(new Ray(new Vector3(3, 0, 1), new Vector3(0, 0, 1)))).toBeNull()
    })

    it("finds the point that shows a UV", () => {
      const points = surface.pointsAt(new Vector2(0.75, 0.75))
      expect(points.length).toBeGreaterThan(0)
      for (const { position, normal } of points) {
        expect(position.distanceTo(new Vector3(0.5, 0.25, 0))).toBeCloseTo(0)
        expect(normal.z).toBeCloseTo(1)
      }
      expect(surface.pointsAt(new Vector2(1.5, 0.5))).toEqual([])
    })
  })

  describe("on a curved strip", () => {
    // A quarter of a cylinder of radius 1 around the y axis, centred on +z, open.
    const surface = new Surface(new CylinderGeometry(1, 1, 1, 32, 1, true, -Math.PI / 4, Math.PI / 2))
    const at = (angle: number, y: number) => new Vector3(Math.sin(angle), y, Math.cos(angle))

    it("gives the UV along the arc", () => {
      const uv = surface.uvFromRay(towards(new Vector3(0, 0.25, 3), new Vector3(0, 0.25, 1)))!
      expect(uv.x).toBeCloseTo(0.5, 2)
      expect(uv.y).toBeCloseTo(0.75, 2)
      const side = surface.uvFromRay(towards(at(Math.PI / 8, 0).multiplyScalar(3), at(Math.PI / 8, 0)))!
      expect(side.x).toBeCloseTo(0.75, 2)
    })

    it("carries the UVs on past the edge nearest the ray", () => {
      const past = surface.uvFromRay(towards(new Vector3(2, 0, 3), new Vector3(2, 0, 0)))!
      expect(past.x).toBeGreaterThan(1)
      expect(past.y).toBeCloseTo(0.5, 2)
    })

    it("past the silhouette of a half cylinder, follows the pointer instead of jumping", () => {
      const half = new Surface(new CylinderGeometry(1, 1, 1, 64, 1, true, -Math.PI / 2, Math.PI))
      const eye = new Vector3(0, 0, 3)
      // Leftwards past its left edge (x = -1), at a fixed height: the triangles there are seen edge on.
      let previous = Infinity
      for (let x = -0.8; x >= -2; x -= 0.1) {
        const uv = half.uvFromRay(towards(eye, new Vector3(x, 0.2, 0)))!
        expect(uv.x).toBeLessThan(previous + 0.05)
        expect(uv.y).toBeGreaterThan(0.6)
        expect(uv.y).toBeLessThan(0.8)
        previous = uv.x
      }
    })

    it("puts a UV on the arc, facing out", () => {
      const [point] = surface.pointsAt(new Vector2(0.75, 0.5))
      expect(point!.position.distanceTo(at(Math.PI / 8, 0))).toBeLessThan(0.01)
      expect(point!.normal.dot(at(Math.PI / 8, 0))).toBeGreaterThan(0.99)
    })
  })

  it("on a box, carries a drag past an edge on from the face the ray sees, not the one next to it", () => {
    const surface = new Surface(new BoxGeometry(1, 1, 1))
    const eye = new Vector3(0, 0, 2)
    // Across the front face's right edge, past the box: the right face is nearer the ray, but seen from behind.
    const inside = surface.uvFromRay(towards(eye, new Vector3(0.45, 0.2, 0.5)))!
    const past = surface.uvFromRay(towards(eye, new Vector3(0.55, 0.2, 0.5)))!
    expect(inside.x).toBeCloseTo(0.95)
    expect(past.x).toBeCloseTo(1.05)
    expect(past.y).toBeCloseTo(0.7)
  })

  it("on a box, finds the UV on every face and the nearest hit", () => {
    const surface = new Surface(new BoxGeometry(1, 1, 1))
    const normals = surface.pointsAt(new Vector2(0.5, 0.5)).map(point => point.normal)
    for (const axis of [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)]) {
      expect(normals.some(normal => normal.dot(axis) > 0.99)).toBe(true)
      expect(normals.some(normal => normal.dot(axis) < -0.99)).toBe(true)
    }
    // Through the front face (+z) at its top right, then out the back.
    const uv = surface.uvFromRay(towards(new Vector3(0.25, 0.25, 2), new Vector3(0.25, 0.25, 0)))!
    expect(uv.x).toBeCloseTo(0.75)
    expect(uv.y).toBeCloseTo(0.75)
  })
})
