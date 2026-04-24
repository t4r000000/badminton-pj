<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import {
  generateMatches,
  applyMatchesToHistory,
  getPairCount,
  getOpponentCount,
} from './matchmaking.js'

const STORAGE_KEY = 'badminton-pj-state-v3'

const courts = ref(2)
const players = ref([])
const newPlayerName = ref('')
const history = ref({ pairs: {}, opponents: {} })
const rounds = ref([])

// ---------- Persistence ----------
function save() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      courts: courts.value,
      players: players.value,
      history: history.value,
      rounds: rounds.value,
    })
  )
}
function load() {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return
  try {
    const s = JSON.parse(raw)
    courts.value = s.courts ?? 2
    players.value = (s.players ?? []).map((p) => ({
      wins: 0,
      losses: 0,
      partnerId: null,
      ...p,
    }))
    history.value = s.history ?? { pairs: {}, opponents: {} }
    rounds.value = (s.rounds ?? []).map((r) => ({ resting: [], ...r }))
  } catch (e) {
    console.warn('load failed', e)
  }
}
onMounted(load)
watch([courts, players, history, rounds], save, { deep: true })

// ---------- Player operations ----------
function createPlayer(name) {
  return {
    id: 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    name,
    gamesPlayed: 0,
    wins: 0,
    losses: 0,
    active: true,
    partnerId: null,
  }
}
function addPlayer() {
  const name = newPlayerName.value.trim()
  if (!name) return
  if (players.value.some((p) => p.name === name)) {
    alert('同じ名前のプレイヤーが既にいます')
    return
  }
  players.value.push(createPlayer(name))
  newPlayerName.value = ''
}
function removePlayer(id) {
  // 解除: このプレイヤーをパートナーに指定している相手からも外す
  for (const q of players.value) {
    if (q.partnerId === id) q.partnerId = null
  }
  players.value = players.value.filter((p) => p.id !== id)
}

// ペアを双方向に設定（既存ペアは先に解除）
function setPartner(playerId, partnerId) {
  const p = players.value.find((x) => x.id === playerId)
  if (!p) return
  // 既存の両者のパートナーを解除
  if (p.partnerId) {
    const old = players.value.find((x) => x.id === p.partnerId)
    if (old) old.partnerId = null
  }
  if (partnerId) {
    const q = players.value.find((x) => x.id === partnerId)
    if (!q) return
    if (q.partnerId) {
      const old2 = players.value.find((x) => x.id === q.partnerId)
      if (old2) old2.partnerId = null
    }
    p.partnerId = partnerId
    q.partnerId = playerId
  } else {
    p.partnerId = null
  }
}
function clearPartner(playerId) {
  setPartner(playerId, null)
}

// 固定ペア配列 [[idA, idB], ...] （重複なし）
const fixedPairs = computed(() => {
  const seen = new Set()
  const out = []
  for (const p of players.value) {
    if (!p.partnerId) continue
    const k = [p.id, p.partnerId].sort().join('|')
    if (seen.has(k)) continue
    seen.add(k)
    out.push([p.id, p.partnerId])
  }
  return out
})

function partnerName(id) {
  return players.value.find((p) => p.id === id)?.name || ''
}
function partnerCandidates(p) {
  // 自分以外、かつ パートナー未設定 or 自分と既にペアの相手
  return players.value.filter(
    (q) => q.id !== p.id && (!q.partnerId || q.partnerId === p.id)
  )
}
function toggleActive(id) {
  const p = players.value.find((x) => x.id === id)
  if (p) p.active = !p.active
}
function bulkAdd() {
  const txt = prompt('プレイヤー名を改行またはカンマ区切りで入力してください')
  if (!txt) return
  const names = txt.split(/[\n,、，]/).map((s) => s.trim()).filter(Boolean)
  for (const n of names) {
    if (!players.value.some((p) => p.name === n)) {
      players.value.push(createPlayer(n))
    }
  }
}

