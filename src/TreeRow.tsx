import { memo } from 'react'
import Checkbox from '@mui/material/Checkbox'
import type { ReactNode } from 'react'
import type { TreeNodeMeta } from './types'

/**
 * Static object: an inline literal would hand MUI fresh slot props on every row
 * of every render. The input is inert — the delegated click handler on the
 * scroll container owns the interaction — so it is read-only and out of the tab
 * order, and the row itself carries the aria state.
 */
const CHECKBOX_SLOT_PROPS = {
  input: { readOnly: true, tabIndex: -1, 'aria-hidden': true },
} as const

export interface TreeRowProps<T = unknown> {
  meta: TreeNodeMeta<T>
  top: number
  rowHeight: number
  /** Labels wrap and the row grows: `rowHeight` becomes a minimum, not a size. */
  wrap: boolean
  indent: number
  showCheckbox: boolean
  showDeepButtons: boolean
  showBadge: boolean
  className?: string
  renderLabel?: (meta: TreeNodeMeta<T>) => ReactNode
  renderIcon?: (meta: TreeNodeMeta<T>) => ReactNode
  renderTrailing?: (meta: TreeNodeMeta<T>) => ReactNode
  renderBadge?: (count: number, meta: TreeNodeMeta<T>) => ReactNode
}

const CHEVRON = (
  <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
    <path
      d="M6 3.5 10.5 8 6 12.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

/** Deep expand: the single caret doubled, pointing the way it opens. */
const CHEVRONS_RIGHT = (
  <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
    <path
      d="M3.5 4 7.5 8 3.5 12M8.5 4 12.5 8 8.5 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

/** Deep collapse: the same pair, mirrored. */
const CHEVRONS_LEFT = (
  <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
    <path
      d="M12.5 4 8.5 8 12.5 12M7.5 4 3.5 8 7.5 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

/**
 * A single row. Deliberately handler-free: every interaction is picked up by a
 * delegated listener on the scroll container, so rendering a row costs nothing
 * but markup and no closures are allocated per node.
 */
function TreeRowInner<T>(props: TreeRowProps<T>) {
  const { meta, top, rowHeight, wrap, indent, showCheckbox, showDeepButtons, className } = props
  const { depth, expanded, checkState, disabled, hasChildren, highlighted, active } = meta
  const badgeCount = props.showBadge ? meta.selectedDescendantCount : 0

  let rowClass = 'trt-row'
  if (highlighted) rowClass += ' trt-row--highlight'
  if (active) rowClass += ' trt-row--active'
  if (disabled) rowClass += ' trt-row--disabled'
  if (checkState === 1) rowClass += ' trt-row--checked'
  if (className) rowClass += ' ' + className

  const label = props.renderLabel ? props.renderLabel(meta) : (meta.node.label ?? String(meta.id))

  // In wrap mode the row is measured after layout, so rowHeight is only a floor.
  const transform = `translateY(${top}px)`
  const style = wrap ? { minHeight: rowHeight, transform } : { height: rowHeight, transform }

  return (
    <div
      className={rowClass}
      style={style}
      data-trt-index={meta.index}
      role="treeitem"
      aria-level={depth + 1}
      aria-expanded={hasChildren ? expanded : undefined}
      aria-checked={showCheckbox ? (checkState === 2 ? 'mixed' : checkState === 1) : undefined}
      aria-disabled={disabled || undefined}
      aria-selected={active || undefined}
    >
      <span className="trt-indent" style={{ width: depth * indent }} />

      {hasChildren ? (
        <span
          className={'trt-caret' + (expanded ? ' trt-caret--open' : '')}
          data-trt-action="toggle"
          role="button"
          aria-hidden="true"
        >
          {CHEVRON}
        </span>
      ) : (
        <span className="trt-caret trt-caret--empty" />
      )}

      {showCheckbox ? (
        <span className="trt-check" data-trt-action="check">
          <Checkbox
            size="small"
            disableRipple
            checked={checkState === 1}
            indeterminate={checkState === 2}
            disabled={disabled}
            tabIndex={-1}
            slotProps={CHECKBOX_SLOT_PROPS}
          />
        </span>
      ) : null}

      {props.renderIcon ? <span className="trt-icon">{props.renderIcon(meta)}</span> : null}

      <span className="trt-label" data-trt-action="label">
        {label}
      </span>

      {badgeCount > 0 ? (
        <span className="trt-badge-slot">
          {props.renderBadge ? (
            props.renderBadge(badgeCount, meta)
          ) : (
            <span
              className="trt-badge"
              title={`${badgeCount} selected inside`}
              aria-label={`${badgeCount} selected inside`}
            >
              {badgeCount}
            </span>
          )}
        </span>
      ) : null}

      {/*
       * After the label: the pair is always in the layout for a node with
       * children (only its opacity changes on hover), so revealing it never
       * reflows the label or re-measures the row.
       */}
      {showDeepButtons && hasChildren ? (
        <span className="trt-deep">
          <span
            className="trt-btn"
            data-trt-action="collapse-deep"
            role="button"
            title="Collapse this node and every descendant"
            aria-label="Collapse all descendants"
          >
            {CHEVRONS_LEFT}
          </span>
          <span
            className="trt-btn"
            data-trt-action="expand-deep"
            role="button"
            title="Expand this node and every descendant"
            aria-label="Expand all descendants"
          >
            {CHEVRONS_RIGHT}
          </span>
        </span>
      ) : null}

      <span className="trt-spacer" />

      {props.renderTrailing ? (
        <span className="trt-trailing">{props.renderTrailing(meta)}</span>
      ) : null}
    </div>
  )
}

export const TreeRow = memo(TreeRowInner) as typeof TreeRowInner
