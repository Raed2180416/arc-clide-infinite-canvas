import type { SourceRef } from '../types'

type EvidenceRef = SourceRef & { role?: string }

export function SourceRefs({ refs, label = 'Source evidence' }: { refs?: ReadonlyArray<EvidenceRef>; label?: string }) {
  if (!refs?.length) return null
  return <details className="source-refs"><summary>{label} ({refs.length.toLocaleString()})</summary><ol>{refs.map((ref, index) => <li key={`${ref.path}:${ref.line}:${index}`}><code>{ref.path}:{ref.line}</code>{ref.role && <span>{ref.role.replaceAll('-', ' ')}</span>}</li>)}</ol></details>
}