// ---------- Match generation ----------
const activePlayers = computed(() => players.value.filter((p) => p.active))
const nextRoundNo = computed(() => rounds.value.length + 1)

function generate() {
  if (activePlayers.value.length < 4) {
    alert('有効なプレイヤーが 4 人以上必要です')
    return
  }
  const { matches, resting, error } = generateMatches(
    activePlayers.value,
    courts.value,
    history.value,
    { fixedPairs: fixedPairs.value }
  )
  if (error) {
    alert(error)
    return
  }
  history.value = applyMatchesToHistory(history.value, matches)
  for (const m of matches) {
    for (const p of [...m.teamA, ...m.teamB]) {
      const t = players.value.find((x) => x.id === p.id)
      if (t) t.gamesPlayed += 1
    }
  }
  rounds.value.push({
    id: 'r_' + Date.now(),
    roundNo: nextRoundNo.value,
    createdAt: new Date().toISOString(),
    matches: matches.map((m) => ({
      court: m.court,
      teamA: m.teamA.map((p) => ({ id: p.id, name: p.name })),
      teamB: m.teamB.map((p) => ({ id: p.id, name: p.name })),
      winner: null,
    })),
    resting: resting.map((p) => ({ id: p.id, name: p.name })),
  })
  // reversedRounds で表示しているため、最新ラウンドは先頭の .round-card
  setTimeout(() => {
    const el = document.querySelector('.round-card')
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, 50)
}

// ---------- Win/Loss ----------
function setWinner(roundId, court, winner) {
  const round = rounds.value.find((r) => r.id === roundId)
  if (!round) return
  const match = round.matches.find((m) => m.court === court)
  if (!match) return
  const prev = match.winner
  if (prev === winner) {
    applyWinDelta(match, prev, -1)
    match.winner = null
    return
  }
  if (prev) applyWinDelta(match, prev, -1)
  match.winner = winner
  applyWinDelta(match, winner, +1)
}
function applyWinDelta(match, winnerSide, delta) {
  const winners = winnerSide === 'A' ? match.teamA : match.teamB
  const losers = winnerSide === 'A' ? match.teamB : match.teamA
  for (const p of winners) {
    const t = players.value.find((x) => x.id === p.id)
    if (t) t.wins = Math.max(0, (t.wins || 0) + delta)
  }
  for (const p of losers) {
    const t = players.value.find((x) => x.id === p.id)
    if (t) t.losses = Math.max(0, (t.losses || 0) + delta)
  }
}

// ---------- Round effect (history / games / wins-losses) ----------
const pairKeyOf = (a, b) => [a, b].sort().join('|')

function applyRoundEffect(round, sign) {
  const next = {
    pairs: { ...history.value.pairs },
    opponents: { ...history.value.opponents },
  }
  for (const m of round.matches) {
    const pa = pairKeyOf(m.teamA[0].id, m.teamA[1].id)
    const pb = pairKeyOf(m.teamB[0].id, m.teamB[1].id)
    next.pairs[pa] = Math.max(0, (next.pairs[pa] || 0) + sign)
    next.pairs[pb] = Math.max(0, (next.pairs[pb] || 0) + sign)
    for (const a of m.teamA) {
      for (const b of m.teamB) {
        const k = pairKeyOf(a.id, b.id)
        next.opponents[k] = Math.max(0, (next.opponents[k] || 0) + sign)
      }
    }
    for (const p of [...m.teamA, ...m.teamB]) {
      const t = players.value.find((x) => x.id === p.id)
      if (t) t.gamesPlayed = Math.max(0, (t.gamesPlayed || 0) + sign)
    }
    if (m.winner) applyWinDelta(m, m.winner, sign)
  }
  history.value = next
}

function deleteRound(roundId) {
  if (!confirm('このラウンドを削除しますか？（履歴と勝敗も巻き戻します）')) return
  const idx = rounds.value.findIndex((r) => r.id === roundId)
  if (idx === -1) return
  applyRoundEffect(rounds.value[idx], -1)
  rounds.value.splice(idx, 1)
  rounds.value.forEach((r, i) => (r.roundNo = i + 1))
}

function resetAll() {
  if (!confirm('全データを削除します。よろしいですか？')) return
  players.value = []
  history.value = { pairs: {}, opponents: {} }
  rounds.value = []
  courts.value = 2
}
function resetHistory() {
  if (!confirm('履歴・勝敗・出場回数をリセットします（プレイヤーは残ります）')) return
  history.value = { pairs: {}, opponents: {} }
  rounds.value = []
  for (const p of players.value) {
    p.gamesPlayed = 0
    p.wins = 0
    p.losses = 0
  }
}

// ---------- Drag & Drop (Pointer Events: PC mouse + touch 両対応) ----------
// loc: { kind:'match', court, side:'A'|'B', index } | { kind:'resting', index }
const dragOverKey = ref(null)
const ptr = ref(null) // { roundId, fromLoc, ghost, currentKey, startClickTarget }

function locKey(roundId, loc) {
  return loc.kind === 'match'
    ? `${roundId}|M|${loc.court}|${loc.side}|${loc.index}`
    : `${roundId}|R|${loc.index}`
}

function parseLocKey(key) {
  const parts = key.split('|')
  // roundId は頭にあるが今回は使わない（フォーマットのみ利用）
  const kind = parts[parts.length === 5 ? 1 : 1]
  if (parts[1] === 'M') {
    return {
      kind: 'match',
      court: Number(parts[2]),
      side: parts[3],
      index: Number(parts[4]),
    }
  }
  return { kind: 'resting', index: Number(parts[2]) }
}

function onPointerDown(ev, roundId, loc, label) {
  // 主ボタン (左クリック or 単一タッチ) のみ
  if (ev.button !== undefined && ev.button !== 0) return
  // スクロールやテキスト選択を止める
  ev.preventDefault()
  const ghost = document.createElement('div')
  ghost.className = 'drag-ghost'
  ghost.textContent = label
  Object.assign(ghost.style, {
    position: 'fixed',
    left: ev.clientX - 40 + 'px',
    top: ev.clientY - 18 + 'px',
    pointerEvents: 'none',
    zIndex: '10000',
    padding: '0.25rem 0.6rem',
    background: '#1565c0',
    color: '#fff',
    borderRadius: '6px',
    fontSize: '0.9rem',
    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
    transform: 'scale(1.05)',
  })
  document.body.appendChild(ghost)
  ptr.value = { roundId, fromLoc: loc, ghost, currentKey: null }
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp, { once: true })
  window.addEventListener('pointercancel', onPointerUp, { once: true })
}

