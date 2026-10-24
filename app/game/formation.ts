import type { FormationType, Point, UnitType } from '../types/game'

/** 部隊の定員。 */
export const SQUAD_SIZE: Record<UnitType, number> = { infantry: 70, pikeman: 50, archer: 60, cavalry: 35, supply: 20, engineer: 30 }
/** 部隊の隊列（横の人数と間隔）。槍兵は横に長い横隊で、肩を並べて隙間なく並ぶ。 */
const SQUAD_COLUMNS: Record<UnitType, number> = { infantry: 10, pikeman: 12, archer: 12, cavalry: 6, supply: 5, engineer: 6 }
const SQUAD_SPACING: Record<UnitType, number> = { infantry: 4.9, pikeman: 4.6, archer: 5.2, cavalry: 7.5, supply: 5.2, engineer: 5.2 }
/** 部隊同士の間隔。 */
const GAP = 10
/** 横一列に並べる部隊の数。超えた分は後ろの列に並べる。 */
export const ROW_LIMIT = 10
/** 同じ兵種の列と列の間隔。 */
const ROW_GAP = 12

export const FORMATIONS: { type: FormationType; name: string; description: string }[] = [
    { type: 'line', name: '横陣', description: '槍兵を最前列、後ろに歩兵と弓兵、両翼に騎兵' },
    { type: 'crane', name: '鶴翼', description: '両翼を前に張り出し、敵を包み込む' },
    { type: 'scale', name: '魚鱗', description: '歩兵を三角に重ね、中央突破を狙う' },
    { type: 'circle', name: '方円', description: '槍兵と歩兵が円く囲み、弓兵を守る守りの陣' },
    { type: 'arrow', name: '鋒矢', description: '騎兵を先頭に、縦に連なって突撃する' },
]

export function squadBlock(type: UnitType, count: number) {
    const spacing = SQUAD_SPACING[type]
    const cols = Math.max(1, Math.min(SQUAD_COLUMNS[type], count))
    const rows = Math.max(1, Math.ceil(count / cols))
    return { cols, rows, spacing, width: cols * spacing, depth: rows * spacing }
}

/** 部隊内の持ち場（前列中央が原点、forwardは前方が正、lateralは右手が正）。 */
export function slotOffset(type: UnitType, count: number, slot: number) {
    const { cols, spacing } = squadBlock(type, count)
    const col = slot % cols, row = Math.floor(slot / cols)
    return { forward: -row * spacing, lateral: (col - (cols - 1) / 2) * spacing }
}

/** 向き（atan2(dx, dy) の角度）から前方・右手の単位ベクトル。 */
export function axes(facing: number) {
    const fx = Math.sin(facing), fy = Math.cos(facing)
    return { fx, fy, rx: -fy, ry: fx }
}

export function toWorld(origin: Point, facing: number, forward: number, lateral: number): Point {
    const { fx, fy, rx, ry } = axes(facing)
    return { x: origin.x + fx * forward + rx * lateral, y: origin.y + fy * forward + ry * lateral }
}

/** 陣に並べるもの。ふつうは小隊。width・depth があれば、中隊のかたまり（中の小隊はまとめて並べる）の幅と奥行き。 */
export interface FormationMember { id: number; type: UnitType; size: number; width?: number; depth?: number }
export interface FormationSlot { forward: number; lateral: number; facing: number }

/**
 * 全軍の陣形で各部隊の持ち場（陣の前列中央からの相対位置と向き）を決める。
 * 持ち場は部隊の前列中央。部隊の隊列はそこから後ろへ伸びる。
 */
