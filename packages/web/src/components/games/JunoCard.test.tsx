import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { JunoCard } from './JunoCard';
describe('Juno supplied card artwork', () => {
  it('keeps flour on the same card through hand/discard renders without exposing its opaque ID', () => {
    const card = { id: 'secret-id', color: 'mint' as const, face: '2' as const, floured: true };
    const { container, rerender } = render(<JunoCard card={card} />);
    expect(container.querySelector('.juno-card-art > .juno-card-flour')).toHaveAttribute('src', '/games/juno/ui/flour.webp');
    expect(container.querySelector('.juno-card-face')).toHaveAttribute('src', '/games/juno/cards/mint-2.webp');
    rerender(<div className="juno-discard"><JunoCard card={{ ...card }} /></div>);
    expect(container.querySelector('.juno-discard .juno-card-flour')).toBeInTheDocument();
    expect(container.innerHTML).not.toContain('secret-id');
    rerender(<JunoCard card={{ ...card, floured: false }} />);
    expect(container.querySelector('.juno-card-flour')).toBeNull();
  });
  it('can decorate a representative public back without a hidden face or ID', () => {
    const { container } = render(<JunoCard back floured />);
    expect(container.querySelector('.juno-card-face')).toHaveAttribute('src', '/games/juno/cards/back.webp');
    expect(container.querySelector('.juno-card-flour')).toBeInTheDocument();
  });
  it('renders an original face with decorative semantics and original dimensions', () => {
    const { container } = render(<JunoCard card={{ id: 'secret-id', color: 'mint', face: '2' }} />);
    const image = container.querySelector('img');
    expect(image).toHaveAttribute('src', '/games/juno/cards/mint-2.webp');
    expect(image).toHaveAttribute('alt', ''); expect(image).toHaveAttribute('width', '720');
    expect(image).toHaveAttribute('height', '1056'); expect(container.innerHTML).not.toContain('secret-id');
    expect(image).toHaveAttribute('srcset', '/games/juno/compact/cards/mint-2.webp 288w, /games/juno/cards/mint-2.webp 720w');
    expect(image).toHaveAttribute('sizes', '96px');
  });
  it('renders only the original back even if supplied with a private card', () => {
    const { container } = render(<JunoCard back card={{ id: 'hidden-id', color: 'coral', face: '9' }} />);
    expect(container.querySelector('img')).toHaveAttribute('src', '/games/juno/cards/back.webp');
    expect(container.querySelector('img')).toHaveAttribute('srcset', '/games/juno/compact/cards/back.webp 288w, /games/juno/cards/back.webp 720w');
    expect(container.innerHTML).not.toMatch(/hidden-id|coral|face=/);
  });
  it('keeps the full original flour while offering a compact version at the same displayed size', () => {
    const { container } = render(<JunoCard back floured />);
    const flour = container.querySelector('.juno-card-flour');
    expect(flour).toHaveAttribute('src', '/games/juno/ui/flour.webp');
    expect(flour).toHaveAttribute('srcset', '/games/juno/compact/ui/flour.webp 288w, /games/juno/ui/flour.webp 720w');
    expect(flour).toHaveAttribute('sizes', '96px');
  });
});
