/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  /** CGOPS Platform URL — the front door; unauthenticated visits redirect here. */
  readonly VITE_CGOPS_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
