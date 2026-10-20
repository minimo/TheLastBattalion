import type { Base } from '../../types/game'

// Reserve level ground around map-generated bases. TheLastBattalion places its forts
// outside the generated grid, so the heightfield receives no bases; kept for parity
// with no-life-king's heightfield.
export const FORT_GROUND_RADIUS = 60

export function getFortGroundRadius(base: Base) {
    return base.isCore && !base.isCamp ? 92 : FORT_GROUND_RADIUS
}
