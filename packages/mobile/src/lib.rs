//! Veyvox Android client — 100% Rust.
//!
//! Android-only `egui` preview based on the web `MobileShell`
//! (`docs/systems/mobile-ui.md`): root tabs Spaces / DMs / You, pushed
//! screen stack, chat, voice overlay (mini-bar + full screen), settings.
//! No iOS target exists. Performance is the reason for the language choice:
//! immediate-mode rendering, no webview, no JS bridge, lazy scrolling lists,
//! touch-first 44 px targets and safe-area-aware chrome.
//!
//! Data flow (all network off the egui frame):
//! - login → one bootstrap worker (spaces, first-space detail, DMs,
//!   friends, instance info, self profile) → `BootData`;
//! - channel/DM history pages load lazily on first open, cached per id;
//! - sends are optimistic with per-send receivers: success reconciles the
//!   server id, failure drops the echo and restores the composer, so a
//!   failed send never looks stored and concurrent sends cannot cross;
//! - a WS worker (`client: 'mobile'`) streams `ready`, messages, voice
//!   and call events; voice token fetches carry a generation counter so a
//!   late or failed answer can never open or wedge a call.

pub mod api;
mod onboarding;
pub mod screens;
pub mod state;
pub mod voice;
pub mod ws;

use std::collections::{HashMap, HashSet};
use std::sync::mpsc::{channel, Receiver};
use std::time::Duration;

use state::{AppState, AuthSession, ChatMessage, Dm, InstanceConfig, Screen, Tab};
use voice::IncomingCall;
use ws::{ClientFrame, ServerFrame, WsHandle};

type LoginResult = Result<(u64, BootData), String>;
type HistoryResult = Result<(String, bool, Vec<ChatMessage>), String>;
type SendResult = Result<(String, ChatMessage), String>;
type TokenResult = Result<(String, String), String>;
type SimpleResult = Result<(), String>;
const VOICE_PREVIEW_NOTICE: &str = "In this preview, audio and video are unavailable.";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AppTheme {
    Dark,
    Light,
}

#[derive(Debug, Default)]
struct Drafts {
    instance_url: String,
    username: String,
    password: String,
    composer_by_channel: HashMap<String, String>,
    friend_username: String,
    dm_rename: String,
    hide_password: bool,
    theme: Option<AppTheme>,
    discoverable: Option<bool>,
    show_activity: Option<bool>,
}

impl Drafts {
    fn password_visible(&self) -> bool {
        !self.hide_password
    }

    fn theme(&self) -> AppTheme {
        self.theme.unwrap_or(AppTheme::Dark)
    }
}

/// Everything the login worker loads before the first frame of content.
#[derive(Debug)]
struct BootData {
    session: AuthSession,
    spaces: Vec<state::Space>,
    channels: Vec<state::Channel>,
    members: HashMap<String, Vec<state::SpaceMember>>,
    current_space_id: Option<String>,
    dms: Vec<Dm>,
    friends: Vec<state::FriendEntry>,
    instance_name: Option<String>,
    instance_version: Option<String>,
    is_admin: bool,
    discoverable: Option<bool>,
    show_activity: Option<bool>,
    /// True when `GET /users/@me` failed during bootstrap: privacy panels
    /// show their server values as unknown instead of assuming `true`.
    profile_missing: bool,
}

struct VoiceFetch {
    room: String,
    is_dm: bool,
    attempt: u64,
    rx: Receiver<TokenResult>,
}
/// Acquired LiveKit credentials for the current call. The media transport
/// (room join with this token+url) is the documented follow-up in
/// `docs/systems/mobile-native.md`; signaling, gating and cleanup are
/// complete here, and the credentials are held — never fabricated or
/// silently dropped — until the call ends.
#[derive(Debug, Clone)]
struct VoiceSession {
    #[allow(dead_code)]
    token: String,
    #[allow(dead_code)]
    url: String,
}

struct PendingSend {
    temp_id: String,
    channel_id: String,
    body: String,
    rx: Receiver<SendResult>,
}

struct PendingHistory {
    channel_id: String,
    rx: Receiver<HistoryResult>,
}

type DetailResult = Result<(Vec<state::Channel>, Vec<state::SpaceMember>), String>;

struct PendingDetail {
    space_id: String,
    rx: Receiver<DetailResult>,
}

/// Android app root. Owns navigation state, voice state, drafts, the WS
/// handle and every in-flight worker receiver.
pub struct VeyvoxApp {
    state: AppState,
    voice: voice::VoiceState,
    drafts: Drafts,
    onboarding_language: onboarding::Language,
    login_rx: Option<Receiver<LoginResult>>,
    history_jobs: Vec<PendingHistory>,
    history_loaded: HashSet<String>,
    history_loading: HashSet<String>,
    detail_loading: HashSet<String>,
    detail_jobs: Vec<PendingDetail>,
    sends: Vec<PendingSend>,
    voice_fetch: Option<VoiceFetch>,
    voice_attempt: u64,
    voice_session: Option<VoiceSession>,
    friend_rx: Option<Receiver<SimpleResult>>,
    dm_create_rx: Option<Receiver<Result<Dm, String>>>,
    leave_rx: Option<Receiver<(String, SimpleResult)>>,
    dms_rx: Option<Receiver<Result<Vec<Dm>, String>>>,
    rename_rx: Option<Receiver<(String, String, SimpleResult)>>,
    privacy_rx: Option<Receiver<SimpleResult>>,
    me_rx: Option<Receiver<Result<api::MeInfo, String>>>,
    dms_stale: bool,
    detail_stale: HashSet<String>,
    privacy_saved: Option<(bool, bool)>,
    session_epoch: u64,
    ws: Option<WsHandle>,
    ws_rx: Option<Receiver<ServerFrame>>,
    ws_backoff_until_ms: u64,
    ws_backoff_secs: u64,
    busy: bool,
    is_admin: bool,
}

impl Default for VeyvoxApp {
    fn default() -> Self {
        Self {
            state: AppState::new(),
            voice: voice::VoiceState::default(),
            drafts: Drafts {
                hide_password: true,
                ..Drafts::default()
            },
            onboarding_language: onboarding::Language::default(),
            login_rx: None,
            history_jobs: Vec::new(),
            history_loaded: HashSet::new(),
            history_loading: HashSet::new(),
            detail_loading: HashSet::new(),
            detail_jobs: Vec::new(),
            sends: Vec::new(),
            voice_fetch: None,
            voice_attempt: 0,
            voice_session: None,
            friend_rx: None,
            dm_create_rx: None,
            leave_rx: None,
            rename_rx: None,
            privacy_rx: None,
            me_rx: None,
            dms_rx: None,
            dms_stale: false,
            detail_stale: HashSet::new(),
            privacy_saved: None,
            session_epoch: 0,
            ws: None,
            ws_rx: None,
            ws_backoff_until_ms: 0,
            ws_backoff_secs: 0,
            busy: false,
            is_admin: false,
        }
    }
}

impl VeyvoxApp {
    pub fn new(cc: &eframe::CreationContext<'_>) -> Self {
        let locale = ["LC_ALL", "LC_MESSAGES", "LANG"]
            .into_iter()
            .find_map(|key| std::env::var(key).ok().filter(|tag| !tag.is_empty()))
            .unwrap_or_default();
        Self::with_locale(cc, &locale)
    }

    fn with_locale(cc: &eframe::CreationContext<'_>, locale: &str) -> Self {
        onboarding::install_fonts(&cc.egui_ctx);
        Self {
            onboarding_language: onboarding::Language::from_tag(locale),
            ..Self::default()
        }
    }

    fn now_ms() -> u64 {
        chrono::Utc::now().timestamp_millis().max(0) as u64
    }

    fn authed_client(&self) -> Option<api::RestClient> {
        let instance = self.state.instance.clone()?;
        let session = self.state.session.clone()?;
        Some(api::RestClient::authenticated(instance, session))
    }

    fn ws_send(&self, frame: ClientFrame) -> bool {
        self.ws.as_ref().is_some_and(|ws| ws.send(frame))
    }

    /// Broadcast local mute/deafen/camera state to the call, mirroring the
    /// web `broadcastVoiceStatus` path. No-op outside a call.
    fn broadcast_voice_status(&self) {
        if !self.voice.in_any_call() {
            return;
        }
        self.ws_send(ClientFrame::VoiceStatus {
            is_muted: self.voice.muted,
            is_deafened: self.voice.deafened,
            is_camera_on: self.voice.camera_on,
            is_screen_sharing: self.voice.screen_sharing,
        });
    }

    // ── workers ──────────────────────────────────────────────

    fn clear_login_credentials(&mut self, ctx: &egui::Context) {
        self.drafts.username.clear();
        self.drafts.password.clear();
        self.drafts.hide_password = true;
        onboarding::clear_credential_editors(ctx);
    }

    fn select_login_server(&mut self, ctx: &egui::Context) {
        if let Ok(instance) = InstanceConfig::parse(&self.drafts.instance_url) {
            self.drafts.instance_url.clone_from(&instance.base_url);
            self.clear_login_credentials(ctx);
            self.state.instance = Some(instance);
            self.state.status_text.clear();
        } else {
            self.state.status_text = self.onboarding_language.copy().invalid_server.into();
        }
    }

    fn change_login_server(&mut self, ctx: &egui::Context) {
        if self.busy {
            return;
        }
        self.state.instance = None;
        self.clear_login_credentials(ctx);
        self.state.status_text.clear();
    }

    fn start_login(&mut self, ctx: &egui::Context) {
        if self.busy || self.login_rx.is_some() {
            return;
        }
        let copy = self.onboarding_language.copy();
        let Some(instance) = self.state.instance.clone() else {
            self.state.status_text = copy.invalid_server.into();
            return;
        };
        if self.drafts.username.trim().is_empty() {
            self.state.status_text = copy.username_required.into();
            return;
        }
        if self.drafts.password.is_empty() {
            self.state.status_text = copy.password_required.into();
            return;
        }
        let client = api::RestClient::new(instance);
        let username = self.drafts.username.trim().to_string();
        let password = self.drafts.password.clone();
        let (tx, rx) = channel();
        self.login_rx = Some(rx);
        self.busy = true;
        self.session_epoch = self.session_epoch.wrapping_add(1);
        let epoch = self.session_epoch;
        self.state.status_text.clear();
        let repaint = ctx.clone();
        std::thread::spawn(move || {
            let result =
                login_and_bootstrap(&client, &username, &password).map(|boot| (epoch, boot));
            let _ = tx.send(result.map_err(|e| e.to_string()));
            // Wake the frame: the login screen returns before the repaint
            // below, so without this a slow answer would sit unread until
            // the next interaction.
            repaint.request_repaint();
        });
    }

    fn ensure_ws(&mut self) {
        let Some(session) = self.state.session.clone() else {
            return;
        };
        if self.ws.as_ref().is_some_and(ws::WsHandle::is_running) {
            return;
        }
        self.ws = None;
        self.ws_rx = None;
        let now = Self::now_ms();
        if now < self.ws_backoff_until_ms {
            return;
        }
        let instance = match self.state.instance.clone() {
            Some(instance) => instance,
            None => return,
        };
        let url = match instance.ws_url() {
            Ok(url) => url,
            Err(err) => {
                self.state.status_text = format!("Realtime URL: {err}");
                return;
            }
        };
        let (tx, rx) = channel();
        self.ws_rx = Some(rx);
        self.ws = Some(ws::spawn_ws(url, session.token.clone(), tx));
        self.ws_backoff_secs = (self.ws_backoff_secs * 2 + 1).min(30);
        self.ws_backoff_until_ms = now.saturating_add(self.ws_backoff_secs.saturating_mul(1000));
    }

    fn ensure_space_detail(&mut self, space_id: &str) {
        if self.detail_loading.contains(space_id) {
            return;
        }
        if self.state.channels.iter().any(|c| c.space_id == space_id)
            && self.state.members.contains_key(space_id)
        {
            return;
        }
        self.spawn_space_detail(space_id);
    }

    /// Refetches a space unconditionally (member/channel change events).
    fn refresh_space_detail(&mut self, space_id: &str) {
        if self.detail_loading.contains(space_id) {
            return;
        }
        self.spawn_space_detail(space_id);
    }