export function layoutFormation(type: FormationType, members: FormationMember[]): Map<number, FormationSlot> {
    const slots = new Map<number, FormationSlot>()
    const of = (t: UnitType) => members.filter(m => m.type === t)
    const infantry = of('infantry'), pikemen = of('pikeman'), archers = of('archer'), cavalry = of('cavalry'), rear = [...of('supply'), ...of('engineer')]
    const width = (m: FormationMember) => m.width ?? squadBlock(m.type, m.size).width
    const depthOf = (m: FormationMember) => m.depth ?? squadBlock(m.type, m.size).depth
    const depth = (list: FormationMember[]) => Math.max(0, ...list.map(depthOf))
    const rowWidth = (list: FormationMember[]) => list.reduce((sum, m) => sum + width(m), 0) + Math.max(0, list.length - 1) * GAP
    /** ROW_LIMIT 部隊ずつの列に分ける。 */
    const chunks = (list: FormationMember[]) => Array.from({ length: Math.ceil(list.length / ROW_LIMIT) }, (_, i) => list.slice(i * ROW_LIMIT, (i + 1) * ROW_LIMIT))
    /** 列に分けて前から順に並べたときの、全体の奥行きと最も広い列の幅。 */
    const blockDepth = (list: FormationMember[]) => chunks(list).reduce((sum, c, i) => sum + depth(c) + (i ? ROW_GAP : 0), 0)
    const blockWidth = (list: FormationMember[]) => Math.max(0, ...chunks(list).map(rowWidth))
    const set = (m: FormationMember, forward: number, lateral: number, facing = 0) => slots.set(m.id, { forward, lateral, facing })
    /** 横一列に並べる。 */
    const row = (list: FormationMember[], forward: number, center = 0) => {
        let lateral = center - rowWidth(list) / 2
        for (const m of list) { set(m, forward, lateral + width(m) / 2); lateral += width(m) + GAP }
    }
    /** 横に並べ、ROW_LIMIT 部隊を超えた分は後ろの列に並べる。 */
    const rows = (list: FormationMember[], forward: number, center = 0) => {
        for (const c of chunks(list)) { row(c, forward, center); forward -= depth(c) + ROW_GAP }
    }
    /** 中央の列の外側へ順に並べる（両翼）。ROW_LIMIT 部隊を超えた分は後ろの列の両翼に並べる。 */
    const wings = (list: FormationMember[], forward: number, inner: number) => {
        for (const c of chunks(list)) {
            const edge = [inner, inner]
            c.forEach((m, i) => {
                const side = i % 2 === 0 ? -1 : 1, k = side < 0 ? 0 : 1
                const lateral = side * (edge[k]! + GAP + width(m) / 2)
                edge[k] = edge[k]! + GAP + width(m)
                set(m, forward, lateral)
            })
            forward -= depth(c) + ROW_GAP
        }
    }
    const infantryDepth = depth(infantry)
    /** 槍兵は陣の最前列（前列中央の前）に横に並び、前線を守る。 */
    const pikeFront = () => rows(pikemen, blockDepth(pikemen) + 12)
    if (type === 'line') {
        pikeFront()
        rows(infantry, 0)
        rows(archers, -(blockDepth(infantry) + 16))
        wings(cavalry, 0, blockWidth(infantry) / 2)
    } else if (type === 'crane') {
        // 中央を下げ、外側ほど前へ張り出して内向きに構える。
        rows(infantry, 0)
        for (const m of infantry) {
            const slot = slots.get(m.id)!
            slot.forward += Math.abs(slot.lateral) * .5
            // 向きは +δ で左（-右手）へ回るので、左翼は右へ、右翼は左へ向ける。
            slot.facing = Math.sign(slot.lateral) * .35
        }
        pikeFront()
        rows(archers, -(blockDepth(infantry) + 18))
        const tip = blockWidth(infantry) / 2
        wings(cavalry, tip * .5 + 24, tip)
    } else if (type === 'scale') {
        // 先頭1部隊、次に2部隊…と三角に重ねる。
        let index = 0, rowIndex = 0, forward = 0, lastWidth = 0
        while (index < infantry.length) {
            const list = infantry.slice(index, index + Math.min(rowIndex + 1, ROW_LIMIT))
            row(list, forward)
            lastWidth = rowWidth(list)
            index += list.length
            rowIndex++
            forward -= infantryDepth + 12
        }
        pikeFront()
        const back = forward + infantryDepth + 12
        rows(archers, back - (infantryDepth + 16))
        wings(cavalry, back, lastWidth / 2)
    } else if (type === 'circle') {
        // 槍兵と歩兵が交互に外向きの円陣を組み、中に弓兵、後ろ寄りに騎兵。
        const ring = [...infantry, ...pikemen].sort((a, b) => ringOrder(a, infantry, pikemen) - ringOrder(b, infantry, pikemen))
        const perimeter = rowWidth(ring) + GAP
        const radius = Math.max(45, perimeter / (Math.PI * 2) + Math.max(infantryDepth, depth(pikemen)) * .5)
        let angle = 0
        for (const m of ring) {
            angle += (width(m) + GAP) / 2 / radius
            set(m, Math.cos(angle) * radius - radius, Math.sin(angle) * radius, -angle)
            angle += (width(m) + GAP) / 2 / radius
        }
        rows(archers, -radius + blockDepth(archers) / 2)
        rows(cavalry, -radius - radius * .45)
    } else {
        // 鋒矢: 騎兵が先頭、歩兵が2列の縦隊で続き、弓兵、最後尾を槍兵が守る。
        rows(cavalry, 0)
        let forward = -(blockDepth(cavalry) + 14)
        for (let i = 0; i < infantry.length; i += 2) {
            row(infantry.slice(i, i + 2), forward)
            forward -= infantryDepth + 10
        }
        rows(archers, forward)
        rows(pikemen, forward - blockDepth(archers) - 12)
    }
    // 補給部隊と工兵はどの陣形でも最後尾に控える。
    if (rear.length) {
        let back = 0
        for (const m of members) {
            const slot = slots.get(m.id)
            if (slot) back = Math.min(back, slot.forward - depthOf(m))
        }
        rows(rear, back - 20)
    }
    return slots
}

/** 1つの中隊に入れる小隊の数の上限。 */
export const COMPANY_MAX_SQUADS = 4

/**
 * 陣の持ち場から、同じ兵種で隣り合う小隊を中隊にまとめる（返すのは中隊ごとの小隊のID）。
 * 兵種ごとに左から順に並べ、離れた所（両翼の左右など）で区切り、続きは COMPANY_MAX_SQUADS 個以下の同じくらいの数に分ける。
 */
