import type { Directive } from 'vue'

/** 對話框的鍵盤焦點：開啟時聚焦標了 data-autofocus 的元素，
 * 否則聚焦第一個欄位（沒有欄位就聚焦第一個按鈕），
 * Tab 只在對話框內循環、不會跑到背後的頁面，關閉後焦點回到開啟前的位置。
 * 用法：<div class="modal" v-modal-focus> */

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

interface State {
  previous: HTMLElement | null
  onKeydown: (e: KeyboardEvent) => void
}
const states = new WeakMap<HTMLElement, State>()

function focusables(el: HTMLElement): HTMLElement[] {
  return Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((n) => n.offsetParent !== null)
}

export const vModalFocus: Directive<HTMLElement> = {
  mounted(el) {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const list = focusables(el)
      if (!list.length) return
      const first = list[0]!
      const last = list[list.length - 1]!
      const active = document.activeElement
      if (e.shiftKey && (active === first || !el.contains(active))) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (active === last || !el.contains(active))) {
        e.preventDefault()
        first.focus()
      }
    }
    el.addEventListener('keydown', onKeydown)
    states.set(el, { previous, onKeydown })
    const list = focusables(el)
    const preferred = list.find((n) => n.hasAttribute('data-autofocus'))
    const field = list.find((n) => n.matches('input,select,textarea'))
    ;(preferred ?? field ?? list[0])?.focus()
  },
  unmounted(el) {
    const s = states.get(el)
    if (!s) return
    el.removeEventListener('keydown', s.onKeydown)
    if (s.previous?.isConnected) s.previous.focus()
    states.delete(el)
  },
}
