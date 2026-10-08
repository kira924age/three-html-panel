// Maps between a panel's surface and its page, for any geometry with UVs.
//
// The page is drawn by the texture, so the geometry's UVs say where each point
// of the page is: u from the page's left (0) to its right (1), v from its
// bottom (0) to its top (1). A flat rectangle, a curved strip and every face of
// a box all work the same way. Where several triangles carry the same UV (the
// faces of a box), the page is on each of them.
//
// Each query walks the triangles: panel geometries are small (a curved strip has
// a few hundred), and the queries come with pointer moves, not every frame.

import { Plane, Ray, Triangle, Vector2, Vector3, type BufferAttribute, type BufferGeometry, type InterleavedBufferAttribute } from "three"

/** A point of the surface, in the geometry's own space. */
export interface SurfacePoint {
  position: Vector3
  /** The normal of the triangle the point is on, facing its front. */
  normal: Vector3
}

type Attribute = BufferAttribute | InterleavedBufferAttribute

// Barycentric coordinates a hair outside a triangle still count as inside, so a
// point on the edge between two triangles is found in either.
const EDGE = 1e-6

export class Surface {
  private readonly a = new Vector3()
  private readonly b = new Vector3()
  private readonly c = new Vector3()
  private readonly uvA = new Vector3()
  private readonly uvB = new Vector3()
  private readonly uvC = new Vector3()
  private readonly bary = new Vector3()
  private readonly point = new Vector3()

  constructor(readonly geometry: BufferGeometry) {
    if (!geometry.getAttribute("uv")) throw new Error("A panel's geometry needs UVs: they say where the page is on it")
  }

  /**
   * The UV where `ray` (in the geometry's space) meets the surface. Where it
   * misses, the UV it would meet if the surface went on past its edge: the
   * plane of the triangle nearest the ray, with its UVs carried on. This keeps
   * a drag going when the pointer leaves the panel. Null if the ray runs
   * parallel to that plane or points away from it.
   *
   * Only triangles whose front faces the ray count as nearest, if any does: on
   * a closed shape (a box), the face next to the one dragged off is often
   * nearer the ray, but seen edge on or from behind, and its UVs (another part
   * of the page) would make the drag jump.
   */
  uvFromRay(ray: Ray): Vector2 | null {
    let nearest = Infinity
    let hit = -1
    let closest = Infinity
    let near = -1
    let closestFacing = Infinity
    let nearFacing = -1
    this.eachTriangle(index => {
      this.loadPositions(index)
      const point = ray.intersectTriangle(this.a, this.b, this.c, false, this.point)
      if (point) {
        const distance = ray.origin.distanceToSquared(point)
        if (distance < nearest) {
          nearest = distance
          hit = index
        }
      }
      if (hit >= 0) return
      const centroid = this.point.copy(this.a).add(this.b).add(this.c).divideScalar(3)
      const distance = ray.distanceSqToPoint(centroid)
      if (distance < closest) {
        closest = distance
        near = index
      }
      const facing = Triangle.getNormal(this.a, this.b, this.c, this.point).dot(ray.direction) < 0
      if (facing && distance < closestFacing) {
        closestFacing = distance
        nearFacing = index
      }
    })
    const index = hit >= 0 ? hit : nearFacing >= 0 ? nearFacing : near
    if (index < 0) return null
    this.loadPositions(index)
    if (hit >= 0) {
      ray.intersectTriangle(this.a, this.b, this.c, false, this.point)
    } else {
      const plane = new Plane().setFromCoplanarPoints(this.a, this.b, this.c)
      if (!ray.intersectPlane(plane, this.point)) return null
    }
    // Outside the triangle, the coordinates go negative: the UVs carry on linearly.
    if (!Triangle.getBarycoord(this.point, this.a, this.b, this.c, this.bary)) return null
    this.loadUvs(index)
    return new Vector2(
      this.bary.x * this.uvA.x + this.bary.y * this.uvB.x + this.bary.z * this.uvC.x,
      this.bary.x * this.uvA.y + this.bary.y * this.uvB.y + this.bary.z * this.uvC.y
    )
  }

  /** The points of the surface that show `uv`: one per triangle that covers it. */
  pointsAt(uv: Vector2): SurfacePoint[] {
    const points: SurfacePoint[] = []
    const target = new Vector3(uv.x, uv.y, 0)
    this.eachTriangle(index => {
      this.loadUvs(index)
      if (!Triangle.getBarycoord(target, this.uvA, this.uvB, this.uvC, this.bary)) return
      const { x, y, z } = this.bary
      if (x < -EDGE || y < -EDGE || z < -EDGE) return
      this.loadPositions(index)
      const position = new Vector3()
        .addScaledVector(this.a, x)
        .addScaledVector(this.b, y)
        .addScaledVector(this.c, z)
      points.push({ position, normal: Triangle.getNormal(this.a, this.b, this.c, new Vector3()) })
    })
    return points
  }

  /** Calls `visit` with the first vertex number of each triangle. */
  private eachTriangle(visit: (index: number) => void): void {
    const count = this.geometry.index?.count ?? this.geometry.getAttribute("position").count
    for (let index = 0; index + 2 < count; index += 3) visit(index)
  }

  private vertex(n: number): number {
    return this.geometry.index ? this.geometry.index.getX(n) : n
  }

  private loadPositions(index: number): void {
    const position = this.geometry.getAttribute("position") as Attribute
    this.a.fromBufferAttribute(position, this.vertex(index))
    this.b.fromBufferAttribute(position, this.vertex(index + 1))
    this.c.fromBufferAttribute(position, this.vertex(index + 2))
  }

  private loadUvs(index: number): void {
    const uv = this.geometry.getAttribute("uv") as Attribute
    for (const [target, n] of [[this.uvA, index], [this.uvB, index + 1], [this.uvC, index + 2]] as const) {
      target.set(uv.getX(this.vertex(n)), uv.getY(this.vertex(n)), 0)
    }
  }
}
