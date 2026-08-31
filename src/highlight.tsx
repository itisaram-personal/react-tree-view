import type { ReactNode } from 'react'

/**
 * Wraps every occurrence of `query` inside `text` in a `<mark>`, so a filtered
 * row can show *which* part of its label matched: label "ABCD" with query "BC"
 * renders `A<mark>BC</mark>D`.
 *
 * Matching is case-insensitive and mirrors the built-in string `filter`
 * (`includes`), so the marks always land where the filter found its match.
 * Anything that is not a plain string — a `ReactNode` label, an element from
 * `renderLabel` — comes back untouched, as does text with no match: the common
 * path allocates nothing.
 */
export function highlightMatches(
  text: ReactNode,
  query: string,
  className = 'trt-mark',
): ReactNode {
  if (typeof text !== 'string' || text === '') return text
  const needle = query.trim().toLowerCase()
  if (needle === '') return text

  const haystack = text.toLowerCase()
  // Lowercasing is per-character for every alphabet the filter can match, but a
  // few (Turkish 'İ', for one) grow a character and would knock every slice
  // below out of step. Not worth mapping back: the label renders unmarked.
  if (haystack.length !== text.length) return text

  let at = haystack.indexOf(needle)
  if (at < 0) return text

  const parts: ReactNode[] = []
  let from = 0
  let key = 0
  while (at >= 0) {
    if (at > from) parts.push(text.slice(from, at))
    parts.push(
      <mark key={key++} className={className}>
        {text.slice(at, at + needle.length)}
      </mark>,
    )
    from = at + needle.length
    at = haystack.indexOf(needle, from)
  }
  if (from < text.length) parts.push(text.slice(from))
  return parts
}
