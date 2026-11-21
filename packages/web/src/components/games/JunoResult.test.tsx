import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useJunoStore } from '../../stores/junoStore';
import { JunoResult } from './JunoResult';
import { junoGame, junoUser } from './junoTestFixtures';
vi.mock('../../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({}) } }));
beforeEach(() => {
  useJunoStore.getState().reset();
  const game = junoGame('finished'); game.winnerId = 'a'; game.result = 'emptyHand';
  game.scoreboard = { roundId: game.id, status: 'credited', standings: game.players.map((p, i) => ({
    ...p, place: i === 0 ? 1 : 2, cardCount: i === 0 ? 0 : 7, xp: i === 0 ? 120 : 80, outcome: 'completed',
  })) };
  useJunoStore.setState({ target: { userId: 'a', origin: window.location.origin, channelId: 'voice' },
    connected: true, snapshot: { revision: 1, game }, command: vi.fn(async () => {}) });
});
describe('Juno authoritative result view', () => {
  it.each(['playersLeft', 'stalemate', 'expired'] as const)('shows a neutral %s outcome without a crown or invented XP', result => {
    const game = junoGame('finished'); game.result = result;
    game.scoreboard = { roundId: game.id, status: 'unranked', standings: game.players.map(p => ({ ...p, place: null, xp: 0, outcome: 'unranked' })) };
    useJunoStore.setState({ snapshot: { revision: 2, game } });
    const { container } = render(<JunoResult />);
    expect(container.querySelector('.juno-crown')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Round results' })).toBeInTheDocument();
    expect(screen.getAllByText('No XP this round')).toHaveLength(2);
    expect(screen.queryByText(/XP earned/)).not.toBeInTheDocument();
  });
  it('shows actual awards and victory only for the winner', () => {
    render(<JunoResult />); expect(screen.getByRole('heading', { name: 'Victory!' })).toBeInTheDocument();
    expect(screen.getByText('+120 XP earned')).toBeInTheDocument();
    expect(screen.getByText('+80 XP earned')).toBeInTheDocument();
  });
  it('names the winning team and celebrates with its members on a duo victory', () => {
    const game = junoGame('finished');
    game.mode = 'duo';
    game.teams = { a: ['a', 'b'], b: ['c', 'd'] };
    game.players.push({ userId: 'c', name: 'Cy', cardCount: 4, announced: false, user: junoUser('c') },
      { userId: 'd', name: 'Dee', cardCount: 9, announced: false, user: junoUser('d') });
    game.winnerId = 'a'; game.result = 'emptyHand';
    game.scoreboard = { roundId: game.id, status: 'credited', standings: [
      { userId: 'a', name: 'Ada', user: junoUser('a'), cardCount: 0, xp: 137, place: 1, outcome: 'completed', team: 1 },
      { userId: 'b', name: 'Bo', user: junoUser('b'), cardCount: 5, xp: 137, place: 1, outcome: 'completed', team: 1 },
      { userId: 'c', name: 'Cy', user: junoUser('c'), cardCount: 4, xp: 94, place: 2, outcome: 'completed', team: 2 },
      { userId: 'd', name: 'Dee', user: junoUser('d'), cardCount: 9, xp: 93, place: 2, outcome: 'completed', team: 2 },
    ] };
    useJunoStore.setState({ snapshot: { revision: 2, game } });
    const { container } = render(<JunoResult />);
    expect(screen.getByRole('heading', { name: 'Victory!' })).toBeInTheDocument();
    expect(screen.getByText('Team A wins!')).toBeInTheDocument();
    expect(container.querySelectorAll('.juno-team-a')).toHaveLength(2);
    expect(container.querySelectorAll('.juno-team-b')).toHaveLength(2);
    expect(screen.getAllByLabelText('Position').map(position => position.textContent)).toEqual(['1', '1', '2', '2']);
    act(() => useJunoStore.setState({ target: { userId: 'b', origin: window.location.origin, channelId: 'voice' } }));
    expect(screen.getByRole('heading', { name: 'Victory!' })).toBeInTheDocument();
    act(() => useJunoStore.setState({ snapshot: { revision: 3, game: { ...game,
      players: game.players.filter(p => p.userId !== 'b'),
      scoreboard: { ...game.scoreboard!, standings: game.scoreboard!.standings.map(row => row.userId === 'b'
        ? { ...row, place: null, xp: 0, cardCount: null, outcome: 'abandoned' }
        : row) },
    } } }));
    expect(screen.getByRole('heading', { name: 'Round results' })).toBeInTheDocument();
    expect(screen.getByText('Team A wins!')).toBeInTheDocument();
  });
  it('does not claim personal victory for a loser or allow their rematch', () => {
    useJunoStore.setState({ target: { userId: 'b', origin: window.location.origin, channelId: 'voice' } });
    render(<JunoResult />); expect(screen.queryByRole('heading', { name: 'Victory!' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /open a new lobby/i })).not.toBeInTheDocument();
  });
  it('shows pending without confirmed earned XP or an enabled rematch', () => {
    const snapshot = useJunoStore.getState().snapshot!;
    useJunoStore.setState({ snapshot: { ...snapshot, game: { ...snapshot.game!, scoreboard: { ...snapshot.game!.scoreboard!, status: 'pending' } } } });
    render(<JunoResult />); expect(screen.getByText(/saving this round/i)).toBeInTheDocument();
    expect(screen.queryByText('+120 XP earned')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open a new lobby/i })).toBeDisabled();
  });
  it('supports old hosts without inventing a scoreboard', () => {
    const game = { ...junoGame('finished'), winnerId: 'b', result: 'emptyHand' as const };
    useJunoStore.setState({ snapshot: { revision: 2, game } }); render(<JunoResult />);
    expect(screen.queryByText(/XP earned/)).not.toBeInTheDocument(); expect(screen.getByText('Bo wins!')).toBeInTheDocument();
  });
  it('labels computer results as practice rather than earned XP', () => {
    const snapshot = useJunoStore.getState().snapshot!;
    const game = { ...snapshot.game!, practice: true };
    game.scoreboard = { ...game.scoreboard!, status: 'unranked', standings: game.scoreboard!.standings.map(p => ({ ...p, xp: 0 })) };
    useJunoStore.setState({ snapshot: { ...snapshot, game } }); render(<JunoResult />);
    expect(screen.getAllByText('Practice')).toHaveLength(2);
    expect(screen.queryByText(/XP earned/)).not.toBeInTheDocument();
  });
});
