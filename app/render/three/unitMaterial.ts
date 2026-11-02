import * as THREE from 'three'

const ALBEDO_URL = '/assets/units/unit-albedo.png', MASK_URL = '/assets/units/unit-mask.png'

/** A 1x1 stand-in, shown until the atlas arrives. It matches the atlas's white cell. */
function placeholder(r: number, g: number, b: number) {
    const texture = new THREE.DataTexture(new Uint8Array([r, g, b, 255]), 1, 1)
    texture.needsUpdate = true
    return texture
}

/**
 * The one material for every unit of both armies, so textures add no draw calls.
 * The atlas is colourless detail multiplied by the vertex colour; the army's colour stays in the vertices.
 * The mask's G channel is roughness and B is metalness, hence the factors of 1.
 */
export function createUnitMaterial() {
    const albedoStandIn = placeholder(255, 255, 255), maskStandIn = placeholder(255, 184, 31)
    albedoStandIn.colorSpace = THREE.SRGBColorSpace
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 1,
        map: albedoStandIn, roughnessMap: maskStandIn, metalnessMap: maskStandIn })
    const textures: THREE.Texture[] = [albedoStandIn, maskStandIn]
    // The CPU benchmark and unit tests run without a DOM, and need no images.
    if (typeof document !== 'undefined') {
        const loader = new THREE.TextureLoader()
        const load = (url: string, colorSpace: THREE.ColorSpace, onLoad: (t: THREE.Texture) => void) => {
            const texture = loader.load(url, onLoad)
            texture.colorSpace = colorSpace
            texture.anisotropy = 4
            textures.push(texture)
        }
        load(ALBEDO_URL, THREE.SRGBColorSpace, t => { material.map = t })
        load(MASK_URL, THREE.NoColorSpace, t => { material.roughnessMap = t; material.metalnessMap = t })
    }
    return { material, disposeTextures() { textures.forEach(t => t.dispose()) } }
}
