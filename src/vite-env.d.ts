/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PARSE_APP_ID: string
  readonly VITE_PARSE_JS_KEY: string
  readonly VITE_PARSE_SERVER_URL: string
  readonly VITE_MIDDLEWARE_URL: string
  readonly VITE_GOOGLE_MAPS_API_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