function onPointerMove(ev) {
  const p = ptr.value
  if (!p) return
  p.ghost.style.left = ev.clientX - 40 + 'px'
  p.ghost.style.top = ev.clientY - 18 + 'px'
  // ghost を一時的に非表示にして下の要素を取得
  p.ghost.style.display = 'none'
  const target = document.elementFromPoint(ev.clientX, ev.clientY)
  p.ghost.style.display = ''
  const dropEl = target?.closest('[data-drop-key]')
  if (dropEl && dropEl.getAttribute('data-round-id') === p.roundId) {
    const k = dropEl.getAttribute('data-drop-key')
    dragOverKey.value = k
    p.currentKey = k
  } else {
    dragOverKey.value = null
    p.currentKey = null
  }
}

function onPointerUp() {
  window.removeEventListener('pointermove', onPointerMove)
  const p = ptr.value
  if (!p) return
  p.ghost.remove()
  const key = p.currentKey
  const { roundId, fromLoc } = p
  ptr.value = null
  dragOverKey.value = null
  if (!key) return
  const toLoc = parseLocKey(key)
  if (toLoc) swapPlayers(roundId, fromLoc, toLoc)
}

function getPlayerRef(round, loc) {
  if (loc.kind === 'match') {
    const m = round.matches.find((x) => x.court === loc.court)
    const team = loc.side === 'A' ? m.teamA : m.teamB
    return { container: team, index: loc.index }
  } else {
    return { container: round.resting, index: loc.index }
  }
}

