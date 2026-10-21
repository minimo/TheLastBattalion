import { createNoise2D } from 'simplex-noise'
import { GRID_MAX, GRID_SIZE, LOGICAL_SIZE, RANK_CONFIG, TILE, TILE_PX } from './constants'
import { registerMapType, TERRAIN_PROFILE } from './mapType'
import type { Base, MapType, Owner, Rank } from '../types/game'

export type RandomFn = () => number

export function createBase(id: string, owner: Owner, rank: Rank, isCore: boolean, x: number, y: number, initialProduction?: number): Base {
    const config = RANK_CONFIG[rank]
    let prod = initialProduction;
    if (prod === undefined) {
        prod = owner === 'neutral' ? 10 : 20;
    }
    return {
        id,
        owner,
        rank,
        isCore,
        production: prod,
        productionCap: config.cap,
        growthRate: config.growth,
        x,
        y,
        radius: 16, // Visual half of 32x32
    }
}

export function generateMap(rnd: RandomFn, type: MapType = 'standard'): { mapGrid: number[][]; bases: Base[] } {
    const bases: Base[] = []
    const profile = TERRAIN_PROFILE[type]

    // Logical coordinate system: 0 to 832 (52 * 16)
    const size = LOGICAL_SIZE
    const margin = 100
    const minDistance = 100

    // 1. Generate Map (51x51 logic grid for 800x800 area with step 16)
    const noise2D_elev = createNoise2D(rnd)
    const noise2D_moist = createNoise2D(rnd)
    const mapGrid = Array(GRID_SIZE).fill(0).map(() => Array(GRID_SIZE).fill(0))

    for (let y = 0; y <= GRID_MAX; y++) {
        for (let x = 0; x <= GRID_MAX; x++) {
            const nx = x / GRID_MAX - 0.5
            const ny = y / GRID_MAX - 0.5
            // FBM (Fractal Brownian Motion)
            let e = noise2D_elev(nx * 3, ny * 3) + 0.5 * noise2D_elev(nx * 6, ny * 6)
            e = e / 1.5 // normalize

            let m = noise2D_moist(nx * 3, ny * 3) + 0.5 * noise2D_moist(nx * 6, ny * 6)
            m = m / 1.5 // normalize

            if (e > profile.mountainAbove) {
                mapGrid[y]![x] = TILE.MOUNTAIN // Mountain
            } else if (m > profile.woodAbove) {
                mapGrid[y]![x] = TILE.WOOD // Wood
            } else {
                mapGrid[y]![x] = TILE.GRASS // Grass
            }
        }
    }

    // 2. Carve Rivers
    const numRivers = profile.rivers(rnd)
    const riverPoints: { x: number, y: number }[] = []

    for (let r = 0; r < numRivers; r++) {
        const isHorizontal = rnd() < 0.5
        let startX: number, startY: number, endX: number, endY: number

        if (isHorizontal) {
            startX = 0
            startY = Math.floor(rnd() * 42) + 5
            endX = GRID_MAX
            endY = Math.floor(rnd() * 42) + 5
        } else {
            startX = Math.floor(rnd() * 42) + 5
            startY = 0
            endX = Math.floor(rnd() * 42) + 5
            endY = GRID_MAX
        }

        const riverNoise = createNoise2D(rnd)

        const recordPoint = (nx: number, ny: number) => {
            if (mapGrid[ny] && mapGrid[ny]![nx] !== undefined) {
                mapGrid[ny]![nx] = TILE.WATER // Water
                if (nx >= 2 && nx <= 50 && ny >= 2 && ny <= 50) {
                    if (!riverPoints.find(p => p.x === nx && p.y === ny)) {
                        riverPoints.push({ x: nx, y: ny })
                    }
                }
            }
        }

        // Returns the carved tiles in order, so a branch can start on the actual (meandering) river.
        const carveRiverPath = (x0: number, y0: number, x1: number, y1: number) => {
            const path: { x: number, y: number }[] = []
            const dist = Math.hypot(x1 - x0, y1 - y0)
            const steps = Math.ceil(dist * 5)
            let lastNx = Math.round(x0)
            let lastNy = Math.round(y0)
            for (let i = 0; i <= steps; i++) {
                const t = i / steps
                const lx = x0 + (x1 - x0) * t
                const ly = y0 + (y1 - y0) * t
                // Decreased frequency (lx/20) and amplitude (4) for smoother rivers
                // Fade the meander out at both ends so the river starts and ends exactly on its endpoints (map edge / parent river).
                const taper = Math.min(1, t * dist / 6, (1 - t) * dist / 6)
                const offset = riverNoise(lx / 20, ly / 20) * 4 * taper
                const pdx = -(y1 - y0) / (dist || 1)
                const pdy = (x1 - x0) / (dist || 1)
                const nx = Math.round(lx + pdx * offset)
                const ny = Math.round(ly + pdy * offset)

                // Walk one tile at a time so the river stays 4-connected.
                if (i === 0) {
                    recordPoint(nx, ny)
                    path.push({ x: nx, y: ny })
                }
                while (lastNx !== nx || lastNy !== ny) {
                    if (lastNx !== nx) lastNx += Math.sign(nx - lastNx)
                    else lastNy += Math.sign(ny - lastNy)
                    recordPoint(lastNx, lastNy)
                    path.push({ x: lastNx, y: lastNy })
                }
            }
            return path
        }

        const mainPath = carveRiverPath(startX, startY, endX, endY)

        // Branching
        if (rnd() < 1 / 3) {
            const branchT = 0.3 + rnd() * 0.4
            const branchStart = mainPath[Math.floor((mainPath.length - 1) * branchT)]!
            const branchStartX = branchStart.x
            const branchStartY = branchStart.y
            let branchEndX: number, branchEndY: number

            if (isHorizontal) {
                branchEndX = Math.max(0, Math.min(GRID_MAX, branchStartX + (rnd() - 0.5) * GRID_MAX))
                branchEndY = rnd() < 0.5 ? 0 : GRID_MAX
            } else {
                branchEndX = rnd() < 0.5 ? 0 : GRID_MAX
                branchEndY = Math.max(0, Math.min(GRID_MAX, branchStartY + (rnd() - 0.5) * GRID_MAX))
            }
            carveRiverPath(branchStartX, branchStartY, branchEndX, branchEndY)
        }
    }

    // 川が全て生成された後に橋をかける
    // Add 2 to 4 bridges per river system
    const maxBridges = numRivers * (2 + Math.floor(rnd() * 3)) // numRivers * (2 to 4)
    for (let b = 0; b < maxBridges; b++) {
        if (riverPoints.length === 0) break

        // Find a valid straight point
        let validIdx = -1
        let attempt = 0
        while (attempt < 20) {
            const idx = Math.floor(rnd() * riverPoints.length)
            const point = riverPoints[idx]
            if (!point) {
                attempt++
                continue
            }
            const x = point.x
            const y = point.y
            if (mapGrid[y] && mapGrid[y]![x] === TILE.WATER) {
                // Check straightness & ensure bridge ends are valid land
                const top = mapGrid[y - 1]?.[x]
                const bottom = mapGrid[y + 1]?.[x]
                const left = mapGrid[y]?.[x - 1]
                const right = mapGrid[y]?.[x + 1]

                const isValidLand = (tile: number | undefined) => tile !== undefined && tile !== TILE.WATER && tile !== TILE.BRIDGE

                const isRiverHoriz = (left === TILE.WATER && right === TILE.WATER && isValidLand(top) && isValidLand(bottom))
                const isRiverVert = (top === TILE.WATER && bottom === TILE.WATER && isValidLand(left) && isValidLand(right))

                if (isRiverHoriz || isRiverVert) {
                    validIdx = idx
                    break
                }
            }
            attempt++
        }

        if (validIdx !== -1) {
            const point = riverPoints[validIdx]
            if (point) {
                mapGrid[point.y]![point.x] = TILE.BRIDGE // Set to bridge
                // Remove surrounding points to avoid clustered bridges
                riverPoints.splice(Math.max(0, validIdx - 8), 16)
                continue
            }
        }

        // If no valid straight point found after attempts, just remove a random one to prevent infinite loops on tiny rivers
        const failIdx = Math.floor(rnd() * riverPoints.length)
        riverPoints.splice(Math.max(0, failIdx - 8), 16)
    }
    // オアシス: 丸い池をヤシの林が囲む。中央から離して置く（砦の配置は中央から陸を辿る）。
    const [minOases, maxOases] = profile.oases
    const oasisCount = maxOases ? minOases + Math.floor(rnd() * (maxOases - minOases + 1)) : 0
    const oases: { x: number; y: number }[] = []
    for (let attempt = 0; oases.length < oasisCount && attempt < 100; attempt++) {
        const cx = 8 + rnd() * (GRID_MAX - 16), cy = 8 + rnd() * (GRID_MAX - 16)
        if (Math.hypot(cx - GRID_MAX / 2, cy - GRID_MAX / 2) < 10 || oases.some(o => Math.hypot(o.x - cx, o.y - cy) < 16)) continue
        oases.push({ x: cx, y: cy })
        const radius = 1.8 + rnd() * 1.2, phase = rnd() * Math.PI * 2
        for (let y = Math.floor(cy - radius - 4); y <= Math.ceil(cy + radius + 4); y++) for (let x = Math.floor(cx - radius - 4); x <= Math.ceil(cx + radius + 4); x++) {
            if (!mapGrid[y] || mapGrid[y]![x] === undefined) continue
            const angle = Math.atan2(y - cy, x - cx), d = Math.hypot(x - cx, y - cy)
            const edge = radius * (1 + .2 * Math.sin(angle * 3 + phase))
            if (d <= edge) mapGrid[y]![x] = TILE.WATER
            else if (d <= edge + 2.6 && rnd() < .75) mapGrid[y]![x] = TILE.WOOD
            else if (d <= edge + 3.2 && mapGrid[y]![x] === TILE.MOUNTAIN) mapGrid[y]![x] = TILE.GRASS
        }
    }

    // Assign variations for Mountains and Woods
    let waterCount = 0
    for (let y = 0; y <= GRID_MAX; y++) {
        for (let x = 0; x <= GRID_MAX; x++) {
            if (mapGrid[y] && mapGrid[y]![x] === TILE.WATER) waterCount++
            if (mapGrid[y] && mapGrid[y]![x] === TILE.WOOD) {
                // Calculate tree density based on surrounding tiles
                let treeCount = 0
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if (dx === 0 && dy === 0) continue
                        const nx = x + dx
                        const ny = y + dy
                        if (nx >= 0 && nx <= GRID_MAX && ny >= 0 && ny <= GRID_MAX) {
                            const neighborId = mapGrid[ny]?.[nx]
                            // Count as a tree if it's 3, or if it's already assigned a variant 31-39
                            if (neighborId === TILE.WOOD || (neighborId !== undefined && Math.floor(neighborId / 10) === 3)) {
                                treeCount++
                            }
                        }
                    }
                }

                // We have 5 variations (1-5, mapped to 31-35).
                // Tree count is max 8.
                // Higher index (34-35) = denser. Lower index (31-33) = sparser.
                let variantOffset = 0
                if (treeCount >= 6) {
                    // Deep forest: highly likely to be 34-35, sometimes 33
                    variantOffset = 2 + Math.floor(rnd() * 3) // 2, 3, 4 (maps to 33, 34, 35)
                } else if (treeCount >= 3) {
                    // Mid forest: mix of all, skewed middle
                    variantOffset = 1 + Math.floor(rnd() * 4) // 1, 2, 3, 4 (maps to 32, 33, 34, 35)
                } else {
                    // Edge of forest: likely to be 31-32, sometimes 33
                    variantOffset = Math.floor(rnd() * 3) // 0, 1, 2 (maps to 31, 32, 33)
                }

                mapGrid[y]![x] = 31 + variantOffset
            } else if (mapGrid[y] && mapGrid[y]![x] === TILE.MOUNTAIN) {
                // Mountain
                let isHigh = true
                const dirs: [number, number][] = [[0, -1], [0, 1], [-1, 0], [1, 0]]
                for (const [dx, dy] of dirs) {
                    const nx = x + dx
                    const ny = y + dy
                    if (nx >= 0 && nx <= GRID_MAX && ny >= 0 && ny <= GRID_MAX) {
                        // If any neighbour is NOT a mountain, it's not surrounded
                        const neighborId = mapGrid[ny]?.[nx]
                        if (neighborId !== undefined && neighborId !== TILE.MOUNTAIN && Math.floor(neighborId / 10) !== 2) {
                            isHigh = false
                            break
                        }
                    } else {
                        isHigh = false
                        break
                    }
                }
                if (isHigh) {
                    mapGrid[y]![x] = 23 + Math.floor(rnd() * 2) // 23, 24
                } else {
                    mapGrid[y]![x] = 21 + Math.floor(rnd() * 2) // 21, 22
                }

            }
        }
    }

    // 川で完全に分断された陸地（一定以上の広さ）がある場合は、橋で結ぶ
    let landsConnected = false;
    let landConnectAttempts = 0;
    while (!landsConnected && landConnectAttempts < 10) {
        landConnectAttempts++;
        const visitedGrid = new Set<number>();
        const key = (x: number, y: number) => y * 53 + x;
        const landGroups: { x: number, y: number }[][] = [];

        for (let y = 0; y <= GRID_MAX; y++) {
            for (let x = 0; x <= GRID_MAX; x++) {
                const tile = mapGrid[y]?.[x] ?? TILE.GRASS;
                if (tile !== TILE.WATER && !visitedGrid.has(key(x, y))) {
                    const group: { x: number, y: number }[] = [];
                    const queue: { x: number, y: number }[] = [{ x, y }];
                    visitedGrid.add(key(x, y));

                    let qIdx = 0;
                    while (qIdx < queue.length) {
                        const cur = queue[qIdx++]!;
                        group.push(cur);

                        const DIRS: [number, number][] = [[0, -1], [0, 1], [-1, 0], [1, 0]];
                        for (const [dx, dy] of DIRS) {
                            const nx = cur.x + dx;
                            const ny = cur.y + dy;
                            if (nx >= 0 && nx <= GRID_MAX && ny >= 0 && ny <= GRID_MAX) {
                                const nTile = mapGrid[ny]?.[nx] ?? TILE.GRASS;
                                if (nTile !== TILE.WATER) {
                                    const nk = key(nx, ny);
                                    if (!visitedGrid.has(nk)) {
                                        visitedGrid.add(nk);
                                        queue.push({ x: nx, y: ny });
                                    }
                                }
                            }
                        }
                    }
                    // 一定以上の広さを持つ陸地のみ（広さ20超）
                    if (group.length > 20) {
                        landGroups.push(group);
                    }
                }
            }
        }

        if (landGroups.length <= 1) {
            landsConnected = true;
        } else {
            // グループ0とグループ1の海岸線を探し、最も近い2点を橋で繋ぐ
            const getShoreline = (group: { x: number, y: number }[]) => {
                return group.filter(p => {
                    const DIRS: [number, number][] = [[0, -1], [0, 1], [-1, 0], [1, 0]];
                    for (const [dx, dy] of DIRS) {
                        const nx = p.x + dx;
                        const ny = p.y + dy;
                        if (nx >= 0 && nx <= GRID_MAX && ny >= 0 && ny <= GRID_MAX) {
                            if (mapGrid[ny]?.[nx] === TILE.WATER) return true;
                        }
                    }
                    return false;
                });
            };

            const shoreA = getShoreline(landGroups[0]!);
            const shoreB = getShoreline(landGroups[1]!);

            let minD = Infinity;
            let bestPair: { a: { x: number, y: number }, b: { x: number, y: number } } | null = null;

            const ptsA = shoreA.length > 0 ? shoreA : landGroups[0]!;
            const ptsB = shoreB.length > 0 ? shoreB : landGroups[1]!;

            for (const a of ptsA) {
                for (const b of ptsB) {
                    const d = Math.hypot(a.x - b.x, a.y - b.y);
                    if (d < minD) {
                        minD = d;
                        bestPair = { a, b };
                    }
                }
            }

            if (bestPair) {
                let x0 = bestPair.a.x;
                let y0 = bestPair.a.y;
                const x1 = bestPair.b.x;
                const y1 = bestPair.b.y;

                const dx = Math.abs(x1 - x0);
                const dy = Math.abs(y1 - y0);
                const sx = x0 < x1 ? 1 : -1;
                const sy = y0 < y1 ? 1 : -1;
                let err = dx - dy;

                while (true) {
                    if (x0 >= 0 && x0 <= GRID_MAX && y0 >= 0 && y0 <= GRID_MAX) {
                        if (mapGrid[y0]?.[x0] === TILE.WATER) {
                            mapGrid[y0]![x0] = TILE.BRIDGE; // 橋を追加
                        }
                    }
                    if (x0 === x1 && y0 === y1) break;
                    const e2 = 2 * err;
                    if (e2 > -dy) {
                        err -= dy;
                        x0 += sx;
                    }
                    if (e2 < dx) {
                        err += dx;
                        y0 += sy;
                    }
                }
            } else {
                break; // ありえないがデッドロック防止のため
            }
        }
    }

    // 3. Create Bases
    const isValidBaseLocation = (wx: number, wy: number) => {
        const gx = Math.round(wx / TILE_PX)
        const gy = Math.round(wy / TILE_PX)

        // 周囲3x3マス（自分自身と周囲8マス）に水場(1)または橋(4)がないかチェック
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                const nx = gx + dx
                const ny = gy + dy
                if (ny >= 0 && ny <= GRID_MAX && nx >= 0 && nx <= GRID_MAX) {
                    const tile = mapGrid[ny]![nx]
                    if (tile === TILE.WATER || tile === TILE.BRIDGE) return false // Water or Bridge is too close
                }
            }
        }
        // Check distance from existing bases
        const tooClose = bases.some(b => Math.hypot(b.x - wx, b.y - wy) < minDistance)
        if (tooClose) return false

        return true
    }

    // A helper to place a core base, avoiding water
    const placeCore = (id: string, owner: Owner, startX: number, startY: number, stepX: number, stepY: number) => {
        let bx = startX
        let by = startY
        let attempts = 0
        while (!isValidBaseLocation(bx, by) && attempts < 50) {
            bx += stepX
            by += stepY
            attempts++
        }
        bases.push(createBase(id, owner, 1, true, bx, by))
    }

    // Player Core (Bottom-Left map corner)
    placeCore('p-core', 'player', 48, size - 48, 16, -16)

    // CPU Core (Top-Right map corner)
    placeCore('c-core', 'cpu', size - 48, 48, -16, 16)

    // 固定の中立砦 (左上と右下)
    // 左上: (margin, margin) 付近
    let luX = margin, luY = margin;
    let luAttempts = 0;
    while (!isValidBaseLocation(luX, luY) && luAttempts < 50) {
        luX += TILE_PX; luY += TILE_PX; luAttempts++;
    }
    bases.push(createBase('n-fort-lu', 'neutral', 2, false, luX, luY, 50));

    // 右下: (size - margin, size - margin) 付近
    let rdX = size - margin, rdY = size - margin;
    let rdAttempts = 0;
    while (!isValidBaseLocation(rdX, rdY) && rdAttempts < 50) {
        rdX -= TILE_PX; rdY -= TILE_PX; rdAttempts++;
    }
    bases.push(createBase('n-fort-rd', 'neutral', 2, false, rdX, rdY, 50));

    // 追加のランダムな中立砦 (0-1個)
    const extraFortsCount = Math.floor(rnd() * 2); // 0, 1
    let fortAttempts = 0;
    while (bases.filter(b => b.owner === 'neutral' && b.rank === 2).length < 2 + extraFortsCount && fortAttempts < 200) {
        fortAttempts++;
        const x = margin + rnd() * (size - margin * 2);
        const y = margin + rnd() * (size - margin * 2);
        if (isValidBaseLocation(x, y)) {
            const id = `n-fort-${bases.length}`;
            bases.push(createBase(id, 'neutral', 2, false, x, y, 50));
        }
    }

    // 中立集落 (8-14個)
    const villageCount = Math.floor(rnd() * 7) + 8; // 8 to 14
    let neutralAttempts = 0;
    while (bases.filter(b => b.owner === 'neutral' && b.rank === 1).length < villageCount && neutralAttempts < 500) {
        neutralAttempts++
        const x = margin + rnd() * (size - margin * 2)
        const y = margin + rnd() * (size - margin * 2)

        // Check terrain validity and distance
        if (!isValidBaseLocation(x, y)) continue

        const id = `n-vill-${bases.length}`
        bases.push(createBase(id, 'neutral', 1, false, x, y))
    }

    // 4. Clear area around bases
    bases.forEach(base => {
        const gridX = Math.round(base.x / TILE_PX)
        const gridY = Math.round(base.y / TILE_PX)
        for (let dy = -2; dy <= 2; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
                const ny = gridY + dy
                const nx = gridX + dx
                if (ny >= 0 && ny <= GRID_MAX && nx >= 0 && nx <= GRID_MAX) {
                    if (mapGrid[ny]![nx] !== TILE.WATER && mapGrid[ny]![nx] !== TILE.BRIDGE) { // Do not erase rivers or bridges
                        mapGrid[ny]![nx] = TILE.GRASS // Grass
                    }
                }
            }
        }
    })

    registerMapType(mapGrid, type)
    return { mapGrid, bases }
}
