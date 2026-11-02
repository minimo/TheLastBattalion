import * as THREE from 'three'
import type { PartRole, UnitModel } from './unitModels'
import asset from './assets/humanPikeman.json'

/** Blender-authored geometry; preserves the four pivots used by the army renderer. */
export function createHumanPikemanModel(faction: number): UnitModel {
    const factionColor = new THREE.Color(faction).multiplyScalar(asset.factionScale)
    const palette = asset.palette.map(entry => entry.name === 'faction'
        ? [factionColor.r, factionColor.g, factionColor.b] : entry.linear)
    return {
        scale: asset.scale,
        parts: asset.parts.map(part => {
            const geometry = new THREE.BufferGeometry()
            geometry.name = `human-pikeman:${part.role}`
            geometry.setAttribute('position', new THREE.Float32BufferAttribute(part.positions, 3))
            geometry.setAttribute('normal', new THREE.Float32BufferAttribute(part.normals, 3))
            // Blender exports linear colours. Do not apply an additional sRGB conversion.
            const colors = new Float32Array(part.colors.length * 3)
            part.colors.forEach((index, vertex) => colors.set(palette[index]!, vertex * 3))
            geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
            geometry.setIndex(part.indices)
            return { role: part.role as PartRole, pivot: new THREE.Vector3().fromArray(part.pivot), geometry }
        }),
    }
}
