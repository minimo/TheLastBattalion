import * as THREE from 'three'

/** Compact instance slots, with dirty ranges retained until the renderer uploads them. */
export class InstanceBuffer {
    mesh: THREE.InstancedMesh
    private first = Infinity
    private last = -1
    private sources: (object | undefined)[] = []
    private revisions: number[] = []

    constructor(private group: THREE.Group, private geometry: THREE.BufferGeometry,
        private material: THREE.Material, private shadow: boolean, private order = 0, capacity = 64) {
        this.mesh = this.create(capacity)
    }

    private create(capacity: number) {
        const mesh = new THREE.InstancedMesh(this.geometry, this.material, capacity)
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
        // Visibility is selected before packing. Bounds on a battlefield-wide batch are ineffective.
        mesh.frustumCulled = false
        mesh.castShadow = this.shadow
        mesh.receiveShadow = true
        mesh.renderOrder = this.order
        mesh.count = 0
        mesh.visible = false
        this.group.add(mesh)
        return mesh
    }

    private ensure(index: number) {
        if (index >= this.mesh.instanceMatrix.count) {
            const old = this.mesh
            let capacity = old.instanceMatrix.count
            while (capacity <= index) capacity *= 2
            this.mesh = this.create(capacity)
            this.mesh.instanceMatrix.array.set(old.instanceMatrix.array)
            // The replacement buffer has never been uploaded; all its data is sent on first use.
            old.removeFromParent(); old.dispose()
        }
    }

    matches(index: number, source: object, revision: number) {
        return this.sources[index] === source && this.revisions[index] === revision
    }

    /** Pose revisions avoid comparing all 16 components for every unchanged body part. */
    writeCached(index: number, source: object, revision: number, matrix: ArrayLike<number>, offset = 0) {
        if (this.matches(index, source, revision)) return false
        this.ensure(index)
        const array = this.mesh.instanceMatrix.array, start = index * 16
        for (let i = 0; i < 16; i++) array[start + i] = matrix[offset + i]!
        this.sources[index] = source; this.revisions[index] = revision
        this.first = Math.min(this.first, start); this.last = Math.max(this.last, start + 16)
        return true
    }

    write(index: number, matrix: ArrayLike<number>, offset = 0): boolean {
        this.ensure(index)
        this.sources[index] = undefined
        const array = this.mesh.instanceMatrix.array
        const start = index * 16
        let changed = false
        for (let i = 0; i < 16; i++) {
            const value = Math.fround(matrix[offset + i]!)
            if (array[start + i] !== value) { array[start + i] = value; changed = true }
        }
        if (changed) { this.first = Math.min(this.first, start); this.last = Math.max(this.last, start + 16) }
        return changed
    }

    /** Returns the newly dirtied span in bytes (initial GPU allocation is not included). */
    finish(count: number) {
        this.mesh.count = count
        this.mesh.visible = count > 0
        let bytes = 0
        if (this.last >= 0) {
            const attribute = this.mesh.instanceMatrix
            bytes = (this.last - this.first) * Float32Array.BYTES_PER_ELEMENT
            // Multiple updates can happen before a render, including while a mesh is hidden.
            for (const range of attribute.updateRanges) {
                this.first = Math.min(this.first, range.start)
                this.last = Math.max(this.last, range.start + range.count)
            }
            attribute.clearUpdateRanges()
            attribute.addUpdateRange(this.first, this.last - this.first)
            attribute.needsUpdate = true
        }
        this.first = Infinity; this.last = -1
        return bytes
    }

    dispose() { this.mesh.removeFromParent(); this.mesh.dispose() }
}
