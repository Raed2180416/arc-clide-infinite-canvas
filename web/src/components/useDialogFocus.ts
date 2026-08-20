import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function focusableChildren(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(element => !element.hidden && element.getAttribute('aria-hidden') !== 'true')
}

export function useDialogFocus<TDialog extends HTMLElement, TInitial extends HTMLElement>({
  open,
  dialogRef,
  initialFocusRef,
  onClose,
}: {
  open: boolean
  dialogRef: RefObject<TDialog | null>
  initialFocusRef?: RefObject<TInitial | null>
  onClose: () => void
}) {
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const restoreFocusRef = useRef(true)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return
    const dialog = dialogRef.current
    if (!dialog) return
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    restoreFocusRef.current = true
    const frame = window.requestAnimationFrame(() => {
      const initialFocus = initialFocusRef?.current
      ;(initialFocus || focusableChildren(dialog)[0] || dialog).focus()
    })
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const targets = focusableChildren(dialog)
      if (!targets.length) {
        event.preventDefault()
        dialog.focus()
        return
      }
      const first = targets[0]
      const last = targets[targets.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('keydown', onKeyDown)
      const returnFocus = returnFocusRef.current
      if (restoreFocusRef.current && returnFocus?.isConnected) {
        window.requestAnimationFrame(() => returnFocus.focus())
      }
    }
  }, [dialogRef, initialFocusRef, open])

  return { preventFocusRestore: () => { restoreFocusRef.current = false } }
}
