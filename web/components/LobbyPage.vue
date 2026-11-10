<script setup lang="ts">
import AppIcon from './AppIcon.vue';
import type { GameInfo } from '../lib/types.ts';

defineProps<{ games: GameInfo[]; loading: boolean; error: string; hasRoom: boolean }>();
const emit = defineEmits<{ create: [game: GameInfo]; resume: []; guide: []; retry: [] }>();
</script>

<template>
  <main class="lobby page-width">
    <section class="hero">
      <div class="hero-copy">
        <div class="eyebrow"><span class="tiny-star"><AppIcon name="spark" :size="15" /></span> GOOD COMPANY. GREAT GAMES.</div>
        <h1>一个人打开，<br /><span>两个人开玩。</span></h1>
        <p>带上你熟悉的 AI，坐到同一张桌前。<br />不用换一个助手，只换一种相处方式。</p>
        <button class="text-button hero-guide" @click="emit('guide')">了解如何邀请 AI <AppIcon name="arrow" :size="17" /></button>
      </div>
      <div class="hero-art" aria-hidden="true">
        <div class="orbit orbit-one"></div><div class="orbit orbit-two"></div>
        <div class="art-spark spark-one"><AppIcon name="spark" :size="36" /></div><div class="art-spark spark-two">+</div>
        <div class="board-shadow"></div>
        <div class="play-board">
          <div class="board-grid"></div>
          <div class="pawn pawn-human"><div class="pawn-eyes"><i></i><i></i></div></div>
          <div class="pawn pawn-ai"><div class="ai-eye"></div></div>
          <span class="board-dot dot-one"></span><span class="board-dot dot-two"></span><span class="board-dot dot-three"></span>
        </div>
        <div class="player-label label-human"><span class="label-dot"></span> YOU <span>01</span></div>
        <div class="player-label label-ai"><AppIcon name="spark" :size="14" /> YOUR AI <span>02</span></div>
        <div class="art-caption"><span></span> A LITTLE PLAY. A NEW CONNECTION.</div>
      </div>
    </section>

    <section v-if="hasRoom" class="resume-strip">
      <span class="resume-icon"><AppIcon name="grid" /></span>
      <div><strong>你的位置，还留着。</strong><p>继续当前浏览器里的房间</p></div>
      <button class="text-button" @click="emit('resume')">回到房间 <AppIcon name="arrow" :size="18" /></button>
    </section>

    <section class="games-section" aria-labelledby="games-title">
      <div class="section-heading"><div><div class="eyebrow muted">THE PLAYGROUND</div><h2 id="games-title">选个地方，开始同游</h2></div><span class="section-count">{{ games.length.toString().padStart(2, '0') }} 个开放体验</span></div>
      <div v-if="loading" class="loading-card" role="status"><span class="spinner"></span> 正在打开游乐场…</div>
      <div v-else-if="error" class="error-card" role="alert"><AppIcon name="info" /><div><strong>游乐场暂时失联了</strong><p>{{ error }}</p></div><button class="button secondary" @click="emit('retry')">重新连接</button></div>
      <div v-else-if="!games.length" class="loading-card">还没有开放的体验，稍后再来看看。</div>
      <div v-else class="playground-grid">
        <article v-for="game in games" :key="game.id" class="game-card">
          <div v-if="game.id === 'gomoku'" class="card-art gomoku-art" aria-hidden="true">
            <div class="mini-gomoku">
              <span v-for="index in 49" :key="index" class="mini-cell" :class="{ 'mini-stone': [9, 15, 17, 23, 25, 31, 33, 39].includes(index) }"></span>
            </div>
            <span class="art-coordinate">01 / GOMOKU</span><span class="art-corner">↗</span>
          </div>
          <div v-else class="card-art" aria-hidden="true">
            <div class="card-art-grid"></div>
            <div class="chat-tile tile-back"><AppIcon name="spark" :size="32" /><span class="tile-line"></span><span class="tile-line short"></span></div>
            <div class="chat-tile tile-front"><span class="little-face"><i></i><i></i></span><div class="mini-bubbles"><b></b><b></b><b></b></div></div>
            <span class="art-coordinate">02 / SANDBOX</span><span class="art-corner">↗</span>
          </div>
          <div class="game-card-content">
            <div class="card-title-row"><h3>{{ game.id === 'gomoku' ? '五子棋' : '默契试验场' }}</h3><span class="badge">开放体验</span></div>
            <p>{{ game.id === 'gomoku'
              ? '15×15 无禁手。创建者执黑先行，边下边聊，先连成五子者获胜。'
              : '先打个招呼，再找点默契。和你的 AI 在同一个房间里自由聊天。' }}</p>
            <div class="game-tags"><span><AppIcon name="users" :size="15" /> {{ game.maxPlayers }} 位玩家</span><span><AppIcon name="link" :size="15" /> MCP 接入</span><span>{{ game.id === 'gomoku' ? '轮流落子' : '自由聊天' }}</span></div>
            <div class="card-bottom"><span>{{ game.id === 'gomoku' ? '15×15 · 五子连珠' : '无固定回合 · 不计输赢' }}</span><button class="button primary" @click="emit('create', game)">创建房间 <AppIcon name="arrow" :size="18" /></button></div>
          </div>
        </article>
        <aside class="how-card">
          <div class="how-title"><span class="outlined-icon"><AppIcon name="link" :size="22" /></span><span class="eyebrow">BRING YOUR OWN AI</span></div>
          <h3>熟悉的 AI，<br />新的打开方式。</h3>
          <ol class="how-steps">
            <li><span>01</span><div><strong>给自己开个房间</strong><p>一个名字，就是你的入场券。</p></div></li>
            <li><span>02</span><div><strong>把邀请交给 AI</strong><p>配好 MCP，粘贴邀请指令。</p></div></li>
            <li><span>03</span><div><strong>等它入座，一起玩</strong><p>你的操作和它的行动，同步发生。</p></div></li>
          </ol>
          <button class="text-button" @click="emit('guide')">查看连接指南 <AppIcon name="arrow" :size="17" /></button>
        </aside>
      </div>
    </section>
    <div class="next-chapter"><AppIcon name="spark" :size="18" /><span>更多玩法，留给下一次冒险。</span><span class="eyebrow">THIS IS JUST THE BEGINNING</span></div>
    <footer class="site-footer"><span>为人与 AI 的下一种默契而造。</span><span>LOCAL FIRST <i>·</i> MCP POWERED</span></footer>
    <div v-if="games[0] && !error" class="mobile-lobby-dock"><button class="button primary" @click="emit('create', games[0])"><AppIcon name="plus" :size="18" /> 创建我的房间</button></div>
  </main>
</template>
