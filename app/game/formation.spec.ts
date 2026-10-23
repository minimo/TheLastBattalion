import { describe, expect, it } from 'vitest'
import { FORMATIONS, layoutFormation, ROW_LIMIT, squadBlock, type FormationMember } from './formation'
import { normalizeDeployment, SQUADS_PER_TYPE_MAX } from './deployment'
import type { UnitType } from '../types/game'

const members = (counts: Partial<Record<UnitType, number>>) => {
    let id = 0
    return Object.entries(counts).flatMap(([type, n]) => Array.from({ length: n! }, () => ({ id: id++, type: type as UnitType, size: 60 })))
}

describe('陣形の列', () => {
    it('横陣では同じ兵種の部隊が10部隊まで横に並び、超えた分は2列目に並ぶ', () => {
        const list = members({ infantry: 15, archer: 3 })
        const slots = layoutFormation('line', list)
        const infantry = list.filter(m => m.type === 'infantry').map(m => slots.get(m.id)!)
        const front = infantry.slice(0, ROW_LIMIT), second = infantry.slice(ROW_LIMIT)
        expect(new Set(front.map(s => s.forward)).size).toBe(1)
        expect(new Set(second.map(s => s.forward)).size).toBe(1)
        const depth = squadBlock('infantry', 60).depth
        expect(second[0]!.forward).toBeLessThan(front[0]!.forward - depth)
        // 弓兵は歩兵の2列目のさらに後ろに下がる。
        const archer = slots.get(list.find(m => m.type === 'archer')!.id)!
        expect(archer.forward).toBeLessThan(second[0]!.forward - depth)
    })

    it('どの陣形でも部隊の持ち場が重ならない', () => {
        const list: FormationMember[] = members({ infantry: 20, pikeman: 20, archer: 20, cavalry: 20, supply: 20, engineer: 20 })
        for (const { type } of FORMATIONS) {
            const slots = layoutFormation(type, list)
            expect(slots.size).toBe(list.length)
            const keys = new Set([...slots.values()].map(s => `${Math.round(s.forward)}:${Math.round(s.lateral)}`))
            expect(keys.size).toBe(list.length)
        }
    })

    it('編成は兵種ごとに20部隊まで', () => {
        const plan = normalizeDeployment({ formation: 'line', squads: Array.from({ length: 25 }, () => ({ type: 'supply' as UnitType, size: 10 })) }, 'field', 'player')
        expect(plan.squads.length).toBe(SQUADS_PER_TYPE_MAX)
    })
})
