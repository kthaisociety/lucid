import { CheckCircle2, Mail, X } from 'lucide-react'

// How the last Connect Gmail ended: the server sends the browser back with ?gmail=<outcome> (docs/adr/0006).
const outcomes: Record<string, { ok: boolean; message: string }> = {
  connected: { ok: true, message: 'Gmail connected. Emails with contacts will show on their deals.' },
  'wrong-account': { ok: false, message: 'Connect the Gmail of the account you’re signed in with.' },
  'no-access': { ok: false, message: 'Gmail wasn’t connected: allow Lucid to read your email on Google’s screen.' },
  failed: { ok: false, message: 'Connecting Gmail didn’t work. Try again.' },
}

type Props = {
  // ?gmail= from the last connect, if any
  outcome: string | null
  // Whether to ask the member to connect: they haven't yet, and haven't put it off this visit.
  ask: boolean
  // Asking again: Google no longer honours their earlier grant.
  reconnect?: boolean
  onLater: () => void
  onDismissOutcome: () => void
}

// The bar under the header: the last connect's outcome, or else the ask to connect.
export default function GmailBar({ outcome, ask, reconnect, onLater, onDismissOutcome }: Props) {
  const result = outcome ? (outcomes[outcome] ?? outcomes.failed) : null
  if (result) {
    return (
      <p
        role="status"
        className={`flex items-center justify-between gap-3 border-b px-4 py-2 text-xs md:px-6 ${
          result.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'
        }`}
      >
        <span className="flex items-center gap-2">
          {result.ok ? <CheckCircle2 size={14} aria-hidden /> : <Mail size={14} aria-hidden />}
          {result.message}
        </span>
        <button type="button" aria-label="Dismiss" onClick={onDismissOutcome} className="opacity-70 hover:opacity-100">
          <X size={14} aria-hidden />
        </button>
      </p>
    )
  }
  if (!ask) return null
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-indigo-100 bg-indigo-50 px-4 py-2 text-xs text-indigo-900 md:px-6">
      <span className="flex items-center gap-2">
        <Mail size={14} aria-hidden />
        {reconnect
          ? 'Google stopped letting Lucid read your Gmail, so emails no longer land on deals. Connect it again.'
          : 'Connect your Gmail so emails with contacts land on their deals on their own. Lucid only reads mail with a contact on it.'}
      </span>
      <span className="flex items-center gap-3">
        <button type="button" onClick={onLater} className="text-indigo-700 hover:underline">
          Later
        </button>
        <a href="/auth/gmail/connect" className="rounded-md bg-indigo-600 px-3 py-1 font-semibold text-white hover:bg-primary-hover">
          {reconnect ? 'Reconnect Gmail' : 'Connect Gmail'}
        </a>
      </span>
    </div>
  )
}
