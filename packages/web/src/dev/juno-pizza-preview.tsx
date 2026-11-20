// Standalone development workbench, not imported by the app or production build.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import type { JunoAction, JunoSnapshot } from '@veyvox/shared/src/juno';
import { JunoTable } from '../components/games/JunoTable';
import { JunoSounds } from '../components/games/JunoSounds';
import { useJunoStore } from '../stores/junoStore';
import { useSpaceStore } from '../stores/spaceStore';
import { useVoiceStore } from '../stores/voiceStore';
import { initI18n } from '../i18n';
import { initializeInterfaceScale } from '../platform/interfaceScale';
import '../styles/globals.css';

const endpoint = 'http://127.0.0.1:39998';
const spectator = new URLSearchParams(location.search).has('spectator');
const target = { origin: location.origin, channelId: 'preview', userId: spectator ? 'preview-spectator' : 'preview-player' };
let generation = 0, reading = false;
async function request(path: string, body?: object): Promise<JunoSnapshot> {
  const response = await fetch(endpoint + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  if (!response.ok) throw new Error((await response.json() as { error?: string }).error ?? `HTTP ${response.status}`);
  return response.json() as Promise<JunoSnapshot>;
}
function accept(snapshot: JunoSnapshot) {
  if (snapshot.revision >= (useJunoStore.getState().snapshot?.revision ?? -1)) {
    useJunoStore.setState({ snapshot, observedAt: Date.now(), stale: false, error: null });
  }
}
async function read() {
  if (reading) return;
  reading = true;
  const run = generation;
  try { const view = await request(`/snapshot${spectator ? '?viewer=spectator' : ''}`); if (run === generation) accept(view); }
  catch (error) { if (run === generation) useJunoStore.setState({ error, stale: true }); }
  finally { reading = false; }
}
async function command(action: JunoAction | { type: 'create' }) {
  const state = useJunoStore.getState();
  const run = generation;
  if (spectator || state.pending || !state.snapshot?.game) return;
  if (action.type === 'create' || action.type === 'rematch' || action.type === 'start' || action.type === 'addBot' || action.type === 'removeBot') return;
  state.playFeedback?.('select');
  useJunoStore.setState({ pending: true, error: null });
  try {
    const view = await request('/action', { ...action, gameId: state.snapshot.game.id, revision: state.snapshot.revision });
    if (run === generation) accept(view);
  } catch (error) { if (run === generation) { useJunoStore.setState({ error }); await read(); } }
  finally { if (run === generation) useJunoStore.setState({ pending: false }); }
}
async function reset(players: number) {
  generation++;
  const view = await request('/reset', { players });
  useJunoStore.setState({ snapshot: null, pending: false });
  if (spectator) await read(); else accept(view);
}
function Preview() {
  const [players, setPlayers] = useState(4), [resetting, setResetting] = useState(false);
  return <main className="mx-auto flex h-dvh max-w-[1200px] flex-col gap-3 p-3">
    <header className="flex flex-wrap items-center gap-3">
      <strong>Pizza Maluca — preview local</strong>
      <label>Jogadores <select className="input-standard ml-2" value={players} disabled={resetting} onChange={event => setPlayers(Number(event.target.value))}>
        {[2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{n}</option>)}
      </select></label>
      <button className="glass rounded-lg px-3 py-2" disabled={resetting} onClick={() => {
        setResetting(true); void reset(players).catch(error => useJunoStore.setState({ error })).finally(() => setResetting(false));
      }}>Recomeçar com Pizza</button>
      <a className="text-accent-primary underline" href={spectator ? '/dev-juno-pizza.html' : '/dev-juno-pizza.html?spectator=1'} target="_blank" rel="noreferrer">
        {spectator ? 'Abrir jogador' : 'Abrir visão de espectador'}
      </a>
      <small>Motor e bots reais; sem conta, dados salvos ou XP. A Pizza começa na sua mão.</small>
    </header>
    <div className="min-h-0 flex-1"><JunoTable /></div>
    <JunoSounds target={target} connected />
  </main>;
}
async function start() {
  if (!import.meta.env.DEV) throw new Error('Development preview only');
  initializeInterfaceScale(); await initI18n();
  useJunoStore.setState({ target, connected: true, supported: true, command, open: true });
  useSpaceStore.setState({ spaceChannelIndex: new Map([['preview', { spaceId: 'preview', type: 'voice' }]]) });
  useVoiceStore.setState({ isLiveKitConnected: true, voiceConnectionStatus: 'connected', currentVoiceChannelId: 'preview' });
  await read();
  createRoot(document.getElementById('root')!).render(<MemoryRouter><Preview /></MemoryRouter>);
  const poll = window.setInterval(() => { void read(); }, 125);
  window.addEventListener('pagehide', () => window.clearInterval(poll), { once: true });
  import.meta.hot?.dispose(() => { window.clearInterval(poll); generation++; });
}
void start();
