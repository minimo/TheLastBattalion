import * as THREE from 'three'
import type { PartRole, UnitModel } from './unitModels'

interface AssetPart {
    role: string; pivot: number[]; positions: number[]; normals: number[]; colors: number[]; indices: number[]
    /** Atlas coordinates and baked shade, from scripts/blender/export-unit.py. */
    uvs: number[]; shades: number[]
}

export interface UnitAsset {
    scale: number
    factionScale: number
    palette: { name: string; linear: number[] }[]
    parts: AssetPart[]
    /** The distant model. Parts it omits are not drawn from far away. */
    lod?: AssetPart[]
}

/** Builds a Blender-exported unit, using the army's colour for the palette's faction entry. */
export function createUnitAssetModel(asset: UnitAsset, name: string, faction: number): UnitModel {
    const factionColor = new THREE.Color(faction).multiplyScalar(asset.factionScale)
    const palette = asset.palette.map(entry => entry.name === 'faction'
        ? [factionColor.r, factionColor.g, factionColor.b] : entry.linear)
    const build = (part: AssetPart, label: string) => {
        const geometry = new THREE.BufferGeometry()
        geometry.name = label
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(part.positions, 3))
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(part.normals, 3))
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(part.uvs, 2))
        // Blender exports linear colours. Do not apply an additional sRGB conversion.
        const colors = new Float32Array(part.colors.length * 3)
        part.colors.forEach((index, vertex) => {
            const color = palette[index]!, shade = part.shades[vertex]!
            colors[vertex * 3] = color[0]! * shade
            colors[vertex * 3 + 1] = color[1]! * shade
            colors[vertex * 3 + 2] = color[2]! * shade
        })
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
        geometry.setIndex(part.indices)
        return geometry
    }
    return {
        scale: asset.scale,
        parts: asset.parts.map(part => {
            const far = asset.lod?.find(entry => entry.role === part.role)
            return { role: part.role as PartRole, pivot: new THREE.Vector3().fromArray(part.pivot), geometry: build(part, `${name}:${part.role}`),
                farGeometry: far && build(far, `${name}:${part.role}:far`) }
        }),
    }
}
