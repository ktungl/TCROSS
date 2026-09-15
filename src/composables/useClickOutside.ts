import { onBeforeUnmount, onMounted, type Ref } from 'vue'

export function onClickOutside(target: Ref<HTMLElement | null>, handler: () => void): void {
  function onClick(e: MouseEvent) {
    if (target.value && !target.value.contains(e.target as Node)) handler()
  }
  onMounted(() => document.addEventListener('mousedown', onClick))
  onBeforeUnmount(() => document.removeEventListener('mousedown', onClick))
}