    fn spawn_space_detail(&mut self, space_id: &str) {
        let Some(client) = self.authed_client() else {
            return;
        };
        let space = space_id.to_string();
        let (tx, rx) = channel();
        self.detail_loading.insert(space.clone());
        self.detail_jobs.push(PendingDetail {
            space_id: space.clone(),
            rx,
        });
        std::thread::spawn(move || {
            let result = client.space_detail(&space).map_err(|e| e.to_string());
            let _ = tx.send(result);
        });
    }

    fn ensure_history(&mut self, channel_id: &str, is_dm: bool) {
        if self.history_loaded.contains(channel_id) || self.history_loading.contains(channel_id) {
            return;
        }
        let Some(client) = self.authed_client() else {
            return;
        };
        let channel_name = channel_id.to_string();
        let (tx, rx) = channel();
        self.history_loading.insert(channel_name.clone());
        self.history_jobs.push(PendingHistory {
            channel_id: channel_name.clone(),
            rx,
        });
        std::thread::spawn(move || {
            let result = if is_dm {
                client.dm_history(&channel_name, 50)
            } else {
                client.channel_history(&channel_name, 50)
            }
            .map(|messages| (channel_name.clone(), is_dm, messages))
            .map_err(|e| e.to_string());
            let _ = tx.send(result);
        });
    }

    /// Queues one send with its own receiver: concurrent sends each
    /// reconcile only their own temp id, so a second send can never adopt
    /// or drop the first one's echo.
    fn send_body(&mut self, channel_id: &str, is_dm: bool, body: &str) {
        let Some(client) = self.authed_client() else {
            self.state.status_text = "Sign in first.".to_string();
            return;
        };
        let Some(session) = self.state.session.clone() else {
            self.state.status_text = "Sign in first.".to_string();
            return;
        };
        let message = ChatMessage::new(
            channel_id,
            session.user_id.clone(),
            session.display().to_string(),
            body.to_string(),
        );
        let temp_id = message.id.clone();
        self.state.upsert_message(message);
        let channel_name = channel_id.to_string();
        let body = body.to_string();
        let (tx, rx) = channel();
        self.sends.push(PendingSend {
            temp_id: temp_id.clone(),
            channel_id: channel_name.clone(),
            body: body.clone(),
            rx,
        });
        std::thread::spawn(move || {
            let result = if is_dm {
                client.send_dm_message(&channel_name, &body)
            } else {
                client.send_channel_message(&channel_name, &body)
            };
            let _ = tx.send(
                result
                    .map(|m| (temp_id.clone(), m))
                    .map_err(|e| e.to_string()),
            );
        });
    }

    fn fetch_voice_token(&mut self, room: &str, is_dm: bool) {
        let Some(client) = self.authed_client() else {
            self.state.status_text = "Sign in first.".to_string();
            return;
        };
        self.voice_attempt = self.voice_attempt.wrapping_add(1);
        let attempt = self.voice_attempt;
        let room_name = room.to_string();
        let (tx, rx) = channel();
        self.voice_fetch = Some(VoiceFetch {
            room: room_name.clone(),
            is_dm,
            attempt,
            rx,
        });
        self.busy = true;
        self.state.status_text = "Connecting voice…".to_string();
        std::thread::spawn(move || {
            let result = if is_dm {
                client.voice_token_dm(&room_name)
            } else {
                client.voice_token_channel(&room_name)
            };
            let outcome = result.map_err(|e| e.to_string());
            let _ = tx.send(outcome);
        });
    }

    // ── polling ──────────────────────────────────────────────

    fn poll_login(&mut self, ctx: &egui::Context) {
        let result = match self.login_rx.as_ref() {
            Some(rx) => match rx.try_recv() {
                Ok(result) => result,
                Err(_) => return,
            },
            None => return,
        };
        self.login_rx = None;
        self.busy = false;
        match result {
            Ok((epoch, boot)) => {
                // Stale answer (logout + login raced it): never apply an old
                // session over the current one.
                if epoch != self.session_epoch {
                    return;
                }
                self.is_admin = boot.is_admin;
                self.drafts.discoverable = boot.discoverable;
                self.drafts.show_activity = boot.show_activity;
                self.privacy_saved = match (boot.discoverable, boot.show_activity) {
                    (Some(d), Some(s)) => Some((d, s)),
                    _ => None,
                };
                let profile_missing = boot.profile_missing;
                apply_boot(&mut self.state, boot);
                self.clear_login_credentials(ctx);
                self.state.status_text = if profile_missing {
                    "Signed in — profile unavailable; privacy shows defaults.".to_string()
                } else {
                    "Signed in.".to_string()
                };
            }
            Err(_) => {
                self.state.status_text = self.onboarding_language.copy().failed.into();
            }
        }
    }

    fn poll_jobs(&mut self) {
        let mut history_done = Vec::new();
        for (index, job) in self.history_jobs.iter().enumerate() {
            if let Ok(result) = job.rx.try_recv() {
                history_done.push((index, result));
            }
        }
        for (index, result) in history_done.into_iter().rev() {
            let job = self.history_jobs.remove(index);
            self.history_loading.remove(&job.channel_id);
            match result {
                Ok((channel_id, _is_dm, messages)) => {
                    for message in messages {
                        self.state.upsert_message(message);
                    }
                    self.history_loaded.insert(channel_id);
                }
                Err(err) => {
                    self.state.status_text = format!("History failed: {err}");
                }
            }
        }

        let mut details_done = Vec::new();
        for (index, job) in self.detail_jobs.iter().enumerate() {
            if let Ok(result) = job.rx.try_recv() {
                details_done.push((index, result));
            }
        }
        for (index, result) in details_done.into_iter().rev() {
            let job = self.detail_jobs.remove(index);
            self.detail_loading.remove(&job.space_id);
            match result {
                Ok((channels, members)) => {
                    self.state.channels.retain(|c| c.space_id != job.space_id);
                    self.state.channels.extend(channels);
                    self.state.set_members(&job.space_id, members);
                }
                Err(err) => {
                    self.state.status_text = format!("Space failed: {err}");
                }
            }
        }

        if !self.detail_stale.is_empty() {
            let stale: Vec<String> = self.detail_stale.drain().collect();
            for space_id in stale {
                self.refresh_space_detail(&space_id);
            }
        }

        let mut sends_done = Vec::new();
        for (index, send) in self.sends.iter().enumerate() {
            if let Ok(result) = send.rx.try_recv() {
                sends_done.push((index, result));
            }
        }
        for (index, result) in sends_done.into_iter().rev() {
            let send = self.sends.remove(index);
            // The optimistic echo always leaves, success or failure: on
            // success the server row replaces it; on failure a failed row
            // stays in its own conversation with an inline retry, so a
            // failed send never looks stored, never touches the composer
            // and never navigates anywhere.
            self.state.messages.retain(|m| m.id != send.temp_id);
            match result {
                Ok((_temp_id, server)) => {
                    self.state.upsert_message(server);
                }
                Err(err) => {
                    self.state.upsert_message(ChatMessage {
                        id: send.temp_id,
                        channel_id: send.channel_id,
                        author_id: String::new(),
                        author_name: String::new(),
                        body: send.body,
                        created_at: chrono::Utc::now(),
                        pending: false,
                        failed: true,
                    });
                    self.state.status_text = format!("Send failed ({err}).");
                }
            }
        }

        if self.voice_fetch.is_some() {
            let result = {
                let fetch = self.voice_fetch.as_ref().expect("fetch present");
                match fetch.rx.try_recv() {
                    Ok(result) => Some((fetch.room.clone(), fetch.is_dm, fetch.attempt, result)),
                    Err(std::sync::mpsc::TryRecvError::Disconnected) => {
                        self.voice_fetch = None;
                        None
                    }
                    Err(std::sync::mpsc::TryRecvError::Empty) => None,
                }
            };
            if let Some((room, is_dm, attempt, result)) = result {
                self.voice_fetch = None;
                self.busy = false;
                self.apply_token_result(&room, is_dm, attempt, result);
            }
        }

        if let Some(rx) = self.friend_rx.as_ref() {
            if let Ok(result) = rx.try_recv() {
                self.friend_rx = None;
                match result {
                    Ok(()) => {
                        self.drafts.friend_username.clear();
                        self.state.status_text = "Friend request sent.".to_string();
                        self.refresh_dms();
                    }
                    Err(err) => {
                        self.state.status_text = format!("Request failed: {err}");
                    }
                }
            }
        }

        if let Some(rx) = self.leave_rx.as_ref() {
            if let Ok((dm_id, result)) = rx.try_recv() {
                self.leave_rx = None;
                match result {
                    Ok(()) => {
                        self.state.remove_dm(&dm_id);
                        while self.state.top().is_some() {
                            self.state.pop();
                        }
                        self.state.status_text = "Left the group.".to_string();
                    }
                    Err(err) => {
                        self.state.status_text = format!("Leave failed: {err}");
                    }
                }
            }
        }

        if let Some(rx) = self.rename_rx.as_ref() {
            if let Ok((dm_id, name, result)) = rx.try_recv() {
                self.rename_rx = None;
                match result {
                    Ok(()) => {
                        if let Some(dm) = self.state.dms.iter_mut().find(|d| d.id == dm_id) {
                            dm.name = name;
                        }
                        self.state.status_text = "Group renamed.".to_string();
                    }
                    Err(err) => {
                        self.state.status_text = format!("Rename failed: {err}");
                    }
                }
            }
        }

        if let Some(rx) = self.privacy_rx.as_ref() {
            if let Ok(result) = rx.try_recv() {
                self.privacy_rx = None;
                match result {
                    Ok(()) => {
                        self.privacy_saved =
                            match (self.drafts.discoverable, self.drafts.show_activity) {
                                (Some(d), Some(s)) => Some((d, s)),
                                _ => None,
                            };
                        self.state.status_text = "Privacy updated.".to_string();
                    }
                    Err(err) => {
                        // Never display a rejected write as persisted:
                        // restore the last saved values.
                        if let Some((d, s)) = self.privacy_saved {
                            self.drafts.discoverable = Some(d);
                            self.drafts.show_activity = Some(s);
                        }
                        self.state.status_text = format!("Privacy failed: {err}");
                    }
                }
            }
        }

        if let Some(rx) = self.me_rx.as_ref() {
            if let Ok(result) = rx.try_recv() {
                self.me_rx = None;
                match result {
                    Ok(me) => {
                        self.drafts
                            .discoverable
                            .get_or_insert(me.discoverable.unwrap_or(true));
                        self.drafts
                            .show_activity
                            .get_or_insert(me.show_activity.unwrap_or(true));
                        if self.privacy_saved.is_none() {
                            self.privacy_saved = Some((
                                self.drafts.discoverable.unwrap_or(true),
                                self.drafts.show_activity.unwrap_or(true),
                            ));
                        }
                        self.is_admin = me.is_admin;
                    }
                    Err(err) => {
                        self.state.status_text = format!("Profile failed: {err}");
                    }
                }
            }
        }

        if let Some(rx) = self.dm_create_rx.as_ref() {
            if let Ok(result) = rx.try_recv() {
                self.dm_create_rx = None;
                match result {
                    Ok(dm) => {
                        let id = dm.id.clone();
                        match self.state.dms.iter_mut().find(|d| d.id == id) {
                            Some(existing) => *existing = dm,
                            None => self.state.dms.push(dm),
                        }
                        self.ensure_history(&id, true);
                        self.state.push(Screen::ChannelChat {
                            channel_id: id,
                            space_id: "@me".to_string(),
                        });
                    }
                    Err(err) => {
                        self.state.status_text = format!("DM failed: {err}");
                    }
                }
            }
        }

        if self.dms_stale && self.dms_rx.is_none() {
            self.dms_stale = false;
            self.refresh_dms();
        }

        if let Some(rx) = self.dms_rx.as_ref() {
            if let Ok(result) = rx.try_recv() {
                self.dms_rx = None;
                match result {
                    Ok(fresh) => {
                        // Preserve locally-known read state: an already-read
                        // DM stays read, a brand-new DM with messages
                        // arrives unread.
                        let read: std::collections::HashMap<String, bool> = self
                            .state
                            .dms
                            .iter()
                            .map(|d| (d.id.clone(), d.unread))
                            .collect();
                        self.state.dms = fresh
                            .into_iter()
                            .map(|mut d| {
                                d.unread = read
                                    .get(&d.id)
                                    .copied()
                                    .unwrap_or(d.last_message_id.is_some());
                                d
                            })
                            .collect();
                    }
                    Err(err) => {
                        self.state.status_text = format!("DMs refresh failed: {err}");
                    }
                }
            }
        }
    }