function sameLoc(a, b) {
  if (a.kind !== b.kind) return false
  if (a.kind === 'match')
    return a.court === b.court && a.side === b.side && a.index === b.index
  return a.index === b.index
}

function swapPlayers(roundId, locA, locB) {
  if (sameLoc(locA, locB)) return
  const idx = rounds.value.findIndex((r) => r.id === roundId)
  if (idx === -1) return
  const round = rounds.value[idx]

  applyRoundEffect(round, -1)

  const a = getPlayerRef(round, locA)
  const b = getPlayerRef(round, locB)
  const tmp = a.container[a.index]
  a.container[a.index] = b.container[b.index]
  b.container[b.index] = tmp

  applyRoundEffect(round, +1)
}

// ---------- Diagnostics ----------
function matchQuality(m) {
  const pa = getPairCount(history.value, m.teamA[0].id, m.teamA[1].id)
  const pb = getPairCount(history.value, m.teamB[0].id, m.teamB[1].id)
  let opp = 0
  for (const a of m.teamA)
    for (const b of m.teamB) opp += getOpponentCount(history.value, a.id, b.id)
  return { pa, pb, opp }
}

const reversedRounds = computed(() => rounds.value.slice().reverse())
</script>

<template>
  <div class="app">
    <header>
      <h1>🏸 バドミントン ダブルス組み合わせ</h1>
      <div class="round">完了ラウンド: {{ rounds.length }}</div>
    </header>

    <section class="panel">
      <h2>設定</h2>
      <label>
        コート数:
        <input type="number" v-model.number="courts" min="1" max="20" />
      </label>
      <div class="hint">
        有効プレイヤー: {{ activePlayers.length }} 人 / 必要: {{ courts * 4 }} 人
      </div>
    </section>

    <section class="panel">
      <h2>プレイヤー ({{ players.length }})</h2>
      <div class="add-row">
        <input
          v-model="newPlayerName"
          placeholder="プレイヤー名"
          @keyup.enter="addPlayer"
        />
        <button @click="addPlayer">追加</button>
        <button class="secondary" @click="bulkAdd">まとめて追加</button>
      </div>
      <ul class="player-list">
        <li
          v-for="p in players"
          :key="p.id"
          :class="{ inactive: !p.active, paired: !!p.partnerId }"
        >
          <label class="player-row">
            <input
              type="checkbox"
              :checked="p.active"
              @change="toggleActive(p.id)"
            />
            <span class="name">
              {{ p.name }}
              <span v-if="p.partnerId" class="pair-badge" :title="'ペア: ' + partnerName(p.partnerId)">
                🤝 {{ partnerName(p.partnerId) }}
              </span>
            </span>
            <span class="stats">
              {{ p.gamesPlayed }}試合
              <span class="wl">({{ p.wins || 0 }}勝{{ p.losses || 0 }}敗)</span>
            </span>
          </label>
          <select
            class="partner-select"
            :value="p.partnerId || ''"
            @change="setPartner(p.id, $event.target.value || null)"
            title="固定ペアを設定"
          >
            <option value="">ペアなし</option>
            <option
              v-for="q in partnerCandidates(p)"
              :key="q.id"
              :value="q.id"
            >
              🤝 {{ q.name }}
            </option>
          </select>
          <button class="remove" @click="removePlayer(p.id)">✕</button>
        </li>
      </ul>
      <p v-if="players.length === 0" class="empty">まだプレイヤーがいません</p>
      <p v-if="fixedPairs.length" class="hint">
        固定ペア:
        <span
          v-for="pair in fixedPairs"
          :key="pair.join('-')"
          class="pair-chip"
        >
          🤝 {{ partnerName(pair[0]) }} & {{ partnerName(pair[1]) }}
          <button class="pair-clear" @click="clearPartner(pair[0])">✕</button>
        </span>
      </p>
    </section>

    <section class="panel">
      <h2>組み合わせ生成</h2>
      <div class="actions">
        <button class="primary" @click="generate">
          第{{ nextRoundNo }}ラウンドを生成
        </button>
      </div>
      <p class="hint">
        生成すると「対戦履歴」に追加されます。プレイヤー名は
        <strong>ドラッグ&ドロップ</strong>
        で同ラウンド内を入れ替え可能です。固定ペア (🤝) は極力同じチームにしますが、人数不足時は崩してゲームに入れます。
      </p>
    </section>

    <section class="panel">
      <h2>対戦履歴 ({{ rounds.length }})</h2>
      <p v-if="rounds.length === 0" class="empty">
        まだ履歴がありません。上の「生成」ボタンを押してください。
      </p>
      <div class="rounds">
        <div v-for="r in reversedRounds" :key="r.id" class="round-card">
          <div class="round-head">
            <strong>第{{ r.roundNo }}ラウンド</strong>
            <span class="time">{{
              new Date(r.createdAt).toLocaleString('ja-JP', {
                hour: '2-digit',
                minute: '2-digit',
                month: 'numeric',
                day: 'numeric',
              })
            }}</span>
            <button class="remove small" @click="deleteRound(r.id)">削除</button>
          </div>
          <div class="matches">
            <div v-for="m in r.matches" :key="m.court" class="match">
              <div class="court-head">コート {{ m.court }}</div>
              <div class="teams">
                <div
                  class="team-btn"
                  :class="{ win: m.winner === 'A', lose: m.winner === 'B' }"
                  role="button"
                  tabindex="0"
                  @click="setWinner(r.id, m.court, 'A')"
                >
                  <div class="label">
                    チームA
                    <span v-if="m.winner === 'A'">🏆</span>
                  </div>
                  <div
                    v-for="(p, i) in m.teamA"
                    :key="p.id"
                    class="member"
                    :class="{
                      'drop-hover':
                        dragOverKey ===
                        locKey(r.id, { kind: 'match', court: m.court, side: 'A', index: i }),
                    }"
                    :data-round-id="r.id"
                    :data-drop-key="
                      locKey(r.id, { kind: 'match', court: m.court, side: 'A', index: i })
                    "
                    @pointerdown="
                      onPointerDown($event, r.id, {
                        kind: 'match',
                        court: m.court,
                        side: 'A',
                        index: i,
                      }, p.name)
                    "
                    @click.stop
                  >
                    ⋮⋮ {{ p.name }}
                  </div>
                </div>
                <div class="vs">VS</div>
                <div
                  class="team-btn"
                  :class="{ win: m.winner === 'B', lose: m.winner === 'A' }"
                  role="button"
                  tabindex="0"
                  @click="setWinner(r.id, m.court, 'B')"
                >
                  <div class="label">
                    チームB
                    <span v-if="m.winner === 'B'">🏆</span>
                  </div>
                  <div
                    v-for="(p, i) in m.teamB"
                    :key="p.id"
                    class="member"
                    :class="{
                      'drop-hover':
                        dragOverKey ===
                        locKey(r.id, { kind: 'match', court: m.court, side: 'B', index: i }),
                    }"
                    :data-round-id="r.id"
                    :data-drop-key="
                      locKey(r.id, { kind: 'match', court: m.court, side: 'B', index: i })
                    "
                    @pointerdown="
                      onPointerDown($event, r.id, {
                        kind: 'match',
                        court: m.court,
                        side: 'B',
                        index: i,
                      }, p.name)
                    "
                    @click.stop
                  >
                    ⋮⋮ {{ p.name }}
                  </div>
                </div>
              </div>
              <div class="quality" v-if="r.id === rounds[rounds.length - 1].id">
                <template
                  v-if="
                    matchQuality(m).pa + matchQuality(m).pb + matchQuality(m).opp <= 2
                  "
                >
                  🆕 新鮮な組み合わせ
                </template>
                <template v-else>
                  ペア重複: {{ matchQuality(m).pa + matchQuality(m).pb }} / 対戦重複:
                  {{ matchQuality(m).opp }}
                </template>
              </div>
            </div>
          </div>
          <div v-if="r.resting.length" class="resting">
            <strong>休憩:</strong>
            <span
              v-for="(p, i) in r.resting"
              :key="p.id"
              class="rest-chip"
              :class="{
                'drop-hover':
                  dragOverKey === locKey(r.id, { kind: 'resting', index: i }),
              }"
              :data-round-id="r.id"
              :data-drop-key="locKey(r.id, { kind: 'resting', index: i })"
              @pointerdown="onPointerDown($event, r.id, { kind: 'resting', index: i }, p.name)"
            >
              ⋮⋮ {{ p.name }}
            </span>
          </div>
        </div>
      </div>
    </section>

    <section class="panel danger">
      <h2>データ管理</h2>
      <button class="secondary" @click="resetHistory">履歴・勝敗リセット</button>
      <button class="danger-btn" @click="resetAll">全データ削除</button>
    </section>
  </div>
