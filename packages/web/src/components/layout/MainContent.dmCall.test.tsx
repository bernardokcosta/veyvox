import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub AudioManager to avoid AudioWorkletNode reference error in jsdom.
vi.mock('../../audio/AudioManager', () => ({
  AudioManager: {
    getInstance: vi.fn().mockReturnValue({
      setOutputDevice: vi.fn(),
      setVolume: vi.fn(),
      clearInputDenial: vi.fn(),
      resumeContext: vi.fn(() => Promise.resolve()),
      setInputDevice: vi.fn(() => Promise.resolve(null)),
      releaseInputStream: vi.fn(),
      hasVoiceSession: () => false,
    }),
  },
}));
vi.mock('../../hooks/useWebSocket', () => ({ wsSend: vi.fn(() => true) }));
// The DM header is under test; the message surfaces have their own tests.
vi.mock('../chat/MessageList', () => ({ MessageList: () => null }));
vi.mock('../chat/MessageInput', () => ({ MessageInput: () => null }));

import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Channel, DmChannel, User } from '@veyvox/shared';
import type { ParticipantInfo } from '../../hooks/useLiveKit';
import { useAuthStore } from '../../stores/authStore';
import { useChatStore } from '../../stores/chatStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { useUIStore } from '../../stores/uiStore';
import { useVoiceStore } from '../../stores/voiceStore';
import { wsSend } from '../../hooks/useWebSocket';
import { MainContent } from './MainContent';

const partner = { id: 'partner', username: 'alice' } as User;
const dm = { id: 'dm-1', members: [partner], ownerId: null } as DmChannel;

function renderDm(pathname = `/channels/@me/${dm.id}`) {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <MainContent />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ user: { id: 'self', username: 'self' } as User });
  useChatStore.setState({ currentChannelId: dm.id });
  useSpaceStore.setState({ currentSpaceId: null, channels: [], dmChannels: [dm] });
  useUIStore.setState({ showDms: true, voiceFullscreen: false });
  useVoiceStore.setState({
    outgoingCall: null, activeDmCall: null, incomingCall: null, voiceUsers: new Map(), connectFn: null,
    currentVoiceChannelId: null, participants: [], focusedParticipantId: null, hideNonVideoParticipants: false,
  });
});

it.each(['dm', 'space'])('uses focused fullscreen chrome on the desktop %s call surface', (surface) => {
  const camera: ParticipantInfo = {
    identity: 'partner', userId: 'partner', username: 'alice',
    isMuted: false, isDeafened: false, isCameraOn: true, isScreenSharing: false, isLocal: false,
    audioTrack: null, videoTrack: null, screenTrack: null, screenAudioTrack: null,
    lkVideoTrack: null, lkScreenTrack: null, cachedUser: partner,
  };
  useUIStore.setState({ voiceFullscreen: true });
  useVoiceStore.setState({
    participants: [camera, { ...camera, identity: 'self', userId: 'self', username: 'self', cachedUser: null, isLocal: true, isCameraOn: false }],
    focusedParticipantId: camera.identity,
  });
  if (surface === 'dm') {
    useVoiceStore.setState({ activeDmCall: { dmChannelId: dm.id } });
    renderDm();
  } else {
    const channel = { id: 'voice', name: 'General', type: 'voice' } as Channel;
    useUIStore.setState({ showDms: false });
    useSpaceStore.setState({ currentSpaceId: 'space', channels: [channel] });
    useChatStore.setState({ currentChannelId: channel.id });
    useVoiceStore.setState({ currentVoiceChannelId: channel.id });
    renderDm('/channels/space/voice');
  }
  expect(screen.getByRole('button', { name: /show members/i }).closest('[data-voice-chrome]')).toHaveClass('opacity-100');
  expect(screen.getByRole('button', { name: /grid/i }).closest('[data-voice-chrome]')).toHaveClass('opacity-100');
});

describe('desktop DM header call actions', () => {
  it('starts a native DM call through the current socket', () => {
    renderDm();
    fireEvent.click(screen.getByTitle('Start Voice Call'));
    expect(useVoiceStore.getState().outgoingCall).toEqual({ dmChannelId: dm.id, withCamera: false });
    expect(wsSend).toHaveBeenCalledWith({ type: 'dm_call_start', dmChannelId: dm.id });
  });

  it('starts a video call: the same call, with the camera to go on once connected', () => {
    renderDm();
    fireEvent.click(screen.getByTitle('Start Video Call'));
    expect(useVoiceStore.getState().outgoingCall).toEqual({ dmChannelId: dm.id, withCamera: true });
    expect(wsSend).toHaveBeenCalledWith({ type: 'dm_call_start', dmChannelId: dm.id });
  });

  it('offers no call in a 1-on-1 whose partner was deleted', () => {
    useSpaceStore.setState({ dmChannels: [{ ...dm, members: [{ ...partner, isDeleted: true }] } as DmChannel] });
    renderDm();
    expect(screen.queryByTitle('Start Voice Call')).toBeNull();
    expect(screen.queryByTitle('Start Video Call')).toBeNull();
  });

  it('cannot start a second call while an incoming call rings', () => {
    useVoiceStore.setState({ incomingCall: { dmChannelId: 'other', callerId: 'bob', callerName: 'Bob' } });
    renderDm();
    const button = screen.getByTitle('Start Voice Call');
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(wsSend).not.toHaveBeenCalled();
    expect(useVoiceStore.getState().outgoingCall).toBeNull();
  });

  it('cancels a ringing native DM call', () => {
    useVoiceStore.setState({ outgoingCall: { dmChannelId: dm.id, withCamera: false } });
    renderDm();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(useVoiceStore.getState().outgoingCall).toBeNull();
    expect(wsSend).toHaveBeenCalledWith(
      { type: 'dm_call_end', dmChannelId: dm.id },
    );
  });

  it('joins the call already running in the DM instead of starting one', () => {
    const connectFn = vi.fn().mockResolvedValue(undefined);
    useVoiceStore.setState({ voiceUsers: new Map([[dm.id, ['partner']]]), connectFn });
    renderDm();
    // The voice and video buttons both join; the voice one comes first.
    fireEvent.click(screen.getAllByTitle('Join Call')[0]!);
    expect(useVoiceStore.getState().outgoingCall).toBeNull();
    expect(useVoiceStore.getState().activeDmCall).toEqual({ dmChannelId: dm.id });
    expect(wsSend).toHaveBeenCalledWith({ type: 'dm_call_accept', dmChannelId: dm.id });
    expect(wsSend).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'dm_call_start' }));
    expect(connectFn).toHaveBeenCalledWith(dm.id, true);
  });
});