    fn refresh_dms(&mut self) {
        if self.dms_rx.is_some() {
            return;
        }
        let Some(client) = self.authed_client() else {
            return;
        };
        let (tx, rx) = channel();
        self.dms_rx = Some(rx);
        std::thread::spawn(move || {
            let result = client.list_dms().map_err(|e| e.to_string());
            let _ = tx.send(result);
        });
    }

    /// Applies a voice token answer only when it is still current: same
    /// generation as the latest fetch AND the call it was fetched for is
    /// still the pending one. Anything else is a late answer and is
    /// dropped. Errors clean up exactly the half-call the failed fetch
    /// belonged to, so a failed fetch can never leave the UI stuck.
    ///
    /// Semantics per direction: an accepted incoming call pushes the
    /// full-screen view (the peer is already there); an outgoing call only
    /// holds its credentials and keeps ringing until `dm_call_accepted`
    /// promotes it — credentials alone never claim a connected call.
    fn apply_token_result(&mut self, room: &str, is_dm: bool, attempt: u64, result: TokenResult) {
        if attempt != self.voice_attempt {
            return;
        }
        match result {
            Ok((token, url)) => {
                if is_dm {
                    if self.voice.outgoing_call.as_deref() == Some(room) {
                        self.voice_session = Some(VoiceSession { token, url });
                        self.state.status_text = "Ringing…".to_string();
                    } else if self.voice.active_dm_call.as_deref() == Some(room) {
                        self.voice_session = Some(VoiceSession { token, url });
                        self.state.push(Screen::VoiceFull);
                        self.state.status_text = VOICE_PREVIEW_NOTICE.to_string();
                    }
                } else if self.voice.current_voice_channel_id.as_deref() == Some(room) {
                    self.voice_session = Some(VoiceSession { token, url });
                    self.state.push(Screen::VoiceFull);
                    self.state.status_text = VOICE_PREVIEW_NOTICE.to_string();
                }
            }
            Err(err) => {
                if is_dm {
                    if self.voice.outgoing_call.as_deref() == Some(room)
                        || self.voice.active_dm_call.as_deref() == Some(room)
                    {
                        self.voice.end_dm_call(room);
                    }
                } else if self.voice.current_voice_channel_id.as_deref() == Some(room) {
                    self.voice.leave_space_voice();
                }
                if !self.voice.in_any_call() {
                    self.voice_session = None;
                }
                self.state.status_text = format!("Voice failed: {err}.");
            }
        }
    }

    fn poll_ws(&mut self) {
        let frames: Vec<ServerFrame> = match self.ws_rx.as_ref() {
            Some(rx) => {
                let mut out = Vec::new();
                while let Ok(frame) = rx.try_recv() {
                    out.push(frame);
                }
                out
            }
            None => Vec::new(),
        };
        for frame in frames {
            self.apply_server_frame(frame);
        }
        if self.ws.as_ref().is_some_and(|ws| !ws.is_running()) {
            self.ws = None;
            self.ws_rx = None;
        }
    }

    fn apply_server_frame(&mut self, frame: ServerFrame) {
        match frame {
            ServerFrame::Ready {
                user,
                spaces,
                dm_channels,
                unread_counts,
                read_states,
            } => {
                // A fresh catalog does not carry message history. Discard
                // old snapshots and in-flight results, but keep local sends
                // so the supported history window is refetched on viewing.
                self.history_loaded.clear();
                self.history_loading.clear();
                self.history_jobs.clear();
                self.state.messages.retain(|m| m.pending || m.failed);
                let reads: HashMap<String, String> = read_states
                    .into_iter()
                    .filter(|r| !r.channel_id.is_empty())
                    .map(|r| (r.channel_id, r.last_read_message_id))
                    .collect();
                let mut full_spaces = Vec::new();
                for value in &spaces {
                    if let Some(parsed) = api::parse_space_value(value) {
                        full_spaces.push(parsed);
                    }
                }
                let mut dms = Vec::new();
                for value in &dm_channels {
                    if let Some(dm) = api::parse_dm_value(value) {
                        dms.push(dm);
                    }
                }
                apply_ready_catalog(
                    &mut self.state,
                    full_spaces,
                    dms,
                    &unread_counts,
                    &reads,
                    &user.username,
                );
                self.state.bootstrapped = true;
                let _ = user;
            }
            ServerFrame::MessageCreated { message } => {
                let author = self.state.display_name_for(&message.user_id);
                let self_id = self
                    .state
                    .session
                    .as_ref()
                    .map(|s| s.user_id.clone())
                    .unwrap_or_default();
                adopt_or_insert(
                    &mut self.state,
                    ChatMessage {
                        id: message.id,
                        channel_id: message.channel_id,
                        author_id: message.user_id,
                        author_name: author,
                        body: message.content.unwrap_or_default(),
                        created_at: millis_to_dt(message.created_at),
                        pending: false,
                        failed: false,
                    },
                    &self_id,
                );
            }
            ServerFrame::DmMessageCreated { message } => {
                let author = self.state.display_name_for(&message.user_id);
                let self_id = self
                    .state
                    .session
                    .as_ref()
                    .map(|s| s.user_id.clone())
                    .unwrap_or_default();
                let dm_id = message.dm_channel_id.clone();
                let created_at = millis_to_dt(message.created_at);
                let body = message.content.unwrap_or_default();
                if let Some(dm) = self.state.dms.iter_mut().find(|d| d.id == dm_id) {
                    let newer = dm.last_message_at.is_none_or(|last| {
                        created_at > last
                            || (created_at == last
                                && dm
                                    .last_message_id
                                    .as_deref()
                                    .is_none_or(|id| message_id_after(&message.id, id)))
                    });
                    if newer && dm.last_message_id.as_deref() != Some(&message.id) {
                        dm.last_message_id = Some(message.id.clone());
                        dm.last_message_at = Some(created_at);
                        dm.last_message_preview = Some(body.clone());
                        dm.unread |= message.user_id != self_id;
                    }
                }
                adopt_or_insert(
                    &mut self.state,
                    ChatMessage {
                        id: message.id,
                        channel_id: dm_id.clone(),
                        author_id: message.user_id,
                        author_name: author,
                        body,
                        created_at,
                        pending: false,
                        failed: false,
                    },
                    &self_id,
                );
            }
            ServerFrame::ChannelAck {
                channel_id,
                message_id,
            } => {
                if let Some(dm) = self.state.dms.iter_mut().find(|d| d.id == channel_id) {
                    if dm.last_message_id.as_deref().is_some_and(|last| {
                        last == message_id || message_id_after(&message_id, last)
                    }) {
                        dm.unread = false;
                    }
                }
            }
            ServerFrame::MarkUnread { channel_id } => {
                if let Some(dm) = self.state.dms.iter_mut().find(|d| d.id == channel_id) {
                    dm.unread = dm.last_message_id.is_some();
                }
            }
            ServerFrame::VoiceStateUpdate {
                channel_id,
                user_id,
                action,
            } => {
                let entry = self.voice.participants.entry(channel_id).or_default();
                match action.as_str() {
                    "join" => {
                        if !entry.contains(&user_id) {
                            entry.push(user_id);
                        }
                    }
                    _ => {
                        entry.retain(|id| id != &user_id);
                    }
                }
            }
            ServerFrame::SpaceVoiceState { voice_states, .. } => {
                for (channel_id, users) in voice_states {
                    self.voice.participants.insert(channel_id, users);
                }
            }
            ServerFrame::DmCallIncoming {
                dm_channel_id,
                caller_id,
                caller_name,
            } => {
                self.voice.ring_incoming(IncomingCall {
                    dm_id: dm_channel_id.clone(),
                    caller_id,
                    caller_name: caller_name.clone(),
                });
                self.state.status_text = format!("Incoming call from {caller_name}.");
            }
            ServerFrame::DmCallAccepted { dm_channel_id } => {
                if self.voice.outgoing_call.as_deref() == Some(dm_channel_id.as_str()) {
                    self.voice.outgoing_call = None;
                    self.voice.active_dm_call = Some(dm_channel_id.clone());
                    if self.voice_session.is_some() {
                        // The peer answered, but only signaling is available.
                        self.state.push(Screen::VoiceFull);
                        self.state.status_text = VOICE_PREVIEW_NOTICE.to_string();
                    } else {
                        self.fetch_voice_token(&dm_channel_id, true);
                    }
                }
            }
            ServerFrame::DmCallRejected { dm_channel_id } => {
                if self.voice_call_matches(&dm_channel_id) {
                    self.voice.end_dm_call(&dm_channel_id);
                    self.state.status_text = "Call declined.".to_string();
                }
            }
            ServerFrame::DmCallWaiting { dm_channel_id } => {
                if self.voice_call_matches(&dm_channel_id) {
                    self.state.status_text = "Ringing…".to_string();
                }
            }
            ServerFrame::DmCallEnded { dm_channel_id } => {
                if self.voice_call_matches(&dm_channel_id) {
                    self.voice.end_dm_call(&dm_channel_id);
                    self.voice_session = None;
                    if self.state.top() == Some(&Screen::VoiceFull) {
                        self.state.pop();
                    }
                    self.state.status_text = "Call ended.".to_string();
                }
            }
            ServerFrame::DmChannelUpdated { .. } => {
                self.dms_stale = true;
            }
            ServerFrame::DmChannelCreated { dm_channel } => {
                if let Some(dm) = api::parse_dm_value(&dm_channel) {
                    let id = dm.id.clone();
                    let unread = dm.last_message_id.is_some();
                    match self.state.dms.iter_mut().find(|d| d.id == id) {
                        Some(existing) => {
                            *existing = Dm {
                                unread: existing.unread,
                                ..dm
                            };
                        }
                        None => self.state.dms.push(Dm { unread, ..dm }),
                    }
                }
            }
            ServerFrame::DmMemberAdded {
                dm_channel_id,
                user,
            } => {
                if let Some(dm) = self.state.dms.iter_mut().find(|d| d.id == dm_channel_id) {
                    if !dm.member_ids.contains(&user.id) {
                        dm.member_ids.push(user.id.clone());
                    }
                    dm.member_names.insert(user.id, user.username);
                }
            }
            ServerFrame::DmMemberRemoved {
                dm_channel_id,
                user_id,
            } => {
                let me = self
                    .state
                    .session
                    .as_ref()
                    .map(|s| s.user_id.as_str())
                    .unwrap_or_default()
                    .to_string();
                if user_id == me {
                    self.state.remove_dm(&dm_channel_id);
                } else if let Some(dm) = self.state.dms.iter_mut().find(|d| d.id == dm_channel_id) {
                    dm.member_ids.retain(|id| id != &user_id);
                    dm.member_names.remove(&user_id);
                }
            }
            ServerFrame::DmOwnerUpdated {
                dm_channel_id,
                new_owner_id,
            } => {
                if let Some(dm) = self.state.dms.iter_mut().find(|d| d.id == dm_channel_id) {
                    dm.owner_id = Some(new_owner_id);
                }
            }
            ServerFrame::MemberJoined { space_id }
            | ServerFrame::MemberUpdated { space_id }
            | ServerFrame::ChannelCreated { space_id }
            | ServerFrame::ChannelUpdated { space_id } => {
                self.detail_stale.insert(space_id);
            }
            ServerFrame::MemberLeft { space_id, .. } => {
                self.detail_stale.insert(space_id);
            }
            ServerFrame::ChannelDeleted {
                space_id,
                channel_id,
            } => {
                self.detail_stale.insert(space_id.clone());
                self.state.channels.retain(|c| c.id != channel_id);
                self.state.messages.retain(|m| m.channel_id != channel_id);
                if self.state.top()
                    == Some(&Screen::ChannelChat {
                        channel_id: channel_id.clone(),
                        space_id: space_id.clone(),
                    })
                {
                    self.state.pop();
                }
            }
            ServerFrame::SpaceUpdated { space } => {
                if let Some(id) = space.get("id").and_then(|v| v.as_str()) {
                    self.detail_stale.insert(id.to_string());
                }
            }
            ServerFrame::DmChannelClosed { dm_channel_id } => {
                self.state.remove_dm(&dm_channel_id);
                if self.state.top()
                    == Some(&Screen::ChannelChat {
                        channel_id: dm_channel_id,
                        space_id: "@me".to_string(),
                    })
                {
                    self.state.pop();
                }
            }
            ServerFrame::Error {
                code,
                dm_channel_id,
                ..
            } => {
                if let Some(dm) = dm_channel_id {
                    if self.voice_call_matches(&dm) {
                        self.voice.end_dm_call(&dm);
                        self.voice_session = None;
                        let code = code.unwrap_or_else(|| "call_failed".to_string());
                        self.state.status_text = format!("Call refused: {code}.");
                    }
                }
            }
            ServerFrame::VoiceStatusUpdate { .. } | ServerFrame::Pong | ServerFrame::Unknown => {}
        }
    }

