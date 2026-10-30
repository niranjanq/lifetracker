import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button, Toggle, Segmented, Chip, EmptyState, ConfirmDialog, Field, Progress } from './primitives';

describe('Button', () => {
  it('renders its label and fires onClick', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not fire when disabled', async () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>Nope</Button>);
    await userEvent.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('Toggle', () => {
  it('reports the new checked state', async () => {
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} label="Roast mode" />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Roast mode' }));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe('Segmented', () => {
  it('exposes a radiogroup and selects an option', async () => {
    const onChange = vi.fn();
    render(
      <Segmented
        ariaLabel="Intensity"
        value="mild"
        onChange={onChange}
        options={[{ value: 'mild', label: 'Mild' }, { value: 'savage', label: 'Savage' }]}
      />,
    );
    const group = screen.getByRole('radiogroup', { name: 'Intensity' });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Mild' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(screen.getByRole('radio', { name: 'Savage' }));
    expect(onChange).toHaveBeenCalledWith('savage');
  });
});

describe('Field & Progress & Chip & EmptyState', () => {
  it('links the label to its control and shows errors', () => {
    render(
      <Field label="Amount" htmlFor="amt" error="Enter an amount">
        <input id="amt" />
      </Field>,
    );
    expect(screen.getByLabelText('Amount')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Enter an amount');
  });

  it('renders a progressbar with clamped aria value', () => {
    render(<Progress value={140} label="budget" />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '140');
  });

  it('renders chips and empty states', () => {
    render(<Chip tone="lime">essential</Chip>);
    render(<EmptyState title="No data" description="Add something" />);
    expect(screen.getByText('essential')).toBeInTheDocument();
    expect(screen.getByText('No data')).toBeInTheDocument();
    expect(screen.getByText('Add something')).toBeInTheDocument();
  });
});

describe('ConfirmDialog', () => {
  it('is absent when closed, confirms and cancels when open', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const { rerender } = render(
      <ConfirmDialog open={false} title="Delete?" message="Sure?" onConfirm={onConfirm} onCancel={onCancel} />,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    rerender(
      <ConfirmDialog open title="Delete?" message="This cannot be undone" confirmLabel="Delete" onConfirm={onConfirm} onCancel={onCancel} />,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
