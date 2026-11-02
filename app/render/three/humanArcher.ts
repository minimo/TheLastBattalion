import * as THREE from 'three'
import type { PartRole, UnitModel } from './unitModels'
import asset from './assets/humanArcher.json'

/** Five Blender-authored parts; upper body and nocked arrow share a waist pivot. */
export function createHumanArcherModel(faction: number): UnitModel {
    const factionColor = new THREE.Color(faction).multiplyScalar(asset.factionScale)
    const palette = asset.palette.map(entry => entry.name === 'faction'
        ? [factionColor.r, factionColor.g, factionColor.b] : entry.linear)
    return {
        scale: asset.scale,
        parts: asset.parts.map(part => {
            const geometry = new THREE.BufferGeometry()
            geometry.name = `human-archer:${part.role}`
            geometry.setAttribute('position', new THREE.Float32BufferAttribute(part.positions, 3))
            geometry.setAttribute('normal', new THREE.Float32BufferAttribute(part.normals, 3))
            // Blender exports linear colours; only the faction colour is supplied by the game.
            const colors = new Float32Array(part.colors.length * 3)
            part.colors.forEach((index, vertex) => colors.set(palette[index]!, vertex * 3))
            geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
            geometry.setIndex(part.indices)
            return { role: part.role as PartRole, pivot: new THREE.Vector3().fromArray(part.pivot), geometry }
        }),
    }
}