</template>

<style scoped>
.app {
  max-width: 900px;
  margin: 0 auto;
  padding: 1.5rem 1rem 3rem;
  color: #222;
}
header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 1rem;
}
h1 {
  font-size: 1.4rem;
  margin: 0;
}
.round {
  font-size: 0.9rem;
  color: #666;
}
.panel {
  background: #fff;
  border: 1px solid #e3e3e3;
  border-radius: 10px;
  padding: 1rem 1.25rem;
  margin-bottom: 1rem;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
}
.panel h2 {
  font-size: 1rem;
  margin: 0 0 0.75rem;
  color: #0a6b4a;
}
.hint {
  margin-top: 0.5rem;
  font-size: 0.85rem;
  color: #666;
}
input[type='number'],
input[type='text'],
.add-row input {
  padding: 0.4rem 0.6rem;
  border: 1px solid #ccc;
  border-radius: 6px;
  font-size: 1rem;
}
.add-row {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}
.add-row input {
  flex: 1;
}
button {
  padding: 0.45rem 0.9rem;
  border: none;
  border-radius: 6px;
  background: #0a6b4a;
  color: #fff;
  cursor: pointer;
  font-size: 0.9rem;
}
button.secondary {
  background: #eee;
  color: #333;
}
button.primary {
  background: #0a6b4a;
  font-size: 1rem;
  padding: 0.6rem 1.2rem;
}
button.danger-btn {
  background: #c62828;
  margin-left: 0.5rem;
}
button.small {
  padding: 0.2rem 0.5rem;
  font-size: 0.75rem;
}
button:hover {
  opacity: 0.9;
}
.player-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 0.4rem;
}
.player-list li {
  display: flex;
  align-items: center;
  background: #f7f7f7;
  border-radius: 6px;
  padding: 0.3rem 0.5rem;
}
.player-list li.inactive {
  opacity: 0.45;
  background: #eee;
}
.player-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex: 1;
  cursor: pointer;
}
.player-row .name {
  flex: 1;
}
.player-row .stats {
  font-size: 0.75rem;
  color: #666;
}
.player-row .wl {
  color: #1565c0;
  margin-left: 0.15rem;
}
.remove {
  background: transparent;
  color: #888;
  padding: 0 0.3rem;
}
.remove:hover {
  color: #c62828;
}
.empty {
  color: #999;
  font-size: 0.9rem;
}
.actions {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.25rem;
  flex-wrap: wrap;
}
.rounds {
  display: grid;
  gap: 0.75rem;
}
.round-card {
  border: 1px solid #e3e3e3;
  background: #fafafa;
  border-radius: 8px;
  padding: 0.75rem;
}
.round-head {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin-bottom: 0.5rem;
}
.round-head .time {
  font-size: 0.75rem;
  color: #888;
  flex: 1;
}
.matches {
  display: grid;
  gap: 0.5rem;
}
.match {
  border: 1px solid #d9ead3;
  background: #f6fbf5;
  border-radius: 8px;
  padding: 0.5rem 0.75rem;
}
.court-head {
  font-weight: bold;
  color: #0a6b4a;
  margin-bottom: 0.4rem;
  font-size: 0.9rem;
}
.teams {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: stretch;
  gap: 0.5rem;
}
.team-btn {
  background: #fff;
  color: #222;
  border: 2px solid #ddd;
  border-radius: 8px;
  padding: 0.5rem;
  text-align: center;
  cursor: pointer;
  transition: all 0.15s;
  user-select: none;
}
.team-btn:hover {
  border-color: #1565c0;
}
.team-btn.win {
  background: #fff8e1;
  border-color: #f9a825;
  box-shadow: 0 0 0 2px #fdd835 inset;
}
.team-btn.lose {
  background: #f5f5f5;
  color: #999;
  border-color: #e0e0e0;
}
.team-btn .label {
  font-size: 0.75rem;
  color: inherit;
  margin-bottom: 0.25rem;
  font-weight: bold;
}
.team-btn .member {
  font-size: 0.95rem;
  padding: 0.2rem 0.3rem;
  margin: 0.15rem 0;
  background: #f4fbf1;
  border: 1px dashed transparent;
  border-radius: 5px;
  cursor: grab;
  transition: all 0.12s;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
}
.team-btn .member:hover {
  background: #e8f5e9;
  border-color: #a5d6a7;
}
.team-btn .member:active {
  cursor: grabbing;
}
.team-btn .member.drop-hover {
  background: #bbdefb;
  border-color: #1565c0;
}
.vs {
  font-weight: bold;
  color: #c62828;
  align-self: center;
}
.quality {
  margin-top: 0.4rem;
  font-size: 0.75rem;
  color: #555;
}
.resting {
  margin-top: 0.5rem;
  background: #fff8e1;
  border: 1px solid #ffe082;
  padding: 0.4rem 0.6rem;
  border-radius: 6px;
  font-size: 0.85rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  align-items: center;
}
.rest-chip {
  display: inline-block;
  background: #fff;
  border: 1px dashed #ffb74d;
  border-radius: 12px;
  padding: 0.15rem 0.6rem;
  cursor: grab;
  transition: all 0.12s;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
}
.rest-chip:hover {
  background: #fff3e0;
}
.rest-chip:active {
  cursor: grabbing;
}
.rest-chip.drop-hover {
  background: #bbdefb;
  border-color: #1565c0;
}
.partner-select {
  font-size: 0.75rem;
  padding: 0.15rem 0.3rem;
  border: 1px solid #ccc;
  border-radius: 4px;
  margin-right: 0.3rem;
  max-width: 110px;
}
.pair-badge {
  display: inline-block;
  background: #e3f2fd;
  color: #1565c0;
  border-radius: 10px;
  font-size: 0.7rem;
  padding: 0.05rem 0.4rem;
  margin-left: 0.3rem;
}
.player-list li.paired {
  border: 1px solid #90caf9;
}
.pair-chip {
  display: inline-block;
  background: #e3f2fd;
  color: #0d47a1;
  border-radius: 12px;
  padding: 0.1rem 0.5rem;
  margin: 0.15rem 0.2rem 0 0;
  font-size: 0.8rem;
}
.pair-clear {
  background: transparent;
  color: #1565c0;
  padding: 0 0.2rem;
  font-size: 0.7rem;
}
.panel.danger h2 {
  color: #c62828;
}
</style>
