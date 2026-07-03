// Phase A: People Center has no standalone login — CGOPS is the front door.
// Anyone arriving without a session (or after signing out) is sent to CGOPS,
// which relaunches People Center with the SSO handoff fragment (cgopsSso.ts).

import { useEffect } from 'react'
import monogram from '../../assets/cg-monogram.svg'

const cgopsUrl = import.meta.env.VITE_CGOPS_URL

export function RedirectToCgops() {
  useEffect(() => {
    if (cgopsUrl) window.location.replace(cgopsUrl)
  }, [])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4">
      <img src={monogram} alt="CG" className="h-12 w-12" />
      {cgopsUrl ? (
        <p className="text-sm text-charcoal/50">Redirecting to CGOPS sign-in…</p>
      ) : (
        <p className="max-w-sm text-center text-sm text-danger">
          VITE_CGOPS_URL is not configured. Set it to the CGOPS Platform URL —
          People Center sign-in happens through CGOPS.
        </p>
      )}
    </div>
  )
}
