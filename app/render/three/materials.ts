import * as THREE from 'three'

/** Deterministic, tileable surface maps. All maps are owned by the scene. */
export function createSurfaceMaterials() {
    const textures: THREE.Texture[] = []
    const materials: THREE.MeshStandardMaterial[] = []
    let seed = 3791
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 }
    const makeMap = (kind: 'stone' | 'wood' | 'ground' | 'metal' | 'cloth') => {
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 512
        const ctx = canvas.getContext('2d')!
        const data = ctx.createImageData(512, 512)
        for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
            const offset = (y * 512 + x) * 4
            let value = 170 + random() * 40
            if (kind === 'wood') value = 132 + Math.sin(x * .32 + Math.sin(y * .028) * 2) * 22 + random() * 28 + Math.sin(x * 1.3 + Math.sin(y * .01)) * 9
            if (kind === 'stone') {
                const row = Math.floor(y / 64), localX = (x + row % 2 * 64) % 128
                const mortar = y % 64 < 3 || localX < 3
                const block = Math.sin(Math.floor((x + row % 2 * 64) / 128) * 13 + row * 29) * 16
                value = mortar ? 75 + random() * 20 : 165 + block + random() * 42
            }
            if (kind === 'ground') value = 150 + random() * 65
            if (kind === 'metal') value = 193 + random() * 30 + Math.sin(y * 3) * 8
            if (kind === 'cloth') value = 175 + random() * 25 + ((x + y) % 3 === 0 ? 20 : 0)
            data.data[offset] = value
            data.data[offset + 1] = value
            data.data[offset + 2] = value
            data.data[offset + 3] = 255
        }
        ctx.putImageData(data, 0, 0)
        const map = new THREE.CanvasTexture(canvas)
        map.wrapS = map.wrapT = THREE.RepeatWrapping
        map.colorSpace = THREE.SRGBColorSpace
        map.anisotropy = 8
        textures.push(map)
        return map
    }
    const maps = { stone: makeMap('stone'), wood: makeMap('wood'), ground: makeMap('ground'), metal: makeMap('metal'), cloth: makeMap('cloth') }
    const make = (color: number, kind: keyof typeof maps, options: THREE.MeshStandardMaterialParameters = {}) => {
        const m = new THREE.MeshStandardMaterial({ color, map: maps[kind], bumpMap: maps[kind], bumpScale: kind === 'stone' ? .35 : kind === 'wood' ? .16 : .06, roughness: .9, ...options })
        materials.push(m)
        return m
    }
    const stone = make(0xa3a197, 'stone')
    const wood = make(0x83634b, 'wood')
    const bark = make(0x625b45, 'wood', { bumpScale: .4 })
    const groundMap = maps.ground.clone()
    groundMap.repeat.set(35, 35); groundMap.needsUpdate = true; textures.push(groundMap)
    const ground = new THREE.MeshStandardMaterial({ map: groundMap, bumpMap: groundMap, bumpScale: .12, vertexColors: true, roughness: 1 })
    materials.push(ground)
    const metal = (color: number) => make(color, 'metal', { metalness: .8, roughness: .38, bumpScale: .025 })
    const cloth = (color: number) => make(color, 'cloth', { roughness: 1, side: THREE.DoubleSide })
    return { stone, wood, bark, ground, metal, cloth, destroy() { materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose()) } }
}