    fn voice_call_matches(&self, dm_id: &str) -> bool {
        self.voice.outgoing_call.as_deref() == Some(dm_id)
            || self.voice.active_dm_call.as_deref() == Some(dm_id)
            || self.voice.incoming_dm_id() == Some(dm_id)
    }

    fn logout(&mut self, ctx: &egui::Context) {
        if let Some(ws) = self.ws.take() {
            ws.shutdown();
        }
        self.ws_rx = None;
        self.ws_backoff_until_ms = 0;
        self.ws_backoff_secs = 0;
        // A new epoch invalidates every in-flight worker answer: nothing
        // started by the previous session may be applied to the next one.
        self.session_epoch = self.session_epoch.wrapping_add(1);
        self.state = AppState::new();
        self.state.instance = None;
        self.voice = voice::VoiceState::default();
        self.voice_session = None;
        self.voice_fetch = None;
        self.voice_attempt = 0;
        self.history_loaded.clear();
        self.history_loading.clear();
        self.detail_loading.clear();
        self.detail_stale.clear();
        self.history_jobs.clear();
        self.detail_jobs.clear();
        self.sends.clear();
        self.login_rx = None;
        self.friend_rx = None;
        self.dm_create_rx = None;
        self.leave_rx = None;
        self.rename_rx = None;
        self.privacy_rx = None;
        self.me_rx = None;
        self.dms_rx = None;
        self.dms_stale = false;
        self.is_admin = false;
        self.busy = false;
        self.privacy_saved = None;
        // The server address can be reused; credentials and undo history can't.
        self.clear_login_credentials(ctx);
        self.drafts.composer_by_channel.clear();
        self.drafts.friend_username.clear();
        self.drafts.dm_rename.clear();
        self.drafts.discoverable = None;
        self.drafts.show_activity = None;
    }
}

fn millis_to_dt(millis: i64) -> chrono::DateTime<chrono::Utc> {
    chrono::DateTime::from_timestamp_millis(millis).unwrap_or_else(chrono::Utc::now)
}

fn login_and_bootstrap(
    client: &api::RestClient,
    username: &str,
    password: &str,
) -> Result<BootData, String> {
    let session = client
        .login(username, password)
        .map_err(|e| e.to_string())?;
    let authed = api::RestClient::authenticated(client.instance.clone(), session.clone());
    let info = authed.instance_info().ok();
    let spaces = authed.list_spaces().map_err(|e| e.to_string())?;
    let mut channels = Vec::new();
    let mut members: HashMap<String, Vec<state::SpaceMember>> = HashMap::new();
    let mut current_space_id = None;
    if let Some(first) = spaces.first() {
        current_space_id = Some(first.id.clone());
        if let Ok((c, m)) = authed.space_detail(&first.id) {
            channels = c;
            members.insert(first.id.clone(), m);
        }
    }
    let dms = authed.list_dms().map_err(|e| e.to_string())?;
    let friends = authed.list_friends().unwrap_or_default();
    let me = authed.me().ok();
    Ok(BootData {
        session,
        spaces,
        channels,
        members,
        current_space_id,
        dms,
        friends,
        instance_name: info.as_ref().map(|i| i.name.clone()),
        instance_version: info.as_ref().map(|i| i.version.clone()),
        is_admin: me.as_ref().is_some_and(|m| m.is_admin),
        discoverable: me.as_ref().and_then(|m| m.discoverable),
        show_activity: me.as_ref().and_then(|m| m.show_activity),
        profile_missing: me.is_none(),
    })
}

/// Applies the login bootstrap onto fresh state: catalog, first space,
/// DMs, friends and instance identity in one place.
fn apply_boot(state: &mut AppState, boot: BootData) {
    state.session = Some(boot.session);
    state.spaces = boot.spaces;
    state.channels = boot.channels;
    state.members = boot.members;
    state.current_space_id = boot.current_space_id;
    state.dms = boot.dms;
    state.friends = boot.friends;
    state.instance_name = boot.instance_name;
    state.instance_version = boot.instance_version;
    state.tab = Tab::Spaces;
    state.stack.clear();
    state.bootstrapped = true;
}

/// Replaces the catalog from a WS `ready` (or any full snapshot): spaces
/// with channels/members, DMs, and unread markers from `unreadCounts` +
/// `readStates`.
fn apply_ready_catalog(
    state: &mut AppState,
    full_spaces: Vec<(state::Space, Vec<state::Channel>, Vec<state::SpaceMember>)>,
    dms: Vec<Dm>,
    unread_counts: &HashMap<String, i64>,
    reads: &HashMap<String, String>,
    _self_username: &str,
) {
    state.spaces = full_spaces.iter().map(|(s, _, _)| s.clone()).collect();
    state.channels = full_spaces.iter().flat_map(|(_, c, _)| c.clone()).collect();
    for (space, _, members) in &full_spaces {
        state.set_members(&space.id, members.clone());
    }
    if state.current_space_id.is_none() {
        state.current_space_id = state.spaces.first().map(|s| s.id.clone());
    }
    // Unread: any positive per-channel count marks its space.
    let mut unread_spaces = HashSet::new();
    for (channel_id, count) in unread_counts {
        if *count > 0 {
            if let Some(channel) = state.channels.iter().find(|c| &c.id == channel_id) {
                unread_spaces.insert(channel.space_id.clone());
            }
        }
    }
    for space in state.spaces.iter_mut() {
        space.unread = unread_spaces.contains(&space.id);
    }
    state.dms = dms
        .into_iter()
        .map(|mut dm| {
            let read = reads.get(&dm.id);
            dm.unread = match (&dm.last_message_id, read) {
                (Some(last), Some(marker)) => last != marker && !message_id_after(marker, last),
                (Some(_), None) => true,
                (None, _) => false,
            };
            dm
        })
        .collect();
}

fn message_id_after(candidate: &str, other: &str) -> bool {
    matches!((candidate.parse::<u64>(), other.parse::<u64>()), (Ok(a), Ok(b)) if a > b)
}

/// Merges a live message: a pending optimistic echo with the same
/// channel, author and body is replaced (same send, now confirmed);
/// otherwise the message upserts by id (REST/WS duplicate race).
fn adopt_or_insert(state: &mut AppState, message: ChatMessage, self_id: &str) {
    if message.author_id == self_id {
        if let Some(position) = state
            .messages
            .iter()
            .position(|m| m.pending && m.channel_id == message.channel_id && m.body == message.body)
        {
            state.messages.remove(position);
            state.upsert_message(message);
            return;
        }
    }
    state.upsert_message(message);
}
fn short_name(name: &str) -> String {
    let mut initials = String::new();
    for word in name.split_whitespace().take(2) {
        if let Some(first) = word.chars().next() {
            initials.push(first);
        }
    }
    if initials.is_empty() {
        name.chars().take(2).collect()
    } else {
        initials
    }
}

impl eframe::App for VeyvoxApp {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        match self.drafts.theme() {
            AppTheme::Dark => ctx.set_visuals(egui::Visuals::dark()),
            AppTheme::Light => ctx.set_visuals(egui::Visuals::light()),
        }
        self.poll_login(ctx);
        self.poll_jobs();
        self.poll_ws();
        self.ensure_ws();

        if self.state.session.is_none() {
            self.render_login(ctx);
            return;
        }

        let show_nav = screens::should_show_bottom_nav(self.state.stack.len());
        egui::TopBottomPanel::bottom("mobile-nav").show(ctx, |ui| {
            if show_nav {
                if let Some(tab) = screens::bottom_nav(
                    ui,
                    self.state.tab,
                    self.state.unread_dm_count(),
                    self.state.has_unread_space(),
                ) {
                    self.state.set_tab(tab);
                }
            } else if self.voice.in_any_call() && self.state.top() != Some(&Screen::VoiceFull) {
                self.render_mini_bar(ui);
            }
        });

        egui::CentralPanel::default().show(ctx, |ui| {
            // Clone the top screen so rendering can mutate the stack.
            let top = self.state.top().cloned();
            match top {
                None => match self.state.tab {
                    Tab::Spaces => self.render_spaces_tab(ui),
                    Tab::Dms => self.render_dms_tab(ui),
                    Tab::You => self.render_you_tab(ui),
                },
                Some(Screen::ChannelChat {
                    channel_id,
                    space_id,
                }) => self.render_channel_chat(ui, &channel_id, &space_id),
                Some(Screen::Friends) => self.render_friends(ui),
                Some(Screen::Settings) => self.render_settings_hub(ui),
                Some(Screen::SettingsAccount) => self.render_account(ui),
                Some(Screen::SettingsAppearance) => self.render_appearance(ui),
                Some(Screen::SettingsVoice) => self.render_voice_settings(ui),
                Some(Screen::SettingsPrivacy) => self.render_privacy(ui),
                Some(Screen::SettingsInstance) => self.render_instance(ui),
                Some(Screen::Members { space_id }) => {
                    let space = space_id.or(self.state.current_space_id.clone());
                    self.render_members(ui, space.as_deref());
                }
                Some(Screen::GroupDmInfo { channel_id }) => {
                    self.render_group_dm_info(ui, &channel_id)
                }
                Some(Screen::VoiceFull) => self.render_voice_full(ui),
                Some(Screen::UserProfile { user_id }) => self.render_user_profile(ui, &user_id),
            }
            if !self.state.status_text.is_empty() {
                ui.separator();
                ui.label(&self.state.status_text);
            }
        });

        // Keep DM re-ring guards and WS backoff fresh without a timer thread.
        ctx.request_repaint_after(Duration::from_secs(1));
    }
}

impl VeyvoxApp {
    fn render_login(&mut self, ctx: &egui::Context) {
        use onboarding as auth;
        let copy = self.onboarding_language.copy();
        let server = self.state.instance.as_ref().map(|s| s.base_url.clone());
        let enter = ctx.input(|i| i.key_pressed(egui::Key::Enter));
        auth::page(ctx, server.is_some(), |ui| {
            let Some(server) = server else {
                auth::header(ui, copy.welcome, copy.connect_prompt);
                auth::error(ui, &self.state.status_text);
                let label = auth::field_label(ui, copy.server, false);
                let address = auth::input(
                    ui,
                    &mut self.drafts.instance_url,
                    &label,
                    auth::Field::Server,
                    "chat.example.com",
                    false,
                );
                ui.add_space(20.0);
                if auth::primary(ui, copy.continue_action).clicked()
                    || (enter && address.lost_focus())
                {
                    self.select_login_server(ctx);
                }
                return;
            };
            auth::header(ui, copy.login_title, copy.login_prompt);
            auth::error(ui, &self.state.status_text);
            ui.add_enabled_ui(!self.busy, |ui| {
                let label = auth::field_label(ui, copy.username, true);
                auth::input(
                    ui,
                    &mut self.drafts.username,
                    &label,
                    auth::Field::Username,
                    "",
                    false,
                );
                ui.add_space(20.0);
                let label = auth::field_label(ui, copy.password, true);
                let masked = !self.drafts.password_visible();
                let password = auth::input(
                    ui,
                    &mut self.drafts.password,
                    &label,
                    auth::Field::Password,
                    "",
                    masked,
                );
                ui.allocate_ui_with_layout(
                    egui::vec2(ui.available_width(), screens::TOUCH_TARGET),
                    egui::Layout::right_to_left(egui::Align::Center),
                    |ui| {
                        if auth::secondary(ui, if masked { copy.show } else { copy.hide }).clicked()
                        {
                            self.drafts.hide_password = !self.drafts.hide_password;
                        }
                    },
                );
                let action = if self.busy {
                    copy.submitting
                } else {
                    copy.submit
                };
                if auth::primary(ui, action).clicked() || (enter && password.lost_focus()) {
                    self.start_login(ctx);
                }
                ui.add_space(16.0);
                if auth::selected_server(ui, &server, copy.change_server).clicked() {
                    self.change_login_server(ctx);
                }
            });
        });
    }

