/// <reference types="google.maps" />

// Places Autocomplete 只需要瀏覽器端的 Maps JavaScript API（referrer 限制的金鑰吃這個），
// 不要走 Places API (New) 的 REST 端點——那個 API 目前沒有啟用，而且 referrer 限制的金鑰
// 本來就不能用在直接呼叫的 REST Web Service 上（Google 官方限制），只有瀏覽器端 JS API 可用。
let loadPromise: Promise<typeof google> | null = null

/** 動態載入 Google Maps JavaScript API（含 places library），全站只載入一次。
 * 沒有設定 VITE_GOOGLE_MAPS_API_KEY 時回傳 null，呼叫端要自行處理「沒有這個功能」。 */
export function loadGoogleMapsPlaces(): Promise<typeof google> | null {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY
  if (!apiKey) return null
  if (loadPromise) return loadPromise

  loadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-google-maps]')
    if (existing) {
      existing.addEventListener('load', () => resolve(window.google))
      existing.addEventListener('error', () => reject(new Error('Google Maps 載入失敗')))
      return
    }
    const script = document.createElement('script')
    script.dataset.googleMaps = 'true'
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places&language=zh-TW&region=TW`
    script.async = true
    script.onload = () => resolve(window.google)
    script.onerror = () => reject(new Error('Google Maps 載入失敗'))
    document.head.appendChild(script)
  })
  return loadPromise
}
