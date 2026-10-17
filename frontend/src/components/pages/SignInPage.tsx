import { LogIn } from 'lucide-react'
import Logo from '../Logo'

// Why the last sign-in was refused: the server sends the browser back with ?sign-in=<reason> (docs/adr/0004).
const reasons: Record<string, string> = {
  'not-on-team': 'You’re not on the business team yet. Ask an admin to add you on the Team page, then sign in again.',
  domain: 'Sign in with your verified @kthais.com account.',
  failed: 'Signing in didn’t work. Try again.',
}

export default function SignInPage({ reason }: { reason: string | null }) {
  const message = reason ? (reasons[reason] ?? reasons.failed) : null
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 font-sans text-gray-900">
      <main className="w-full max-w-sm rounded-xl border border-gray-200 bg-surface p-8 shadow-sm">
        <div className="flex flex-col items-center text-center">
          <Logo size={56} className="shadow-sm" />
          <h1 className="font-display mt-4 text-xl font-bold">Lucid</h1>
          <p className="text-xs font-medium text-gray-500">Corporate Outreach CRM</p>
          <p className="mt-5 text-sm text-gray-600">For the KTHAIS business team and board.</p>
        </div>
        {message && (
          <p role="alert" className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {message}
          </p>
        )}
        <a
          href="/auth/login"
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-primary-hover"
        >
          <LogIn size={16} aria-hidden /> Sign in with Google
        </a>
        <p className="mt-6 text-center text-[11px] font-medium tracking-wide text-gray-500">by KTHAIS</p>
      </main>
    </div>
  )
}