    fn render_spaces_tab(&mut self, ui: &mut egui::Ui) {
        ui.heading("Spaces");
        if !self.state.bootstrapped {
            ui.label("Loading spaces…");
            return;
        }
        if self.state.spaces.is_empty() {
            ui.label("No spaces yet. Join one from an invite.");
            return;
        }
        let current = self
            .state
            .current_space_id
            .clone()
            .or_else(|| self.state.spaces.first().map(|s| s.id.clone()));
        if let Some(current) = current.clone() {
            self.state.select_space(&current);
            self.ensure_space_detail(&current);
        }
        let space_id = current.unwrap_or_default();
        ui.horizontal(|ui| {
            egui::ScrollArea::vertical().max_width(76.0).show(ui, |ui| {
                for space in self.state.spaces.clone() {
                    let selected = Some(space.id.clone()) == self.state.current_space_id;
                    let label = if space.unread {
                        format!("● {}", short_name(&space.name))
                    } else {
                        short_name(&space.name)
                    };
                    if ui
                        .add(
                            egui::Button::new(label)
                                .min_size(egui::vec2(64.0, screens::TOUCH_TARGET))
                                .selected(selected),
                        )
                        .clicked()
                    {
                        self.state.select_space(&space.id);
                        self.ensure_space_detail(&space.id);
                    }
                }
            });
            ui.separator();
            egui::ScrollArea::vertical().show(ui, |ui| {
                let channels = self
                    .state
                    .channels_for(&space_id)
                    .into_iter()
                    .cloned()
                    .collect::<Vec<_>>();
                if channels.is_empty() {
                    ui.label("Loading channels…");
                    return;
                }
                for channel in channels {
                    let label = match channel.kind {
                        state::ChannelKind::Text => format!("# {}", channel.name),
                        state::ChannelKind::Voice => format!("🔊 {}", channel.name),
                    };
                    let label = if channel.unread {
                        format!("● {label}")
                    } else {
                        label
                    };
                    if ui
                        .add(
                            egui::Button::new(label)
                                .min_size(egui::vec2(ui.available_width(), screens::TOUCH_TARGET)),
                        )
                        .clicked()
                    {
                        match channel.kind {
                            state::ChannelKind::Text => {
                                self.ensure_history(&channel.id, false);
                                self.state.push(Screen::ChannelChat {
                                    channel_id: channel.id.clone(),
                                    space_id: space_id.clone(),
                                });
                            }
                            state::ChannelKind::Voice => self.join_voice_channel(&channel.id),
                        }
                    }
                }
                if ui
                    .add(
                        egui::Button::new("Members")
                            .min_size(egui::vec2(ui.available_width(), screens::TOUCH_TARGET)),
                    )
                    .clicked()
                {
                    self.ensure_space_detail(&space_id);
                    self.state.push(Screen::Members {
                        space_id: Some(space_id.clone()),
                    });
                }
            });
        });
    }

    fn join_voice_channel(&mut self, channel_id: &str) {
        if self.ws.as_ref().map(|ws| !ws.is_alive()).unwrap_or(true) {
            self.state.status_text = "Waiting for connection… try again.".to_string();
            return;
        }
        if !self.voice.join_space_voice(channel_id) {
            self.state.status_text = "Finish the current call first.".to_string();
            return;
        }
        if !self.ws_send(ClientFrame::VoiceJoin {
            channel_id: channel_id.to_string(),
        }) {
            self.voice.leave_space_voice();
            self.state.status_text = "Waiting for connection… try again.".to_string();
            return;
        }
        self.fetch_voice_token(channel_id, false);
    }

    fn render_dms_tab(&mut self, ui: &mut egui::Ui) {
        ui.heading("Messages");
        if !self.state.bootstrapped {
            ui.label("Loading messages…");
            return;
        }
        // Incoming ring banner: answer or decline without leaving the list.
        if let Some(incoming) = self.voice.incoming_call.clone() {
            ui.separator();
            ui.label(format!("Incoming call from {}", incoming.caller_name));
            ui.horizontal(|ui| {
                if ui
                    .add(
                        egui::Button::new("Accept")
                            .min_size(egui::vec2(120.0, screens::TOUCH_TARGET)),
                    )
                    .clicked()
                {
                    self.accept_incoming_call(&incoming.dm_id);
                }
                if ui
                    .add(
                        egui::Button::new("Decline")
                            .min_size(egui::vec2(120.0, screens::TOUCH_TARGET)),
                    )
                    .clicked()
                {
                    self.decline_incoming_call(&incoming.dm_id);
                }
            });
            ui.separator();
        }
        let dms = self
            .state
            .sorted_dms()
            .into_iter()
            .cloned()
            .collect::<Vec<_>>();
        if dms.is_empty() {
            ui.label("No direct messages yet.");
            return;
        }
        egui::ScrollArea::vertical().show(ui, |ui| {
            for dm in dms {
                let preview = dm
                    .last_message_preview
                    .clone()
                    .filter(|p| !p.is_empty())
                    .map(|p| format!(" — {}", truncate(&p, 40)))
                    .unwrap_or_default();
                ui.horizontal(|ui| {
                    let title = if dm.unread {
                        format!("● {}{}", dm.name, preview)
                    } else {
                        format!("{}{}", dm.name, preview)
                    };
                    if ui
                        .add(
                            egui::Button::new(title)
                                .min_size(egui::vec2(200.0, screens::TOUCH_TARGET)),
                        )
                        .clicked()
                    {
                        self.ensure_history(&dm.id, true);
                        self.state.push(Screen::ChannelChat {
                            channel_id: dm.id.clone(),
                            space_id: "@me".to_string(),
                        });
                    }
                    let now = Self::now_ms();
                    match screens::dm_call_button(&self.voice, &dm.id, false, now) {
                        screens::DmCallButton::InCall => {
                            if ui.button(screens::DmCallButton::InCall.label()).clicked() {
                                self.state.push(Screen::VoiceFull);
                            }
                        }
                        screens::DmCallButton::Ringing => {
                            if ui.button(screens::DmCallButton::Ringing.label()).clicked() {
                                self.cancel_dm_call(&dm.id);
                            }
                        }
                        screens::DmCallButton::Idle => {
                            if ui.button(screens::DmCallButton::Idle.label()).clicked() {
                                self.start_dm_call(&dm.id);
                            }
                        }
                        screens::DmCallButton::Busy => {
                            ui.add_enabled(false, egui::Button::new("Unavailable"));
                        }
                    }
                });
            }
        });
    }

    fn start_dm_call(&mut self, dm_id: &str) {
        if self.ws.as_ref().map(|ws| !ws.is_alive()).unwrap_or(true) {
            self.state.status_text = "Waiting for connection… try again.".to_string();
            return;
        }
        let now = Self::now_ms();
        if !self.voice.can_start_dm_call(dm_id, now) {
            self.state.status_text = "Finish the current call first.".to_string();
            return;
        }
        // The WS frame goes first: a refused send never arms the mic or
        // flips local state.
        if !self.ws_send(ClientFrame::DmCallStart {
            dm_channel_id: dm_id.to_string(),
        }) {
            self.state.status_text = "Waiting for connection… try again.".to_string();
            return;
        }
        if self.voice.start_dm_call(dm_id, now) {
            self.fetch_voice_token(dm_id, true);
        }
    }

    fn cancel_dm_call(&mut self, dm_id: &str) {
        let now = Self::now_ms();
        self.voice.cancel_outgoing_dm_call(dm_id, now);
        self.ws_send(ClientFrame::DmCallEnd {
            dm_channel_id: dm_id.to_string(),
        });
    }

    fn accept_incoming_call(&mut self, dm_id: &str) {
        if !self.ws_send(ClientFrame::DmCallAccept {
            dm_channel_id: dm_id.to_string(),
        }) {
            self.state.status_text = "Waiting for connection… try again.".to_string();
            return;
        }
        self.voice.accept_dm_call(dm_id);
        self.fetch_voice_token(dm_id, true);
    }

    fn decline_incoming_call(&mut self, dm_id: &str) {
        // Refusal is scoped to the ringing DM before the send, so declining
        // can never disturb another call.
        self.voice.refuse_dm_call(dm_id);
        self.ws_send(ClientFrame::DmCallReject {
            dm_channel_id: dm_id.to_string(),
        });
        self.state.status_text = "Call declined.".to_string();
    }

    fn render_you_tab(&mut self, ui: &mut egui::Ui) {
        ui.heading("You");
        let name = self
            .state
            .session
            .as_ref()
            .map(|s| s.display().to_string())
            .unwrap_or_else(|| "you".to_string());
        ui.label(format!("@{name}"));
        if self.is_admin {
            ui.label("Instance admin");
        }
        for (label, screen) in [
            ("Edit profile", Screen::SettingsAccount),
            ("Friends", Screen::Friends),
            ("Voice & video", Screen::SettingsVoice),
            ("Settings", Screen::Settings),
        ] {
            if ui
                .add(
                    egui::Button::new(label)
                        .min_size(egui::vec2(ui.available_width(), screens::TOUCH_TARGET)),
                )
                .clicked()
            {
                self.state.push(screen);
            }
        }
        if ui
            .add(
                egui::Button::new("Log out")
                    .min_size(egui::vec2(ui.available_width(), screens::TOUCH_TARGET)),
            )
            .clicked()
        {
            self.logout(ui.ctx());
        }
    }

    fn render_channel_chat(&mut self, ui: &mut egui::Ui, channel_id: &str, space_id: &str) {
        let is_dm = space_id == "@me";
        let title = if is_dm {
            self.state
                .dms
                .iter()
                .find(|dm| dm.id == channel_id)
                .map(|dm| dm.name.clone())
                .unwrap_or_else(|| "Direct message".to_string())
        } else {
            self.state
                .channels
                .iter()
                .find(|c| c.id == channel_id)
                .map(|c| format!("#{}", c.name))
                .unwrap_or_else(|| "Channel".to_string())
        };
        if screens::screen_header(ui, &title) {
            self.state.pop();
            return;
        }
        if !self.history_loaded.contains(channel_id) {
            self.ensure_history(channel_id, is_dm);
        }
        let messages = self
            .state
            .messages_for(channel_id)
            .into_iter()
            .cloned()
            .collect::<Vec<_>>();
        let unread_message = self
            .state
            .dm_by_id(channel_id)
            .filter(|dm| is_dm && dm.unread)
            .and_then(|dm| dm.last_message_id.clone());
        let mut read_ack = None;
        // Failed rows to offer an inline retry for (collected before the
        // scroll closure borrows `ui` mutably alongside `self`).
        let failed: Vec<(String, String)> = messages
            .iter()
            .filter(|m| m.failed)
            .map(|m| (m.id.clone(), m.body.clone()))
            .collect();
        egui::ScrollArea::vertical()
            .stick_to_bottom(true)
            .show(ui, |ui| {
                if messages.is_empty() && !self.history_loading.contains(channel_id) {
                    ui.label("No messages yet. Say hello.");
                }
                for message in &messages {
                    if message.failed {
                        continue;
                    }
                    let mut text = format!("{}: {}", message.author_name, message.body);
                    if message.pending {
                        text.push_str("  …");
                    }
                    ui.label(text);
                    // Passive rendering must not undo an explicit
                    // "mark unread" from a different client.
                    if !message.pending
                        && unread_message.as_deref() == Some(&message.id)
                        && ui
                            .add(
                                egui::Button::new("Mark as read")
                                    .min_size(egui::vec2(96.0, screens::TOUCH_TARGET)),
                            )
                            .clicked()
                    {
                        read_ack = Some(message.id.clone());
                    }
                }
                if self.history_loading.contains(channel_id) {
                    ui.label("Loading history…");
                }
            });
        if let Some(message_id) = read_ack {
            if self.ws_send(ClientFrame::ChannelAck {
                channel_id: channel_id.to_string(),
                message_id,
            }) {
                if let Some(dm) = self.state.dms.iter_mut().find(|dm| dm.id == channel_id) {
                    dm.unread = false;
                }
            }
        }
        // Inline retry per failed send, in its own conversation. Retrying
        // never touches the composer and never navigates anywhere.
        let mut retry: Option<(String, String)> = None;
        for (id, body) in &failed {
            ui.horizontal(|ui| {
                ui.label(format!("Not sent: {}", truncate(body, 60)));
                if ui
                    .add(
                        egui::Button::new("Retry")
                            .min_size(egui::vec2(72.0, screens::TOUCH_TARGET)),
                    )
                    .clicked()
                {
                    retry = Some((id.clone(), body.clone()));
                }
            });
        }
        if let Some((id, body)) = retry {
            self.state.messages.retain(|m| m.id != id);
            let channel = channel_id.to_string();
            self.send_body(&channel, is_dm, &body);
        }
        ui.separator();
        // Per-conversation draft: switching chats never clobbers typing.
        let draft = self
            .drafts
            .composer_by_channel
            .entry(channel_id.to_string())
            .or_default()
            .clone();
        let mut draft = draft;
        ui.horizontal(|ui| {
            ui.text_edit_singleline(&mut draft);
            if ui
                .add(egui::Button::new("Send").min_size(egui::vec2(72.0, screens::TOUCH_TARGET)))
                .clicked()
                && !draft.trim().is_empty()
            {
                let id = channel_id.to_string();
                self.send_body(&id, is_dm, draft.trim());
                draft.clear();
            }
        });
        self.drafts
            .composer_by_channel
            .insert(channel_id.to_string(), draft);
        if is_dm && self.is_group_dm(channel_id) && ui.button("Group info").clicked() {
            self.state.push(Screen::GroupDmInfo {
                channel_id: channel_id.to_string(),
            });
        }
    }

