/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import React, { useCallback, useMemo, useState } from 'react';
import { EuiBadge, EuiContextMenu, EuiLoadingSpinner, EuiPopover, EuiToolTip } from '@elastic/eui';
import type {
  EuiContextMenuPanelDescriptor,
  EuiContextMenuPanelItemDescriptor,
} from '@elastic/eui';
import { css } from '@emotion/react';
import { i18n } from '@kbn/i18n';
import type { AppHeaderBadge, AppHeaderBadgeItem } from './types';
import { asOptionalPlainText, asPlainText } from './as_plain_text';
import { APP_HEADER_TEST_SUBJECTS } from './test_subjects';

interface LeafActions {
  /** Key of the leaf item whose async action is running, if any. */
  pendingKey?: string;
  runLeaf: (key: string, onClick: () => void | Promise<unknown>) => void;
}

/**
 * Recursively builds flat EuiContextMenu panels from nested badge menu items.
 */
const buildPanels = (
  items: AppHeaderBadgeItem[],
  panelId: number,
  leafActions: LeafActions,
  width?: number,
  title?: string
): EuiContextMenuPanelDescriptor[] => {
  const { pendingKey, runLeaf } = leafActions;
  const panels: EuiContextMenuPanelDescriptor[] = [];
  let nextPanelId = panelId + 1;

  const panelItems: EuiContextMenuPanelItemDescriptor[] = items.map((item, index) => {
    // Explicit fields only — do not spread the consumer item into EUI.
    const { items: childItems, popoverWidth: childWidth, onClick } = item;
    const name = asPlainText(item.name);
    const isLeaf = !childItems || childItems.length === 0;
    // Position-based key: consumers often rebuild item objects on every render.
    const key = `${panelId}.${index}`;
    const panelItem: EuiContextMenuPanelItemDescriptor = {
      name,
      icon: pendingKey === key ? <EuiLoadingSpinner size="m" /> : item.icon,
      onClick: isLeaf && onClick ? () => runLeaf(key, onClick) : onClick,
      disabled: item.disabled || pendingKey !== undefined,
      toolTipContent: asOptionalPlainText(item.toolTipContent),
      'data-test-subj': item['data-test-subj'],
    };
    if (!isLeaf) {
      const childPanelId = nextPanelId;
      const childPanels = buildPanels(childItems, childPanelId, leafActions, childWidth, name);
      nextPanelId = childPanelId + childPanels.length;
      panels.push(...childPanels);
      return { ...panelItem, panel: childPanelId };
    }

    return panelItem;
  });

  panels.unshift({
    id: panelId,
    items: panelItems,
    ...(title && { title }),
    ...(width && { width }),
  });

  return panels;
};

const useBadgeStyle = () => {
  return useMemo(() => {
    const badge = css`
      max-width: 200px;
    `;

    return { badge };
  }, []);
};

export const AppBadge = ({ badge }: { badge: AppHeaderBadge }) => {
  const { badge: badgeStyle } = useBadgeStyle();
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const label = asPlainText(badge.label);
  const tooltip = asOptionalPlainText(badge.tooltip);
  const onClickAriaLabel = asOptionalPlainText(badge.onClickAriaLabel);

  const [pendingKey, setPendingKey] = useState<string>();

  const closePopover = useCallback(() => setIsPopoverOpen(false), []);
  const togglePopover = useCallback(() => setIsPopoverOpen((open) => !open), []);

  // A leaf action that returns a promise keeps the menu open, showing progress, until it settles.
  const runLeaf = useCallback(
    (key: string, onClick: () => void | Promise<unknown>) => {
      const result = onClick();
      if (!(result instanceof Promise)) {
        closePopover();
        return;
      }
      setPendingKey(key);
      const settle = () => {
        setPendingKey(undefined);
        closePopover();
      };
      result.then(settle, settle);
    },
    [closePopover]
  );

  if (badge?.renderCustomBadge) {
    // TODO: Remove custom JSX badge rendering once apps migrate custom badges to structured config.
    return badge.renderCustomBadge({ badgeText: badge.label });
  }

  const hasItems = 'items' in badge && badge.items !== undefined;
  const isClickable = hasItems || badge.onClick !== undefined;
  const isTooltipOnly = Boolean(tooltip) && !isClickable;

  const badgeOnClickAriaLabel =
    onClickAriaLabel ??
    i18n.translate('kbnUI.appHeader.badge.ariaLabel', {
      defaultMessage: 'Click {label} badge',
      values: { label },
    });

  const handleBadgeClick = () => {
    if (hasItems) {
      togglePopover();
      return;
    }
    badge?.onClick?.();
  };

  const interactionProps = isClickable
    ? { onClick: handleBadgeClick, onClickAriaLabel: badgeOnClickAriaLabel }
    : {};

  const badgeComponent = (
    <EuiBadge
      {...interactionProps}
      color={badge?.color ?? 'hollow'}
      data-test-subj={badge?.['data-test-subj'] ?? APP_HEADER_TEST_SUBJECTS.badge}
      css={badgeStyle}
      iconType={hasItems ? 'chevronSingleDown' : undefined}
      iconSide={hasItems ? 'right' : undefined}
      tabIndex={isTooltipOnly ? 0 : undefined}
    >
      {label}
    </EuiBadge>
  );

  const wrappedBadge = tooltip ? (
    <EuiToolTip content={tooltip}>{badgeComponent}</EuiToolTip>
  ) : (
    badgeComponent
  );

  if (hasItems) {
    return (
      <EuiPopover
        button={wrappedBadge}
        isOpen={isPopoverOpen}
        closePopover={closePopover}
        panelPaddingSize="none"
        aria-label={label}
      >
        <EuiContextMenu
          initialPanelId={0}
          panels={buildPanels(badge.items!, 0, { pendingKey, runLeaf }, badge.popoverWidth)}
        />
      </EuiPopover>
    );
  }

  return wrappedBadge;
};

AppBadge.displayName = 'AppBadge';
