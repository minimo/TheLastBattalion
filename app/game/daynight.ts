import type { Owner, StartTime } from '../types/game'

export const START_TIMES: StartTime[] = ['dawn', 'noon', 'dusk', 'midnight']
export const START_TIME_NAME: Record<StartTime, string> = {
    dawn: '夜明け', noon: '昼', dusk: '日没', midnight: '深夜',
}
/** 開戦の時刻（0:00からの分）。夜明けと日没は、明るさの移り変わりの始まりに合わせる。 */
export const START_TIME_MINUTES: Record<StartTime, number> = {
    dawn: 300, noon: 720, dusk: 1020, midnight: 0,
}
export const START_TIME_DESCRIPTION: Record<StartTime, string> = {
    dawn: '05:00 夜明け前。まもなく日が昇り、人間軍が動きやすくなる',
    noon: '12:00 日の高い昼。日が沈むまで人間軍に有利',
    dusk: '17:00 日の沈む前。まもなく夜になり、魔王軍に有利になる',
    midnight: '00:00 真夜中。夜が明けるまで魔王軍に有利',
}

/** dayTimeが昼間(6:00-18:00 = 360-1080分)かどうかを返す */
export function isDaytime(dayTime: number): boolean {
    return dayTime >= 360 && dayTime < 1080
}

/** 時間帯による移動速度倍率を返す（昼間CPU: ×0.6、夜間プレイヤー: ×0.75） */
export function getTimeSpeedMultiplier(owner: Owner, dayTime: number): number {
    if (owner === 'neutral') return 1.0
    const daytime = isDaytime(dayTime)
    // 昼間: CPUが0.6倍、夜間: プレイヤーが0.75倍
    if (daytime && owner === 'cpu') return 0.6
    if (!daytime && owner === 'player') return 0.75
    return 1.0
}

/** 時間帯による防御力消費倍率を返す（昼間CPU: ×1.5、夜間プレイヤー: ×1.3） */
export function getTimeDecayMultiplier(owner: Owner, dayTime: number): number {
    const daytime = isDaytime(dayTime)
    if (daytime && owner === 'cpu') return 1.5
    if (!daytime && owner === 'player') return 1.3
    return 1.0
}

// 夜間の暗さを計算する関数（0〜0.5）
export function getNightAlpha(dayTime: number): number {
    // 06:00〜17:00 (360〜1020): 昼（明るい）
    if (dayTime >= 360 && dayTime < 1020) return 0
    // 17:00〜18:00 (1020〜1080): 夕暮れ遷移
    if (dayTime >= 1020 && dayTime < 1080) return ((dayTime - 1020) / 60) * 0.5
    // 18:00〜翌05:00 (1080〜300): 夜（最大の暗さ）
    if (dayTime >= 1080 || dayTime < 300) return 0.5
    // 05:00〜06:00 (300〜360): 夜明け遷移
    if (dayTime >= 300 && dayTime < 360) return ((360 - dayTime) / 60) * 0.5
    return 0
}

// 夜間の暗さからtint値を計算（暗い紺色への遷移）
export function getNightTint(dayTime: number): number {
    const alpha = getNightAlpha(dayTime)
    if (alpha <= 0) return 0xffffff
    // R,Gチャンネルをやや減衰、Bチャンネルは控えめに減衰させ夜の雰囲気を出す
    const r = Math.round(255 * (1 - alpha * 0.9))
    const g = Math.round(255 * (1 - alpha * 0.9))
    const b = Math.round(255 * (1 - alpha * 0.5))
    return (Math.max(0, r) << 16) | (Math.max(0, g) << 8) | Math.max(0, b)
}