    fn is_group_dm(&self, dm_id: &str) -> bool {
        self.state
            .dm_by_id(dm_id)
            .is_some_and(|dm| dm.member_ids.len() > 2)
    }

    fn render_friends(&mut self, ui: &mut egui::Ui) {
        if screens::screen_header(ui, "Friends") {
            self.state.pop();
            return;
        }
        ui.horizontal(|ui| {
            ui.text_edit_singleline(&mut self.drafts.friend_username);
            if ui
                .add(egui::Button::new("Add").min_size(egui::vec2(72.0, screens::TOUCH_TARGET)))
                .clicked()
                && self.friend_rx.is_none()
            {
                let username = self.drafts.friend_username.trim().to_string();
                if username.is_empty() {
                    self.state.status_text = "Enter an exact username.".to_string();
                } else if let Some(client) = self.authed_client() {
                    let (tx, rx) = channel();
                    self.friend_rx = Some(rx);
                    std::thread::spawn(move || {
                        let _ = tx.send(
                            client
                                .send_friend_request(&username)
                                .map_err(|e| e.to_string()),
                        );
                    });
                }
            }
        });
        ui.separator();
        if self.state.friends.is_empty() {
            ui.label("No friends yet. Add someone by username above.");
            return;
        }
        egui::ScrollArea::vertical().show(ui, |ui| {
            for friend in self.state.friends.clone() {
                let dot = if friend.online { "● " } else { "" };
                ui.horizontal(|ui| {
                    if ui
                        .add(
                            egui::Button::new(format!("{dot}{}", friend.display()))
                                .min_size(egui::vec2(180.0, screens::TOUCH_TARGET)),
                        )
                        .clicked()
                    {
                        let id = friend.id.clone();
                        self.state.push(Screen::UserProfile { user_id: id });
                    }
                    if ui
                        .add(
                            egui::Button::new("DM")
                                .min_size(egui::vec2(64.0, screens::TOUCH_TARGET)),
                        )
                        .clicked()
                        && self.dm_create_rx.is_none()
                    {
                        self.open_dm_with(&friend.id);
                    }
                });
            }
        });
    }

    /// Opens the 1-on-1 DM with a user, creating it when missing — the same
    /// `POST /dm { userId }` reuse-or-create the web new-DM flow uses.
    fn open_dm_with(&mut self, user_id: &str) {
        if let Some(dm) = self
            .state
            .dms
            .iter()
            .find(|dm| dm.member_ids.len() == 2 && dm.member_ids.iter().any(|id| id == user_id))
        {
            let id = dm.id.clone();
            self.ensure_history(&id, true);
            self.state.push(Screen::ChannelChat {
                channel_id: id,
                space_id: "@me".to_string(),
            });
            return;
        }
        let Some(client) = self.authed_client() else {
            self.state.status_text = "Sign in first.".to_string();
            return;
        };
        let user = user_id.to_string();
        let (tx, rx) = channel();
        self.dm_create_rx = Some(rx);
        std::thread::spawn(move || {
            let _ = tx.send(client.create_dm(&user).map_err(|e| e.to_string()));
        });
    }

    fn render_settings_hub(&mut self, ui: &mut egui::Ui) {
        if screens::screen_header(ui, "Settings") {
            self.state.pop();
            return;
        }
        for (label, screen) in [
            ("Account", Screen::SettingsAccount),
            ("Appearance", Screen::SettingsAppearance),
            ("Voice & video", Screen::SettingsVoice),
            ("Privacy", Screen::SettingsPrivacy),
            ("Instance", Screen::SettingsInstance),
        ] {
            if ui
                .add(
                    egui::Button::new(label)
                        .min_size(egui::vec2(ui.available_width(), screens::TOUCH_TARGET)),
                )
                .clicked()
            {
                self.state.push(screen);
            }
        }
    }

    fn render_account(&mut self, ui: &mut egui::Ui) {
        if screens::screen_header(ui, "Account") {
            self.state.pop();
            return;
        }
        if let Some(session) = self.state.session.clone() {
            ui.label(format!("Username: {}", session.username));
            ui.label(format!("Display name: {}", session.display()));
            ui.label(format!("User id: {}", session.user_id));
            if self.is_admin {
                ui.label("Role: instance admin");
            }
        }
        if ui
            .add(
                egui::Button::new("Log out")
                    .min_size(egui::vec2(ui.available_width(), screens::TOUCH_TARGET)),
            )
            .clicked()
        {
            self.logout(ui.ctx());
        }
    }

    fn render_appearance(&mut self, ui: &mut egui::Ui) {
        if screens::screen_header(ui, "Appearance") {
            self.state.pop();
            return;
        }
        ui.label("Theme (applies immediately)");
        let dark = self.drafts.theme() == AppTheme::Dark;
        if ui
            .add(
                egui::Button::new(if dark { "● Dark" } else { "○ Dark" })
                    .min_size(egui::vec2(ui.available_width(), screens::TOUCH_TARGET)),
            )
            .clicked()
        {
            self.drafts.theme = Some(AppTheme::Dark);
        }
        if ui
            .add(
                egui::Button::new(if dark { "○ Light" } else { "● Light" })
                    .min_size(egui::vec2(ui.available_width(), screens::TOUCH_TARGET)),
            )
            .clicked()
        {
            self.drafts.theme = Some(AppTheme::Light);
        }
    }

    fn render_voice_settings(&mut self, ui: &mut egui::Ui) {
        if screens::screen_header(ui, "Voice & video") {
            self.state.pop();
            return;
        }
        let mut changed = false;
        changed |= ui.checkbox(&mut self.voice.muted, "Muted").changed();
        changed |= ui.checkbox(&mut self.voice.deafened, "Deafened").changed();
        changed |= ui
            .checkbox(&mut self.voice.camera_on, "Camera on")
            .changed();
        if changed {
            self.broadcast_voice_status();
        }
        ui.label(VOICE_PREVIEW_NOTICE);
    }

    fn render_privacy(&mut self, ui: &mut egui::Ui) {
        if screens::screen_header(ui, "Privacy") {
            self.state.pop();
            return;
        }
        // Unknown until the profile loads: never render assumed values as
        // if they were saved, and fetch the profile once on demand.
        if self.drafts.discoverable.is_none() || self.drafts.show_activity.is_none() {
            if self.me_rx.is_none() {
                if let Some(client) = self.authed_client() {
                    let (tx, rx) = channel();
                    self.me_rx = Some(rx);
                    std::thread::spawn(move || {
                        let _ = tx.send(client.me().map_err(|e| e.to_string()));
                    });
                }
            }
            ui.label("Loading privacy settings…");
            return;
        }
        let mut discoverable = self.drafts.discoverable.unwrap_or(true);
        let mut show_activity = self.drafts.show_activity.unwrap_or(true);
        let saved = self.privacy_saved;
        let mut changed = false;
        changed |= ui
            .checkbox(&mut discoverable, "Discoverable by username")
            .changed();
        changed |= ui.checkbox(&mut show_activity, "Show activity").changed();
        if changed {
            self.drafts.discoverable = Some(discoverable);
            self.drafts.show_activity = Some(show_activity);
        }
        if changed && self.privacy_rx.is_none() {
            if let Some(patch) = privacy_patch(saved, discoverable, show_activity) {
                if let Some(client) = self.authed_client() {
                    let (tx, rx) = channel();
                    self.privacy_rx = Some(rx);
                    std::thread::spawn(move || {
                        let result = client.update_me(patch).map_err(|e| e.to_string());
                        let _ = tx.send(result);
                    });
                }
            }
        }
    }

    fn render_instance(&mut self, ui: &mut egui::Ui) {
        if screens::screen_header(ui, "Instance") {
            self.state.pop();
            return;
        }
        ui.label(format!(
            "Name: {}",
            self.state.instance_name.as_deref().unwrap_or("—")
        ));
        ui.label(format!(
            "Version: {}",
            self.state.instance_version.as_deref().unwrap_or("—")
        ));
        ui.label(format!(
            "URL: {}",
            self.state
                .instance
                .as_ref()
                .map(|i| i.base_url.as_str())
                .unwrap_or("—")
        ));
        if ui
            .add(
                egui::Button::new("Change instance")
                    .min_size(egui::vec2(ui.available_width(), screens::TOUCH_TARGET)),
            )
            .clicked()
        {
            self.logout(ui.ctx());
            self.state.instance = None;
        }
    }

    fn render_members(&mut self, ui: &mut egui::Ui, space_id: Option<&str>) {
        if screens::screen_header(ui, "Members") {
            self.state.pop();
            return;
        }
        if let Some(space) = space_id {
            self.ensure_space_detail(space);
        }
        let members: Vec<state::SpaceMember> = space_id
            .map(|space| self.state.members_for(space).to_vec())
            .unwrap_or_default();
        let online = members.iter().filter(|m| m.online).count();
        ui.label(format!("{online} online"));
        if members.is_empty() {
            ui.label("Loading members…");
            return;
        }
        egui::ScrollArea::vertical().show(ui, |ui| {
            for member in members {
                let role = member.role.clone().unwrap_or_else(|| "member".to_string());
                let label = if member.online {
                    format!("{} · {role}", member.name)
                } else {
                    format!("{} · offline", member.name)
                };
                if ui
                    .add(
                        egui::Button::new(label)
                            .min_size(egui::vec2(ui.available_width(), screens::TOUCH_TARGET)),
                    )
                    .clicked()
                {
                    self.state.push(Screen::UserProfile {
                        user_id: member.id.clone(),
                    });
                }
            }
        });
    }

