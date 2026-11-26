/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import React from 'react';
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AppBadge } from './app_badge';
import { APP_HEADER_TEST_SUBJECTS } from './test_subjects';

describe('AppBadge', () => {
  it('does not put a static text badge in the tab order', () => {
    render(<AppBadge badge={{ label: 'Beta' }} />);

    const badge = screen.getByTestId(APP_HEADER_TEST_SUBJECTS.badge);
    expect(badge).not.toHaveAttribute('tabindex');
    expect(screen.queryByRole('button', { name: 'Beta' })).not.toBeInTheDocument();
  });

  it('makes a tooltip-only badge keyboard focusable in addition to existing interactive badges', () => {
    render(
      <AppBadge
        badge={{
          label: 'System watch',
          tooltip: 'You cannot deactivate or delete a system watch.',
        }}
      />
    );

    expect(screen.getByTestId(APP_HEADER_TEST_SUBJECTS.badge)).toHaveAttribute('tabindex', '0');
  });

  it('keeps a clickable badge as a button that still fires onClick, including with a tooltip', () => {
    const onClick = jest.fn();
    render(
      <AppBadge
        badge={{
          label: 'Tech Preview',
          tooltip: 'This feature is in tech preview.',
          onClick,
          onClickAriaLabel: 'Learn more',
        }}
      />
    );

    const badge = screen.getByRole('button', { name: 'Learn more' });
    expect(badge).toBeInTheDocument();
    fireEvent.click(badge);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('keeps a menu badge as a button that still opens its menu', async () => {
    const onItemClick = jest.fn();
    render(
      <AppBadge
        badge={{
          label: 'Managed',
          tooltip: 'Managed by Elastic.',
          items: [{ name: 'View details', onClick: onItemClick }],
        }}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Click Managed badge' }));
    fireEvent.click(await screen.findByText('View details'));
    await waitFor(() => expect(onItemClick).toHaveBeenCalledTimes(1));
  });

  it('closes the menu and calls onClick when a leaf item is clicked', async () => {
    const onItemClick = jest.fn();
    render(
      <AppBadge badge={{ label: 'Enabled', items: [{ name: 'Disable', onClick: onItemClick }] }} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Click Enabled badge' }));
    fireEvent.click(await screen.findByText('Disable'));

    expect(onItemClick).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByText('Disable')).not.toBeInTheDocument());
  });

  it('keeps the menu open and shows the child panel when an item with child items is clicked', async () => {
    const onParentClick = jest.fn();
    render(
      <AppBadge
        badge={{
          label: 'Managed',
          items: [{ name: 'More', onClick: onParentClick, items: [{ name: 'Child action' }] }],
        }}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Click Managed badge' }));
    fireEvent.click(await screen.findByText('More'));

    expect(await screen.findByText('Child action')).toBeInTheDocument();
    expect(onParentClick).toHaveBeenCalledTimes(1);
  });

  it('keeps the menu open and does not call onClick when a disabled item is clicked', async () => {
    const onItemClick = jest.fn();
    render(
      <AppBadge
        badge={{
          label: 'Enabled',
          items: [{ name: 'Disable', onClick: onItemClick, disabled: true }],
        }}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Click Enabled badge' }));
    fireEvent.click(await screen.findByText('Disable'));

    expect(onItemClick).not.toHaveBeenCalled();
    expect(screen.getByText('Disable')).toBeInTheDocument();
  });

  it('renders a leaf item without onClick as inert text and keeps the menu open when clicked', async () => {
    render(<AppBadge badge={{ label: 'Managed', items: [{ name: 'Read only' }] }} />);

    fireEvent.click(screen.getByRole('button', { name: 'Click Managed badge' }));
    const item = await screen.findByText('Read only');
    expect(item.closest('button')).toBeNull();
    fireEvent.click(item);

    expect(screen.getByText('Read only')).toBeInTheDocument();
  });

  describe('when a leaf onClick returns a promise', () => {
    const renderWithPendingAction = () => {
      let settle: { resolve: () => void; reject: (error: Error) => void } | undefined;
      const onItemClick = jest.fn(
        () =>
          new Promise<void>((resolve, reject) => {
            settle = { resolve, reject };
          })
      );
      render(
        <AppBadge
          badge={{
            label: 'Enabled',
            items: [
              { name: 'Disable', onClick: onItemClick },
              { name: 'Duplicate', onClick: jest.fn() },
            ],
          }}
        />
      );
      return { onItemClick, getSettle: () => settle! };
    };

    const clickDisable = async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Click Enabled badge' }));
      fireEvent.click(await screen.findByText('Disable'));
    };

    it('keeps the menu open with a loading item and disables the items while pending', async () => {
      const { onItemClick } = renderWithPendingAction();
      await clickDisable();

      expect(onItemClick).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('progressbar')).toBeInTheDocument();
      expect(screen.getByText('Disable').closest('button')).toBeDisabled();
      expect(screen.getByText('Duplicate').closest('button')).toBeDisabled();
    });

    it('closes the menu when the promise resolves', async () => {
      const { getSettle } = renderWithPendingAction();
      await clickDisable();

      await act(async () => getSettle().resolve());

      await waitFor(() => expect(screen.queryByText('Disable')).not.toBeInTheDocument());
    });

    it('closes the menu when the promise rejects', async () => {
      const { getSettle } = renderWithPendingAction();
      await clickDisable();

      await act(async () => getSettle().reject(new Error('request failed')));

      await waitFor(() => expect(screen.queryByText('Disable')).not.toBeInTheDocument());
    });
  });
});
