/**
 * The record workspace header owns the back and refresh controls, so record
 * screens cannot reintroduce their own duplicates.
 */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BnRecordWorkspaceHeader, BnRecordBackLink } from '@/components/bn/ux';

describe('BnRecordWorkspaceHeader controls', () => {
  it('renders exactly one back control and no refresh when none is provided', () => {
    render(<BnRecordWorkspaceHeader backLabel="Work queue" onBack={() => {}} reference="MT-2026-0001" />);
    expect(screen.getAllByTestId('bn-record-back')).toHaveLength(1);
    expect(screen.queryByTestId('bn-record-refresh')).toBeNull();
  });

  it('renders one standard refresh control that reports its pending state', () => {
    const onRefresh = vi.fn();
    const { rerender } = render(
      <BnRecordWorkspaceHeader
        backLabel="Work queue"
        onBack={() => {}}
        reference="MT-2026-0001"
        onRefresh={onRefresh}
      />,
    );
    const refresh = screen.getByTestId('bn-record-refresh');
    fireEvent.click(refresh);
    expect(onRefresh).toHaveBeenCalledTimes(1);

    rerender(
      <BnRecordWorkspaceHeader
        backLabel="Work queue"
        onBack={() => {}}
        reference="MT-2026-0001"
        onRefresh={onRefresh}
        refreshing
      />,
    );
    expect(screen.getByTestId('bn-record-refresh')).toBeDisabled();
  });

  it('shares the same back control with pre-header loading states', () => {
    const onBack = vi.fn();
    render(<BnRecordBackLink label="Overpayment worklist" onBack={onBack} />);
    fireEvent.click(screen.getByTestId('bn-record-back'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
