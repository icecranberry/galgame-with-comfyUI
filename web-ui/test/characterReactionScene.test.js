import test from 'node:test'
import assert from 'node:assert/strict'

import {
  activeSceneOverlays,
  activeSystemToastCount,
  isCharacterNotificationBlocked,
} from '../src/utils/characterReactionScene.js'

/**
 * 假 DOM：只实现 characterReactionScene 用到的三个入口。
 * 背景：离场过渡被打断会留下 opacity:0 但仍在 DOM 的幽灵遮罩，
 * 遮挡判定必须按「真实占屏」计数，否则角色通知会被 8 秒 TTL 队列静默吞掉。
 */
function makeEl({ style = {}, rect = { width: 1280, height: 720 }, cardAncestor = false } = {}) {
  return {
    __style: { display: 'flex', visibility: 'visible', opacity: '1', ...style },
    getBoundingClientRect: () => ({ width: rect.width, height: rect.height }),
    closest: selector => (selector === '[data-ct-card]' && cardAncestor ? { tag: 'card' } : null),
  }
}

function installDom({ overlaysBySelector = {}, toastHost = null, visibilityState = 'visible' } = {}) {
  globalThis.window = { getComputedStyle: el => el.__style }
  globalThis.document = {
    visibilityState,
    body: {},
    querySelector: selector => (selector === '.__toast__root' ? toastHost : null),
    querySelectorAll: selector => overlaysBySelector[selector] || [],
  }
  return () => {
    delete globalThis.window
    delete globalThis.document
  }
}

test('可见遮罩计入遮挡，幽灵遮罩（opacity≈0 / display:none / 零面积）不计入', () => {
  const cleanup = installDom({
    overlaysBySelector: {
      '.linshe-modal-overlay': [
        makeEl(),
        makeEl({ style: { opacity: '0' } }),                    // 关闭动画卡死的幽灵遮罩
        makeEl({ style: { display: 'none' } }),                 // 常驻但隐藏的浮层
        makeEl({ style: { visibility: 'hidden' } }),
        makeEl({ rect: { width: 0, height: 0 } }),              // 未铺开的过渡节点
        makeEl({ style: { opacity: '0.6' } }),                  // 渐入中的弹窗仍算遮挡
      ],
    },
  })
  try {
    assert.equal(activeSceneOverlays(), 2)
  } finally {
    cleanup()
  }
})

test('data-ct-card 内部的命中被排除', () => {
  const cleanup = installDom({
    overlaysBySelector: {
      '.vel-modal': [makeEl({ cardAncestor: true })],
    },
  })
  try {
    assert.equal(activeSceneOverlays(), 0)
  } finally {
    cleanup()
  }
})

test('系统 Toast 只数可见卡片，幽灵离场卡片不算', () => {
  const toastHost = {
    querySelectorAll: () => [
      makeEl(),
      makeEl({ style: { opacity: '0' } }),
    ],
  }
  const cleanup = installDom({ toastHost })
  try {
    assert.equal(activeSystemToastCount(), 1)
  } finally {
    cleanup()
  }
})

test('幽灵遮罩不再阻塞角色通知；可见遮罩与页面隐藏仍然阻塞', () => {
  const cleanupGhost = installDom({
    overlaysBySelector: { '.linshe-modal-overlay': [makeEl({ style: { opacity: '0' } })] },
  })
  try {
    assert.equal(isCharacterNotificationBlocked().blocked, false)
  } finally {
    cleanupGhost()
  }

  const cleanupVisible = installDom({
    overlaysBySelector: { '.linshe-modal-overlay': [makeEl()] },
  })
  try {
    const blocked = isCharacterNotificationBlocked()
    assert.equal(blocked.blocked, true)
    assert.equal(blocked.reason, 'overlay')
  } finally {
    cleanupVisible()
  }

  const cleanupHidden = installDom({ visibilityState: 'hidden' })
  try {
    const blocked = isCharacterNotificationBlocked()
    assert.equal(blocked.blocked, true)
    assert.equal(blocked.reason, 'page-hidden')
  } finally {
    cleanupHidden()
  }
})
