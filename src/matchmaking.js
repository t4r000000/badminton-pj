// バドミントン・ダブルス用の組み合わせ生成ロジック
// - 一度マッチ（ペア/対戦）した組み合わせをできるだけ避ける
// - 出場回数を公平にする
// - 固定ペア (fixedPairs) のプレイヤーは極力同じチームに入れる
//   （人数不足で片方が休憩になる場合はペアを崩してゲームに入れる）
// - 固定ペアが複数あるときは、できるだけ別コートに分散（同じ対戦が連続するのを回避）

const pairKey = (a, b) => [a, b].sort().join('|')

export function getPairCount(history, a, b) {
  return history.pairs[pairKey(a, b)] || 0
}
export function getOpponentCount(history, a, b) {
  return history.opponents[pairKey(a, b)] || 0
}

function shuffle(arr) {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/**
 * 4 人からペア分け（3 通り）。固定ペアを壊さないパターンを優先選択。
 */
function bestPairingOf4(players, history, fixedPairSet) {
  const [p1, p2, p3, p4] = players
  const patterns = [
    { teamA: [p1, p2], teamB: [p3, p4] },
    { teamA: [p1, p3], teamB: [p2, p4] },
    { teamA: [p1, p4], teamB: [p2, p3] },
  ]

  const splitsFixedPair = (pat) => {
    for (const key of fixedPairSet) {
      const [a, b] = key.split('|')
      const ids = players.map((p) => p.id)
      if (!ids.includes(a) || !ids.includes(b)) continue
      const aInA = pat.teamA.some((p) => p.id === a)
      const bInA = pat.teamA.some((p) => p.id === b)
      if (aInA !== bInA) return true // 別チームに分かれた
    }
    return false
  }

  const valid = patterns.filter((p) => !splitsFixedPair(p))
  const pool = valid.length > 0 ? valid : patterns

  let best = null
  for (const pat of pool) {
    const pairScore =
      getPairCount(history, pat.teamA[0].id, pat.teamA[1].id) +
      getPairCount(history, pat.teamB[0].id, pat.teamB[1].id)
    let oppScore = 0
    for (const a of pat.teamA) {
      for (const b of pat.teamB) {
        oppScore += getOpponentCount(history, a.id, b.id)
      }
    }
    const score = pairScore * 10 + oppScore
    if (!best || score < best.score) best = { ...pat, score }
  }
  return best
}

/**
 * 選出済みプレイヤーをコート別の 4 人グループに分ける。
 * - 固定ペアは可能な限り別コートに分散させる（コート数 >= 固定ペア数のとき）
 * - 残りのプレイヤーは、各グループ内の既存メンバーとの ペア/対戦履歴 が最小に
 *   なるよう貪欲法で割り当てる（対戦相手を毎回変えるため）
 */
function assignGroups(playing, numCourts, fixedPairs, history) {
  const groups = Array.from({ length: numCourts }, () => [])
  const used = new Set()

  // 両者が playing に含まれる固定ペアだけ抽出
  const inPlay = fixedPairs.filter(
    ([a, b]) => playing.some((p) => p.id === a) && playing.some((p) => p.id === b)
  )

  // 固定ペアをグループへ配置
  // 「同コート集中」「別コート分散」どちらも許容し、空き 2 以上のグループから
  // 完全ランダムに選ぶ（特定の配置に偏らせない）。
  // 集中／分散の最終判断は generateMatches 側で history を見たスコアで行う。
  const shuffledPairs = shuffle(inPlay)
  for (const [aId, bId] of shuffledPairs) {
    if (used.has(aId) || used.has(bId)) continue
    const candidates = groups
      .map((g, i) => ({ i, len: g.length }))
      .filter(({ len }) => len <= 2)
    if (candidates.length === 0) break // 配置不可（人数オーバー）
    const pick = candidates[Math.floor(Math.random() * candidates.length)]
    const A = playing.find((p) => p.id === aId)
    const B = playing.find((p) => p.id === bId)
    groups[pick.i].push(A, B)
    used.add(aId)
    used.add(bId)
  }

  // 残りプレイヤーを履歴を踏まえつつ各グループへ
  // shuffle で完全な決定論を避け、生成のたびに多様性を持たせる
  const remaining = shuffle(playing.filter((p) => !used.has(p.id)))

  // グループ訪問順もシャッフルして、特定コートに固定の傾向が出ないように
  const groupOrder = shuffle(groups.map((_, i) => i))

  // 各グループを 4 人に揃えるまで貪欲法で 1 人ずつ追加
  // 「グループ既存メンバーとの ペア/対戦履歴 が最小」 + tie は順序ランダムで決まる
  let safety = 0
  while (groupOrder.some((i) => groups[i].length < 4) && remaining.length > 0) {
    if (++safety > 1000) break
    for (const gi of groupOrder) {
      const g = groups[gi]
      if (g.length >= 4 || remaining.length === 0) continue
      let bestIdx = 0
      let bestScore = Infinity
      for (let i = 0; i < remaining.length; i++) {
        const cand = remaining[i]
        let score = 0
        for (const m of g) {
          // ペア履歴は重く、対戦履歴はやや軽く重み付け
          score += getPairCount(history, cand.id, m.id) * 5
          score += getOpponentCount(history, cand.id, m.id)
        }
        if (score < bestScore) {
          bestScore = score
          bestIdx = i
        }
      }
      g.push(remaining.splice(bestIdx, 1)[0])
    }
  }
  return groups
}

/**
 * 出場メンバー / 休憩メンバーを決める。
 * - 固定ペアはできるだけ一緒に出場させる
 * - 総出場回数が少ない人を優先
 * - 人数余剰でペアの片方しか出られない場合は崩す（1名だけ出場）
 */
function pickPlayingMembers(players, need, fixedPairs) {
  // ユニット化（固定ペア = [A,B], 単独 = [X]）
  const idToUnit = new Map()
  for (const p of players) idToUnit.set(p.id, [p])
  for (const [a, b] of fixedPairs) {
    const A = players.find((p) => p.id === a)
    const B = players.find((p) => p.id === b)
    if (!A || !B) continue
    const u = [A, B]
    idToUnit.set(a, u)
    idToUnit.set(b, u)
  }
  const units = Array.from(new Set(idToUnit.values()))

  const avg = (u) => u.reduce((s, p) => s + (p.gamesPlayed || 0), 0) / u.length
  // 同値 tie は shuffle で崩す
  const sorted = shuffle(units).sort((u1, u2) => avg(u1) - avg(u2))

  const playing = []
  const resting = []
  for (const u of sorted) {
    const remain = need - playing.length
    if (remain <= 0) {
      resting.push(...u)
    } else if (u.length <= remain) {
      playing.push(...u)
    } else {
      // 固定ペアだが残り枠が 1 → 片方だけ入れてペアを崩す
      // gamesPlayed 少ない方を入れる
      const sortedU = u.slice().sort((a, b) => (a.gamesPlayed || 0) - (b.gamesPlayed || 0))
      playing.push(sortedU[0])
      resting.push(sortedU[1])
    }
  }
  return { playing, resting }
}

/**
 * 組み合わせ生成のメイン。
 *
 * @param {Array} players プレイヤー (active なもの)
 * @param {number} courts コート数
 * @param {object} history { pairs, opponents }
 * @param {object} opts   { trials, fixedPairs: [[idA,idB], ...] }
 */
export function generateMatches(players, courts, history, opts = {}) {
  const { trials = 200, fixedPairs = [] } = opts

  if (players.length < 4) {
    return { matches: [], resting: players.slice(), error: 'プレイヤーが4人以上必要です' }
  }
  const actualCourts = Math.min(courts, Math.floor(players.length / 4))
  const need = actualCourts * 4

  // 出場 / 休憩を決める
  const { playing, resting } = pickPlayingMembers(players, need, fixedPairs)

  // 固定ペア用の set (両者 playing にいる場合のみ有効)
  const fixedPairSet = new Set(
    fixedPairs
      .filter(([a, b]) => playing.some((p) => p.id === a) && playing.some((p) => p.id === b))
      .map(([a, b]) => pairKey(a, b))
  )

  let bestResult = null
  for (let t = 0; t < trials; t++) {
    const groups = assignGroups(playing, actualCourts, fixedPairs, history)
    const matches = []
    let total = 0
    let splitPenalty = 0
    for (let c = 0; c < actualCourts; c++) {
      const group = groups[c]
      const pairing = bestPairingOf4(group, history, fixedPairSet)
      matches.push({
        court: c + 1,
        teamA: pairing.teamA,
        teamB: pairing.teamB,
        score: pairing.score,
      })
      total += pairing.score

      // 固定ペアの片方だけが別グループに居るのは致命的（ペア崩れ）→ 強くペナルティ
      for (const key of fixedPairSet) {
        const [a, b] = key.split('|')
        const aIn = group.some((p) => p.id === a)
        const bIn = group.some((p) => p.id === b)
        if (aIn !== bIn) splitPenalty += 1
      }
    }
    // ペア vs ペア の対戦も「OKだが連続は避ける」 → total に opponents 履歴が
    // 反映されているので、自然と前回と異なる相手が選ばれるようになる。
    const combined = splitPenalty * 100000 + total
    if (!bestResult || combined < bestResult.combined) {
      bestResult = { matches, combined }
      if (combined === 0) break
    }
  }

  return { matches: bestResult.matches, resting }
}

/** 履歴を更新して新しいオブジェクトを返す */
export function applyMatchesToHistory(history, matches) {
  const next = {
    pairs: { ...history.pairs },
    opponents: { ...history.opponents },
  }
  for (const m of matches) {
    const pa = pairKey(m.teamA[0].id, m.teamA[1].id)
    const pb = pairKey(m.teamB[0].id, m.teamB[1].id)
    next.pairs[pa] = (next.pairs[pa] || 0) + 1
    next.pairs[pb] = (next.pairs[pb] || 0) + 1
    for (const a of m.teamA) {
      for (const b of m.teamB) {
        const k = pairKey(a.id, b.id)
        next.opponents[k] = (next.opponents[k] || 0) + 1
      }
    }
  }
  return next
}