export function groupCompanies(members: FormationMember[], slots: Map<number, FormationSlot>): number[][] {
    const companies: number[][] = []
    for (const type of new Set(members.map(m => m.type))) {
        const list = members.filter(m => m.type === type && slots.has(m.id))
            .sort((a, b) => slots.get(a.id)!.lateral - slots.get(b.id)!.lateral || slots.get(b.id)!.forward - slots.get(a.id)!.forward)
        let run: FormationMember[] = []
        const flush = () => {
            const count = Math.ceil(run.length / COMPANY_MAX_SQUADS)
            for (let i = 0, start = 0; i < count; i++) {
                const end = start + Math.ceil((run.length - start) / (count - i))
                companies.push(run.slice(start, end).map(m => m.id))
                start = end
            }
            run = []
        }
        for (const m of list) {
            const last = run.at(-1)
            if (last) {
                const a = slots.get(last.id)!, b = slots.get(m.id)!
                const reach = (squadBlock(last.type, last.size).width + squadBlock(m.type, m.size).width) / 2 + GAP + 40
                if (Math.hypot(a.forward - b.forward, a.lateral - b.lateral) > reach) flush()
            }
            run.push(m)
        }
        if (run.length) flush()
    }
    return companies
}

/**
 * 中隊の隊形: 小隊を横陣の並べ方（槍兵が前、弓兵が後ろ、騎兵が両翼）で組む。
 * 持ち場は前列中央を原点にし（いちばん前の小隊の前列が0）、中隊のかたまりの幅と奥行きも返す。
 */
export function companyBlock(members: FormationMember[]) {
    const slots = layoutFormation('line', members)
    let front = -Infinity, back = Infinity, left = Infinity, right = -Infinity
    for (const m of members) {
        const slot = slots.get(m.id)
        if (!slot) continue
        const { width, depth } = squadBlock(m.type, m.size)
        front = Math.max(front, slot.forward)
        back = Math.min(back, slot.forward - depth)
        left = Math.min(left, slot.lateral - width / 2)
        right = Math.max(right, slot.lateral + width / 2)
    }
    if (!Number.isFinite(front)) return { slots, width: 0, depth: 0 }
    const center = (left + right) / 2
    for (const slot of slots.values()) { slot.forward -= front; slot.lateral -= center }
    return { slots, width: right - left, depth: front - back }
}

/** 中隊の隊形の、まん中を原点にした持ち場（中隊ごとの移動で、指定地点を中隊のまん中にする）。 */
export function layoutCompany(members: FormationMember[]): Map<number, FormationSlot> {
    const { slots, depth } = companyBlock(members)
    for (const slot of slots.values()) slot.forward += depth / 2
    return slots
}

/** 中隊の主な役目の兵種（陣のどこに並ぶか）。歩兵か槍兵がいれば前線、なければ弓兵・騎兵・後方の順。 */
export function companyRole(types: UnitType[]): UnitType {
    if (types.includes('infantry')) return 'infantry'
    if (types.includes('pikeman')) return 'pikeman'
    if (types.includes('archer')) return 'archer'
    if (types.includes('cavalry')) return 'cavalry'
    return types.includes('supply') ? 'supply' : 'engineer'
}

/**
 * 中隊のかたまり（blocks: かたまりのID → 中の小隊）を1つずつとして陣を組み、小隊ごとの持ち場に広げる。
 * かたまりは主な役目の兵種の場所に並び、中の小隊はかたまりの向きに回して置く。
 */
export function layoutFormationWithCompanies(type: FormationType, members: FormationMember[], blocks: Map<number, FormationMember[]>): Map<number, FormationSlot> {
    const inner = new Map<number, ReturnType<typeof companyBlock>>()
    const units: FormationMember[] = [...members]
    for (const [id, list] of blocks) {
        const block = companyBlock(list)
        inner.set(id, block)
        units.push({ id, type: companyRole([...new Set(list.map(m => m.type))]), size: list.reduce((sum, m) => sum + m.size, 0), width: block.width, depth: block.depth })
    }
    const layout = layoutFormation(type, units)
    const slots = new Map<number, FormationSlot>()
    for (const m of members) { const slot = layout.get(m.id); if (slot) slots.set(m.id, slot) }
    for (const [id, block] of inner) {
        const at = layout.get(id)
        if (!at) continue
        // かたまりの向き（陣に対して at.facing だけ回す）で、中の持ち場を陣の前方・右手の成分に直す。
        const cos = Math.cos(at.facing), sin = Math.sin(at.facing)
        for (const [squadId, slot] of block.slots) {
            slots.set(squadId, { forward: at.forward + slot.forward * cos + slot.lateral * sin, lateral: at.lateral - slot.forward * sin + slot.lateral * cos, facing: at.facing + slot.facing })
        }
    }
    return slots
}

/** 円陣で歩兵と槍兵を交互に並べるための順番（それぞれの列の中の位置を、円周上の割合にする）。 */
function ringOrder(m: FormationMember, infantry: FormationMember[], pikemen: FormationMember[]) {
    const list = m.type === 'pikeman' ? pikemen : infantry
    return (list.indexOf(m) + .5) / list.length
}
