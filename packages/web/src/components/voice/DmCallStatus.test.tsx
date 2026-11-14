import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DmCallStatus } from './DmCallStatus';
import { joinDmCall } from '../../utils/voiceActions';

vi.mock('../../utils/voiceActions', () => ({
  canStartDmCall: () => true,
  joinDmCall: vi.fn(() => true),
}));

vi.mock('../../stores/voiceStore', () => ({
  useVoiceStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    voiceUsers: new Map([['dm', ['alice']]]),
    dmWaitingUntil: new Map([['dm', Date.now() + 125000]]),
    activeDmCall: null,
    outgoingCall: null,
    incomingCall: null,
  }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, values?: { remaining?: string }) => (values?.remaining ? `${key}:${values.remaining}` : key) }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DmCallStatus', () => {
  it('shows the countdown and rejoins on tap', () => {
    render(<DmCallStatus channelId="dm" />);
    expect(screen.getByRole('status').textContent).toContain('callWaiting:2:05');
    fireEvent.click(screen.getByRole('button', { name: 'rejoinCall' }));
    expect(joinDmCall).toHaveBeenCalledWith('dm');
  });
});