    fn render_group_dm_info(&mut self, ui: &mut egui::Ui, channel_id: &str) {
        if screens::screen_header(ui, "Group info") {
            self.state.pop();
            return;
        }
        let (name, is_owner, member_ids) = self
            .state
            .dm_by_id(channel_id)
            .map(|dm| {
                (
                    dm.name.clone(),
                    dm.owner_id.as_deref()
                        == self.state.session.as_ref().map(|s| s.user_id.as_str()),
                    dm.member_ids.clone(),
                )
            })
            .unwrap_or_else(|| ("Group".to_string(), false, Vec::new()));
        ui.heading(name.as_str());
        ui.label(format!("{} members", member_ids.len()));
        egui::ScrollArea::vertical().show(ui, |ui| {
            for member_id in member_ids {
                let label = self.state.display_name_for(&member_id);
                if ui
                    .add(
                        egui::Button::new(label)
                            .min_size(egui::vec2(ui.available_width(), screens::TOUCH_TARGET)),
                    )
                    .clicked()
                {
                    self.state.push(Screen::UserProfile { user_id: member_id });
                }
            }
        });
        ui.separator();
        if is_owner {
            ui.horizontal(|ui| {
                ui.text_edit_singleline(&mut self.drafts.dm_rename);
                if ui
                    .add(
                        egui::Button::new("Rename")
                            .min_size(egui::vec2(88.0, screens::TOUCH_TARGET)),
                    )
                    .clicked()
                    && self.rename_rx.is_none()
                {
                    let name = self.drafts.dm_rename.trim().to_string();
                    if name.is_empty() {
                        self.state.status_text = "Enter a group name.".to_string();
                    } else if let Some(client) = self.authed_client() {
                        let dm = channel_id.to_string();
                        let (tx, rx) = channel();
                        self.rename_rx = Some(rx);
                        std::thread::spawn(move || {
                            let result = client.rename_dm(&dm, &name).map_err(|e| e.to_string());
                            let _ = tx.send((dm, name, result));
                        });
                    }
                }
            });
        }
        if ui
            .add(
                egui::Button::new("Leave group")
                    .min_size(egui::vec2(ui.available_width(), screens::TOUCH_TARGET)),
            )
            .clicked()
            && self.leave_rx.is_none()
        {
            if let Some(client) = self.authed_client() {
                let dm = channel_id.to_string();
                let (tx, rx) = channel();
                self.leave_rx = Some(rx);
                std::thread::spawn(move || {
                    let result = client.leave_dm(&dm).map_err(|e| e.to_string());
                    let _ = tx.send((dm, result));
                });
            }
        }
    }

    fn render_user_profile(&mut self, ui: &mut egui::Ui, user_id: &str) {
        if screens::screen_header(ui, "Profile") {
            self.state.pop();
            return;
        }
        ui.label(self.state.display_name_for(user_id));
        ui.label(format!("id: {user_id}"));
        ui.label("Display name, custom status, bio and mutual spaces.");
    }

    fn render_mini_bar(&mut self, ui: &mut egui::Ui) {
        ui.horizontal(|ui| {
            let name = self
                .voice
                .current_voice_channel_id
                .clone()
                .or(self.voice.active_dm_call.clone())
                .unwrap_or_else(|| "voice".to_string());
            ui.label(format!("{name} · Signaling only"));
            if ui.button("Open").clicked() {
                self.state.push(Screen::VoiceFull);
            }
            if ui
                .button(if self.voice.muted { "Unmute" } else { "Mute" })
                .clicked()
            {
                self.voice.toggle_mic();
                self.broadcast_voice_status();
            }
            if ui.button("Leave").clicked() {
                self.leave_current_call();
            }
        });
    }

    fn leave_current_call(&mut self) {
        if let Some(dm) = self.voice.active_dm_call.clone() {
            self.ws_send(ClientFrame::DmCallEnd {
                dm_channel_id: dm.clone(),
            });
            self.voice.end_dm_call(&dm);
        } else if self.voice.current_voice_channel_id.is_some() {
            self.ws_send(ClientFrame::VoiceLeave);
            self.voice.leave_space_voice();
        } else if let Some(outgoing) = self.voice.outgoing_call.clone() {
            self.ws_send(ClientFrame::DmCallEnd {
                dm_channel_id: outgoing.clone(),
            });
            self.voice
                .cancel_outgoing_dm_call(&outgoing, Self::now_ms());
        }
        self.voice_session = None;
    }

    fn render_voice_full(&mut self, ui: &mut egui::Ui) {
        if screens::screen_header(ui, "Voice") {
            self.state.pop();
            return;
        }
        let channel = self
            .voice
            .current_voice_channel_id
            .clone()
            .or(self.voice.active_dm_call.clone())
            .unwrap_or_else(|| "voice".to_string());
        let count = self.voice.participant_count(&channel);
        ui.label(format!("{channel} · {count} here"));
        ui.label(VOICE_PREVIEW_NOTICE);
        egui::ScrollArea::vertical().show(ui, |ui| {
            let participants = self
                .voice
                .participants
                .get(&channel)
                .cloned()
                .unwrap_or_default();
            if participants.is_empty() {
                ui.label("No participants reported yet.");
            }
            for id in participants {
                ui.label(format!("● {}", self.state.display_name_for(&id)));
            }
        });
        ui.separator();
        ui.horizontal(|ui| {
            if ui
                .add(
                    egui::Button::new(if self.voice.muted { "Unmute" } else { "Mute" })
                        .min_size(egui::vec2(88.0, screens::TOUCH_TARGET)),
                )
                .clicked()
            {
                self.voice.toggle_mic();
                self.broadcast_voice_status();
            }
            if ui
                .add(
                    egui::Button::new(if self.voice.deafened {
                        "Undeafen"
                    } else {
                        "Deafen"
                    })
                    .min_size(egui::vec2(88.0, screens::TOUCH_TARGET)),
                )
                .clicked()
            {
                self.voice.toggle_deafen();
                self.broadcast_voice_status();
            }
            if ui
                .add(egui::Button::new("Camera").min_size(egui::vec2(88.0, screens::TOUCH_TARGET)))
                .clicked()
            {
                self.voice.camera_on = !self.voice.camera_on;
                self.broadcast_voice_status();
            }
            if ui
                .add(egui::Button::new("Leave").min_size(egui::vec2(88.0, screens::TOUCH_TARGET)))
                .clicked()
            {
                self.leave_current_call();
                self.state.pop();
            }
        });
    }
}

fn privacy_patch(
    saved: Option<(bool, bool)>,
    discoverable: bool,
    show_activity: bool,
) -> Option<serde_json::Value> {
    let (saved_d, saved_s) = saved?;
    if discoverable != saved_d && show_activity != saved_s {
        return Some(serde_json::json!({
            "discoverable": discoverable,
            "showActivity": show_activity,
        }));
    }
    if discoverable != saved_d {
        return Some(serde_json::json!({ "discoverable": discoverable }));
    }
    if show_activity != saved_s {
        return Some(serde_json::json!({ "showActivity": show_activity }));
    }
    None
}

fn truncate(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_string();
    }
    let kept: String = text.chars().take(max.saturating_sub(1)).collect();
    format!("{kept}…")
}

/// Android entry point: the OS loads the cdylib and calls `android_main`
/// (NativeActivity). Hands the `AndroidApp` to eframe, exactly like the
/// upstream `hello_android` eframe example ("Rust" ABI, unmangled).
/// Compiled only for the Android target; desktop previews use `main.rs`.
/// `cargo apk build --release --lib` packages this library — the `main.rs`
/// binary is never shipped on device.
#[cfg(target_os = "android")]
#[no_mangle]
fn android_main(app: winit::platform::android::activity::AndroidApp) {
    android_logger::init_once(
        android_logger::Config::default().with_max_level(log::LevelFilter::Info),
    );
    log::info!("Veyvox starting on Android");
    let locale = app.config().language().unwrap_or_default();
    let options = eframe::NativeOptions {
        android_app: Some(app),
        ..Default::default()
    };
    if let Err(err) = eframe::run_native(
        "Veyvox",
        options,
        Box::new(move |cc| {
            Ok(Box::new(VeyvoxApp::with_locale(cc, &locale)) as Box<dyn eframe::App>)
        }),
    ) {
        log::error!("Veyvox exited with error: {err:?}");
    }
}

#[cfg(test)]
#[allow(clippy::field_reassign_with_default)]
mod tests {
    use super::*;

    #[test]
    fn short_name_uses_initials() {
        assert_eq!(short_name("General Chat"), "GC");
        assert_eq!(short_name("solo"), "s");
    }

    #[test]
    fn truncate_caps_preview() {
        assert_eq!(truncate("hi", 40), "hi");
        assert_eq!(truncate("abcdefghijklmnopqrstuvwxyz", 5), "abcd…");
    }

    #[test]
    fn login_needs_instance_and_credentials() {
        let mut app = VeyvoxApp::default();
        let ctx = egui::Context::default();
        app.drafts.instance_url = "not a url with spaces and \u{1}".to_string();
        app.select_login_server(&ctx);
        app.start_login(&ctx);
        assert!(app.state.status_text.contains("server"));
        assert!(app.state.instance.is_none());
    }

    #[test]
    fn selecting_a_server_does_not_submit_credentials() {
        let mut app = VeyvoxApp::default();
        let ctx = egui::Context::default();
        app.drafts.instance_url = "chat.example.com".into();
        app.drafts.username = "remembered".into();
        app.drafts.password = "stale-password".into();
        app.select_login_server(&ctx);
        assert_eq!(
            app.state.instance.as_ref().unwrap().base_url,
            "https://chat.example.com"
        );
        assert!(app.login_rx.is_none());
        assert!(app.drafts.password.is_empty());
        let password_id = onboarding::Field::Password.id();
        egui::TextEdit::store_state(&ctx, password_id, Default::default());
        app.change_login_server(&ctx);
        assert!(app.state.instance.is_none());
        assert!(app.drafts.username.is_empty());
        assert!(egui::TextEdit::load_state(&ctx, password_id).is_none());
    }

    #[test]
    fn logout_then_selecting_a_different_server_discards_credentials_and_editor_state() {
        let mut app = VeyvoxApp::default();
        let ctx = egui::Context::default();
        app.drafts.instance_url = "server-a.example".into();
        app.select_login_server(&ctx);
        app.drafts.username = "server-a-user".into();
        app.drafts.password = "server-a-password".into();
        let fields = [onboarding::Field::Username, onboarding::Field::Password];
        for field in fields {
            egui::TextEdit::store_state(&ctx, field.id(), Default::default());
            assert!(egui::TextEdit::load_state(&ctx, field.id()).is_some());
        }
        app.logout(&ctx);
        assert!(app.drafts.username.is_empty());
        assert!(app.state.status_text.is_empty());
        assert!(fields
            .into_iter()
            .all(|field| egui::TextEdit::load_state(&ctx, field.id()).is_none()));
        app.drafts.instance_url = "server-b.example".into();
        app.select_login_server(&ctx);
        assert_eq!(
            app.state.instance.as_ref().unwrap().base_url,
            "https://server-b.example",
        );
        assert!(app.drafts.username.is_empty());
        assert!(app.drafts.password.is_empty());
    }

    #[test]
    fn onboard_login_button_is_visible_in_a_phone_viewport() {
        let ctx = egui::Context::default();
        onboarding::install_fonts(&ctx);
        let mut app = VeyvoxApp::default();
        app.drafts.instance_url = "chat.example.com".into();
        app.select_login_server(&ctx);
        let viewport = egui::Rect::from_min_size(egui::Pos2::ZERO, egui::vec2(390.0, 780.0));
        let output = ctx.run(
            egui::RawInput {
                screen_rect: Some(viewport),
                ..Default::default()
            },
            |ctx| app.render_login(ctx),
        );
        let button = output
            .shapes
            .iter()
            .find_map(|clipped| match &clipped.shape {
                egui::Shape::Text(shape) if shape.galley.text() == "Log In" => {
                    Some((shape.visual_bounding_rect(), clipped.clip_rect))
                }
                _ => None,
            });
        let (bounds, clip) = button.expect("login button label is rendered");
        assert!(viewport.intersect(clip).contains_rect(bounds));
    }

    #[test]
    fn stale_token_answers_are_dropped() {
        let mut app = VeyvoxApp::default();
        // Attempt 2 is current; an answer for attempt 1 must not open voice.
        app.voice_attempt = 2;
        app.voice.start_dm_call("d1", 0);
        app.apply_token_result("d1", true, 1, Ok(("t".into(), "u".into())));
        assert_eq!(app.voice.outgoing_call.as_deref(), Some("d1"));
        assert!(app.voice_session.is_none());
        assert!(app.state.stack.is_empty());
    }

    #[test]
    fn outgoing_token_holds_creds_and_keeps_ringing() {
        let mut app = VeyvoxApp::default();
        app.voice_attempt = 3;
        app.voice.start_dm_call("d1", 0);
        app.apply_token_result(
            "d1",
            true,
            3,
            Ok(("tok".into(), "wss://livekit.example".into())),
        );
        // Credentials are held, but nothing claims a connected call: the
        // outgoing ring is still pending the peer's answer.
        assert_eq!(app.voice.outgoing_call.as_deref(), Some("d1"));
        assert_eq!(app.voice.active_dm_call, None);
        assert!(app.state.stack.is_empty());
        assert!(app.voice_session.is_some());
        assert!(app.state.status_text.contains("Ringing"));
    }

