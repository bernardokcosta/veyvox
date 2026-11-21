import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VoiceGrid } from './VoiceGrid';
import { useVoiceStore } from '../../stores/voiceStore';
import { useJunoStore } from '../../stores/junoStore';
import { setCameraSubscription, setStreamSubscription, type ParticipantInfo } from '../../hooks/useLiveKit';

vi.mock('../games/JunoTile', () => ({ JunoTile: () => <button type="button">Juno tile</button> }));
vi.mock('../games/JunoTable', () => ({ JunoTable: () => <div>Juno table</div> }));

vi.mock('../../audio/AudioManager', () => ({
  AudioManager: { getInstance: () => ({}) },
}));

vi.mock('../../hooks/useLiveKit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/useLiveKit')>();
  return {
    ...actual,
    getActiveRoom: () => null,
    setCameraSubscription: vi.fn(),
    setStreamSubscription: vi.fn(),
  };
});

function participant(identity: string, isLocal: boolean): ParticipantInfo {
  return {
    identity,
    userId: identity,
    username: identity,
    isMuted: false,
    isDeafened: false,
    isCameraOn: false,
    isScreenSharing: false,
    isLocal,
    audioTrack: null,
    videoTrack: null,
    screenTrack: null,
    screenAudioTrack: null,
    lkVideoTrack: null,
    lkScreenTrack: null,
    cachedUser: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useJunoStore.setState({ target: null, open: false });
  useVoiceStore.setState({
    focusedParticipantId: 'ada',
    hideNonVideoParticipants: false,
    currentVoiceChannelId: 'voice-1',
    isDeafened: false,
    speakingParticipantIds: new Set(),
    spaceMutedUserIds: new Set(),
    spaceDeafenedUserIds: new Set(),
    permissionMutedUserIds: new Set(),
    unwatchedCameras: new Set(),
    participantMutes: new Map(),
  });
});

describe('VoiceGrid participant strip', () => {
  it('can show the participant strip again after hiding it', async () => {
    render(<VoiceGrid participants={[participant('ada', true), participant('bob', false)]} />);

    await userEvent.click(screen.getByText(/hide members/i));
    expect(screen.getByText(/show members/i)).toBeInTheDocument();

    await userEvent.click(screen.getByText(/show members/i));
    expect(screen.getByText(/hide members/i)).toBeInTheDocument();
  });

  it('collapses fullscreen camera focus by default and keeps the idle toggle keyboard operable', async () => {
    const props = { participants: [{ ...participant('ada', true), isCameraOn: true }, participant('bob', false)] };
    const { rerender } = render(<VoiceGrid {...props} fullscreen />);
    expect(screen.queryByText('bob')).not.toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: /show members/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle.closest('[data-voice-chrome]')).toHaveClass('focus-within:opacity-100');
    await userEvent.tab();
    expect(screen.getByRole('button', { name: /grid/i })).toHaveFocus();
    await userEvent.tab();
    expect(toggle).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByText('bob')).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    rerender(<VoiceGrid {...props} />);
    expect(screen.queryByRole('button', { name: /hide members/i })?.closest('[data-voice-chrome]')).toBeNull();
    rerender(<VoiceGrid {...props} fullscreen />);
    expect(screen.queryByText('bob')).not.toBeInTheDocument();
  });

  it('keeps a pending focused share watchable while fullscreen chrome is idle', () => {
    useVoiceStore.setState({ focusedParticipantId: 'bob:stream' });
    render(<VoiceGrid fullscreen participants={[participant('ada', true), { ...participant('bob', false), isScreenSharing: true }]} />);
    expect(screen.getByRole('button', { name: /watch stream/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /show members/i })).toBeInTheDocument();
  });
});

describe('VoiceGrid video-only display', () => {
  it('keeps pending shares, enabled cameras and Juno, without changing subscriptions', () => {
    useVoiceStore.setState({ hideNonVideoParticipants: true, focusedParticipantId: null, unwatchedCameras: new Set(['hidden']) });
    const target = { userId: 'ada', channelId: 'voice-1', origin: window.location.origin };
    useJunoStore.setState({ target, open: true });
    render(<VoiceGrid fullscreen participants={[
      participant('ada', true),
      { ...participant('hidden', false), isCameraOn: true },
      { ...participant('camera', false), isCameraOn: true },
      { ...participant('sharer', false), isScreenSharing: true },
    ]} />);

    expect(screen.getByText('Juno table').closest('.juno-focus-layout')).not.toBeNull();
    expect(screen.getByRole('button', { name: /hide members/i })).toBeInTheDocument();
    expect(screen.getByText('camera')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /watch stream/i })).toBeInTheDocument();
    expect(screen.queryByText('ada')).not.toBeInTheDocument();
    expect(screen.queryByText('hidden')).not.toBeInTheDocument();
    expect(setCameraSubscription).not.toHaveBeenCalled();
    expect(setStreamSubscription).not.toHaveBeenCalled();
  });

  it('clears a filtered focus, and showing everyone does not restore it', async () => {
    render(<VoiceGrid participants={[participant('ada', true), participant('bob', false)]} />);
    act(() => useVoiceStore.setState({ hideNonVideoParticipants: true }));
    expect(screen.getByText(/no cameras or screen shares/i)).toBeInTheDocument();
    expect(useVoiceStore.getState().focusedParticipantId).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /show all participants/i }));
    expect(screen.getByText('bob')).toBeInTheDocument();
    expect(useVoiceStore.getState().focusedParticipantId).toBeNull();
  });
});
