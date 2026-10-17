import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { messageOf } from '../../format'
import { useModal } from '../../hooks'

type Props = {
  title: string
  submitLabel: string
  // Resolves once saved, and the dialog's owner closes it; if it rejects, the form stays open with the reason.
  onSubmit: () => Promise<void>
  onClose: () => void
  // Shown left of the submit button, e.g. why something can't be deleted.
  extra?: ReactNode
  // Offers deleting what the form edits, after asking again. It shares the form's busy state: while it
  // runs, nothing else in the form can, and the form can't close.
  onDelete?: () => Promise<void>
  deleteWhat?: string
  children: ReactNode
}

export const inputClass =
  'mt-1 w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-800 focus:border-indigo-300 focus:outline-none'

export default function FormDialog({ title, submitLabel, onSubmit, onClose, extra, onDelete, deleteWhat = 'it', children }: Props) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  // The dialog stays open while saving: closing it then would let a late result close a newer form.
  const close = () => {
    if (!saving) onClose()
  }
  const dialog = useRef<HTMLFormElement>(null)
  useModal(dialog, close)

  // Runs a save or delete; on success the dialog's owner closes it, on failure it stays with the reason.
  const run = async (action: () => Promise<void>) => {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      await action()
    } catch (err) {
      setError(messageOf(err))
      setSaving(false)
    }
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    void run(onSubmit)
  }

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center p-4 pt-20">
      <button type="button" aria-label={`Close ${title.toLowerCase()}`} tabIndex={-1} onClick={close} className="absolute inset-0 bg-black/30" />
      <form
        ref={dialog}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onSubmit={submit}
        className="relative max-h-[calc(100vh-6rem)] w-full max-w-sm overflow-y-auto rounded-xl border border-gray-200 bg-surface p-5 shadow-xl focus:outline-none"
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-sm font-bold text-gray-900">{title}</h2>
          <button type="button" onClick={close} aria-label="Close" className="rounded-md p-1 text-gray-400 hover:bg-gray-100">
            <X size={16} aria-hidden />
          </button>
        </div>
        <div className="mt-4 space-y-3 text-xs font-medium text-gray-600">{children}</div>
        {error && (
          <p role="alert" className="mt-4 text-xs text-red-600">
            {error}
          </p>
        )}
        <div className="mt-5 flex items-center justify-between gap-2">
          <div>
            {onDelete && !confirmingDelete && (
              <button
                type="button"
                disabled={saving}
                onClick={() => setConfirmingDelete(true)}
                className="text-xs font-semibold text-red-600 hover:text-red-800 disabled:opacity-50"
              >
                Delete
              </button>
            )}
            {onDelete && confirmingDelete && (
              <span className="flex items-center gap-2 text-xs">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void run(onDelete)}
                  className="rounded-md bg-red-600 px-2 py-1 font-semibold text-white hover:bg-danger-hover disabled:opacity-50"
                >
                  {saving ? 'Deleting…' : `Delete ${deleteWhat}`}
                </button>
                <button type="button" disabled={saving} onClick={() => setConfirmingDelete(false)} className="text-gray-500 hover:text-gray-800">
                  Keep
                </button>
              </span>
            )}
            {extra}
          </div>
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-primary-hover disabled:opacity-50"
          >
            {saving ? 'Saving…' : submitLabel}
          </button>
        </div>
      </form>
    </div>
  )
}

// A delete action that asks once more before it runs.
export function DeleteButton({ what, onDelete }: { what: string; onDelete: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)} className="text-xs font-medium text-gray-500 hover:text-red-600">
        Delete
      </button>
    )
  }
  return (
    <span className="flex flex-col gap-1">
      <span className="flex items-center gap-2 text-xs">
        <button
          type="button"
          onClick={() => onDelete().catch((err: unknown) => setError(messageOf(err)))}
          className="rounded-md bg-red-600 px-2 py-1 font-semibold text-white hover:bg-danger-hover"
        >
          Delete {what}
        </button>
        <button type="button" onClick={() => setConfirming(false)} className="text-gray-500 hover:text-gray-800">
          Keep
        </button>
      </span>
      {error && (
        <span role="alert" className="text-xs text-red-600">
          {error}
        </span>
      )}
    </span>
  )
}
