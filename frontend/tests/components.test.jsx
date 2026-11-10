import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ProgressBar, StatusLabel, StatCard } from '../src/components/ui/index.jsx';
import { PasswordChecklist } from '../src/pages/Auth.jsx';

describe('ui components', () => {
  it('renders status with an icon label, not color alone', () => {
    render(<StatusLabel status="exceeded" />);
    expect(screen.getByText('Exceeded')).toBeInTheDocument();
  });

  it('exposes progress semantics', () => {
    render(<ProgressBar value={140} status="exceeded" label="Food" />);
    const bar = screen.getByRole('progressbar', { name: 'Food' });
    expect(bar).toHaveAttribute('aria-valuenow', '140');
  });

  it('shows stat changes with direction', () => {
    render(<StatCard label="Expenses" value="$10" change={-12.5} invertChange />);
    expect(screen.getByText(/12.5%/)).toBeInTheDocument();
  });

  it('checks password rules live', () => {
    render(<PasswordChecklist password="Abcdefghij1" />);
    expect(screen.getByText(/At least 10 characters/).textContent).toContain('✓');
  });
});
