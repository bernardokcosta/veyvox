import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { JunoStackOverlay } from './JunoStackOverlay';

describe('neon stack overlay', () => {
  it('renders plus and digit tiles with an accessible pending total', () => {
    const { container } = render(<JunoStackOverlay amount={4} />);
    expect(screen.getByRole('status')).toHaveAccessibleName('+4 to draw');
    const tiles = container.querySelectorAll('img');
    expect([...tiles].map(img => img.getAttribute('src'))).toEqual([
      '/games/juno/ui/stack-plus.webp', '/games/juno/ui/stack-4.webp',
    ]);
    for (const img of tiles) expect(img).toHaveAttribute('alt', '');
  });
  it('composes multi-digit piles digit by digit', () => {
    const { container } = render(<JunoStackOverlay amount={30} />);
    expect(screen.getByRole('status')).toHaveAccessibleName('+30 to draw');
    expect([...container.querySelectorAll('img')].map(img => img.getAttribute('src'))).toEqual([
      '/games/juno/ui/stack-plus.webp', '/games/juno/ui/stack-3.webp', '/games/juno/ui/stack-0.webp',
    ]);
  });
});