    #[test]
    fn accepted_incoming_token_opens_voice() {
        let mut app = VeyvoxApp::default();
        app.voice_attempt = 1;
        app.voice.ring_incoming(IncomingCall {
            dm_id: "d1".into(),
            caller_id: "u9".into(),
            caller_name: "Ann".into(),
        });
        app.voice.accept_dm_call("d1");
        app.apply_token_result(
            "d1",
            true,
            1,
            Ok(("tok".into(), "wss://livekit.example".into())),
        );
        assert_eq!(app.voice.active_dm_call.as_deref(), Some("d1"));
        assert_eq!(app.state.top(), Some(&Screen::VoiceFull));
        assert!(app.voice_session.is_some());
        assert!(app
            .state
            .status_text
            .contains("audio and video are unavailable"));
    }

    #[test]
    fn signaled_voice_calls_do_not_claim_media_connected() {
        let mut app = VeyvoxApp::default();
        assert!(app.voice.start_dm_call("d1", 0));
        app.apply_token_result("d1", true, 0, Ok(("tok".into(), "url".into())));
        app.apply_server_frame(ServerFrame::DmCallAccepted {
            dm_channel_id: "d1".into(),
        });
        assert!(app
            .state
            .status_text
            .contains("audio and video are unavailable"));

        let mut app = VeyvoxApp::default();
        assert!(app.voice.join_space_voice("v1"));
        app.apply_token_result("v1", false, 0, Ok(("tok".into(), "url".into())));
        assert!(app
            .state
            .status_text
            .contains("audio and video are unavailable"));
    }

    #[test]
    fn ready_invalidates_old_history_and_keeps_pending_sends() {
        let mut app = VeyvoxApp::default();
        let (tx, rx) = channel();
        app.history_loaded.insert("seen".into());
        app.history_loading.insert("loading".into());
        app.history_jobs.push(PendingHistory {
            channel_id: "loading".into(),
            rx,
        });
        let confirmed = ChatMessage {
            id: "1".into(),
            channel_id: "seen".into(),
            author_id: "a".into(),
            author_name: "A".into(),
            body: "old".into(),
            created_at: millis_to_dt(1),
            pending: false,
            failed: false,
        };
        let mut pending = confirmed.clone();
        pending.id = "pending".into();
        pending.pending = true;
        app.state.messages.extend([confirmed, pending]);
        app.apply_server_frame(ws::parse_server_frame(
            r#"{"type":"ready","user":{"id":"me","username":"me"}}"#,
        ));
        assert!(app.history_loaded.is_empty());
        assert!(app.history_loading.is_empty());
        assert!(tx.send(Err("stale".into())).is_err());
        assert_eq!(app.state.messages.len(), 1);
        assert!(app.state.messages[0].pending);
    }

    #[test]
    fn rest_history_and_earlier_live_events_render_in_chronological_order() {
        let mut app = VeyvoxApp::default();
        app.apply_server_frame(ws::parse_server_frame(
            r#"{"type":"dm_message_created","message":{"id":"100","userId":"peer","dmChannelId":"d","createdAt":1000,"content":"live"}}"#,
        ));
        let latest = app.state.messages[0].clone();
        let older = ChatMessage {
            id: "99".into(),
            created_at: millis_to_dt(999),
            ..latest.clone()
        };
        let (tx, rx) = channel();
        app.history_jobs.push(PendingHistory {
            channel_id: "d".into(),
            rx,
        });
        tx.send(Ok(("d".into(), true, vec![older, latest])))
            .unwrap();
        app.poll_jobs();
        let messages = app.state.messages_for("d");
        assert_eq!(
            messages.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(),
            ["99", "100"],
        );
    }

    #[test]
    fn rendering_an_unread_dm_does_not_send_an_ack_without_input() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let (done, wait) = channel();
        let server = std::thread::spawn(move || {
            let (tcp, _) = listener.accept().unwrap();
            tcp.set_read_timeout(Some(std::time::Duration::from_secs(3)))
                .unwrap();
            let mut socket = tungstenite::accept(tcp).unwrap();
            socket.read().unwrap();
            socket
                .send(tungstenite::Message::Text(r#"{"type":"pong"}"#.into()))
                .unwrap();
            let _ = wait.recv();
        });
        let (tx, rx) = channel();
        let mut app = VeyvoxApp {
            ws: Some(ws::spawn_ws(
                format!("ws://{address}/ws"),
                "test".into(),
                tx,
            )),
            ..Default::default()
        };
        rx.recv_timeout(std::time::Duration::from_secs(3)).unwrap();
        app.state.dms.push(state::Dm {
            id: "d".into(),
            ..Default::default()
        });
        for wire in [
            r#"{"type":"dm_message_created","message":{"id":"100","userId":"peer","dmChannelId":"d","createdAt":1000,"content":"new"}}"#,
            r#"{"type":"channel_ack","channelId":"d","messageId":"100"}"#,
            r#"{"type":"mark_unread","channelId":"d","messageId":"0"}"#,
        ] {
            app.apply_server_frame(ws::parse_server_frame(wire));
        }
        app.history_loaded.insert("d".into());
        let ctx = egui::Context::default();
        let _ = ctx.run(egui::RawInput::default(), |ctx| {
            egui::CentralPanel::default().show(ctx, |ui| {
                app.render_channel_chat(ui, "d", "@me");
            });
        });
        assert!(app.state.dm_by_id("d").unwrap().unread);
        done.send(()).unwrap();
        server.join().unwrap();
    }

    #[test]
    fn live_dm_updates_order_and_read_status_without_rewinding() {
        let mut app = VeyvoxApp::default();
        app.state.dms.push(state::Dm {
            id: "d".into(),
            ..Default::default()
        });
        app.apply_server_frame(ws::parse_server_frame(r#"{"type":"dm_message_created","message":{"id":"100","userId":"peer","dmChannelId":"d","createdAt":1000,"content":"new"}}"#));
        let dm = app.state.dm_by_id("d").unwrap();
        assert_eq!(dm.last_message_id.as_deref(), Some("100"));
        assert_eq!(dm.last_message_at, Some(millis_to_dt(1000)));
        assert!(dm.unread);
        app.apply_server_frame(ws::parse_server_frame(
            r#"{"type":"channel_ack","channelId":"d","messageId":"100"}"#,
        ));
        assert!(!app.state.dm_by_id("d").unwrap().unread);
        app.apply_server_frame(ws::parse_server_frame(r#"{"type":"dm_message_created","message":{"id":"99","userId":"peer","dmChannelId":"d","createdAt":999,"content":"late"}}"#));
        app.apply_server_frame(ws::parse_server_frame(r#"{"type":"dm_message_created","message":{"id":"100","userId":"peer","dmChannelId":"d","createdAt":1000,"content":"new"}}"#));
        let dm = app.state.dm_by_id("d").unwrap();
        assert!(!dm.unread);
        assert_eq!(dm.last_message_preview.as_deref(), Some("new"));
    }

    #[test]
    fn cancelled_ring_ignores_its_late_token() {
        let mut app = VeyvoxApp::default();
        app.voice_attempt = 1;
        app.voice.start_dm_call("d1", 0);
        app.voice.cancel_outgoing_dm_call("d1", 1_000);
        app.apply_token_result("d1", true, 1, Ok(("t".into(), "u".into())));
        assert_eq!(app.voice.active_dm_call, None);
        assert!(app.voice_session.is_none());
        assert!(app.state.stack.is_empty());
    }

    #[test]
    fn failed_token_cleans_up_the_half_call() {
        let mut app = VeyvoxApp::default();
        app.voice_attempt = 1;
        app.voice.start_dm_call("d1", 0);
        app.apply_token_result("d1", true, 1, Err("network_error: refused".to_string()));
        assert_eq!(app.voice.outgoing_call, None);
        assert_eq!(app.voice.active_dm_call, None);
        assert!(app.voice_session.is_none());
        assert!(app.state.status_text.contains("Voice failed"));
    }

    #[test]
    fn logout_clears_secrets_receivers_and_drafts() {
        let mut app = VeyvoxApp::default();
        app.drafts.password = "secret".to_string();
        app.drafts
            .composer_by_channel
            .insert("c1".into(), "half-typed".to_string());
        app.history_loaded.insert("c1".into());
        app.session_epoch = 4;
        app.logout(&egui::Context::default());
        assert!(app.drafts.password.is_empty());
        assert!(app.drafts.composer_by_channel.is_empty());
        assert!(app.history_loaded.is_empty());
        assert!(app.login_rx.is_none());
        assert!(app.voice_fetch.is_none());
        assert_eq!(app.session_epoch, 5);
        assert!(app.state.session.is_none());
    }

    #[test]
    fn privacy_patch_sends_only_the_changed_flag() {
        assert_eq!(
            privacy_patch(Some((true, true)), false, true),
            Some(serde_json::json!({ "discoverable": false }))
        );
        assert_eq!(
            privacy_patch(Some((true, true)), true, false),
            Some(serde_json::json!({ "showActivity": false }))
        );
        assert_eq!(privacy_patch(Some((true, true)), true, true), None);
        assert_eq!(privacy_patch(None, false, true), None);
    }

    #[test]
    fn adopt_replaces_pending_echo_by_body() {
        let mut state = AppState::new();
        state.session = Some(AuthSession {
            user_id: "me".into(),
            username: "me".into(),
            display_name: None,
            token: "t".into(),
        });
        let local = ChatMessage::new("c1", "me", "me", "hello");
        assert!(local.pending);
        state.upsert_message(local);
        let confirmed = ChatMessage {
            id: "server-1".into(),
            channel_id: "c1".into(),
            author_id: "me".into(),
            author_name: "me".into(),
            body: "hello".into(),
            created_at: chrono::Utc::now(),
            pending: false,
            failed: false,
        };
        adopt_or_insert(&mut state, confirmed, "me");
        assert_eq!(state.messages.len(), 1);
        assert_eq!(state.messages[0].id, "server-1");
        assert!(!state.messages[0].pending);
    }

    #[test]
    fn apply_boot_selects_first_space_and_marks_ready() {
        let mut state = AppState::new();
        let session = AuthSession {
            user_id: "me".into(),
            username: "me".into(),
            display_name: None,
            token: "t".into(),
        };
        apply_boot(
            &mut state,
            BootData {
                session,
                spaces: vec![state::Space {
                    id: "s1".into(),
                    name: "One".into(),
                    unread: false,
                }],
                channels: vec![],
                members: HashMap::new(),
                current_space_id: Some("s1".into()),
                dms: vec![],
                friends: vec![],
                instance_name: Some("Home".into()),
                instance_version: Some("1.17.17".into()),
                is_admin: false,
                discoverable: None,
                show_activity: None,
                profile_missing: false,
            },
        );
        assert!(state.bootstrapped);
        assert_eq!(state.current_space_id.as_deref(), Some("s1"));
        assert_eq!(state.instance_name.as_deref(), Some("Home"));
    }

    #[test]
    fn apply_ready_marks_unread_from_counts_and_reads() {
        let mut state = AppState::new();
        let space = state::Space {
            id: "s1".into(),
            name: "One".into(),
            unread: false,
        };
        let channel = state::Channel {
            id: "c1".into(),
            space_id: "s1".into(),
            name: "general".into(),
            kind: state::ChannelKind::Text,
            unread: false,
        };
        let dm = Dm {
            id: "d1".into(),
            name: "ann".into(),
            member_ids: vec![],
            member_names: HashMap::new(),
            owner_id: None,
            last_message_id: Some("m2".into()),
            last_message_preview: None,
            last_message_at: None,
            unread: false,
        };
        let mut counts = HashMap::new();
        counts.insert("c1".to_string(), 2);
        let mut reads = HashMap::new();
        reads.insert("d1".to_string(), "m1".to_string());
        apply_ready_catalog(
            &mut state,
            vec![(space, vec![channel], vec![])],
            vec![dm],
            &counts,
            &reads,
            "me",
        );
        assert!(state.spaces[0].unread);
        assert!(state.dms[0].unread);
    }
}
