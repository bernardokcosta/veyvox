//! App state for the Veyvox Android client.
//!
//! Mirrors the web `MobileShell` navigation model 1:1:
//! three root tabs (Spaces / DMs / You) plus a push/pop screen stack,
//! with the same screen keys as `MobileShell.screenMap` in
//! `packages/web/src/components/layout/MobileShell.tsx`.
//!
//! Data shapes mirror the shared wire contracts (`packages/shared/src/types.ts`):
//! `Space` / `Channel` (`type: text | voice`), `DmChannel` (members +
//! `lastMessage`), `MessageWithUser` / `DmMessageWithUser`, `Friend`,
//! `MemberWithUser`. The REST DTOs live in `api.rs` and convert into these.
//!
//! Android-only. No iOS branch exists anywhere in this crate.

use chrono::{DateTime, Utc};
use std::collections::HashMap;

use serde::{Deserialize, Serialize};

/// Root tabs. Same three tabs as `MobileBottomNav`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Tab {
    #[default]
    Spaces,
    Dms,
    You,
}

impl Tab {
    pub fn as_str(self) -> &'static str {
        match self {
            Tab::Spaces => "spaces",
            Tab::Dms => "dms",
            Tab::You => "you",
        }
    }
}

/// Pushed-screen keys. Mirrors `MobileShell.screenMap` exactly.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Screen {
    ChannelChat {
        channel_id: String,
        space_id: String,
    },
    Friends,
    Settings,
    SettingsAccount,
    SettingsAppearance,
    SettingsVoice,
    SettingsPrivacy,
    SettingsInstance,
    Members {
        space_id: Option<String>,
    },
    GroupDmInfo {
        channel_id: String,
    },
    VoiceFull,
    UserProfile {
        user_id: String,
    },
}

impl Screen {
    /// Canonical key, matching the web `screenMap` entry.
    pub fn key(&self) -> &'static str {
        match self {
            Screen::ChannelChat { .. } => "channel-chat",
            Screen::Friends => "friends",
            Screen::Settings => "settings",
            Screen::SettingsAccount => "settings-account",
            Screen::SettingsAppearance => "settings-appearance",
            Screen::SettingsVoice => "settings-voice",
            Screen::SettingsPrivacy => "settings-privacy",
            Screen::SettingsInstance => "settings-instance",
            Screen::Members { .. } => "members",
            Screen::GroupDmInfo { .. } => "group-dm-info",
            Screen::VoiceFull => "voice-full",
            Screen::UserProfile { .. } => "user-profile",
        }
    }
}

/// Connection to one Veyvox instance.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InstanceConfig {
    /// Base URL without trailing slash, e.g. `https://chat.example`.
    pub base_url: String,
}

impl InstanceConfig {
    /// Normalises user input the same way the Electron instance picker does:
    /// trims whitespace, prepends `https://` when no scheme is present,
    /// rejects credentials/control characters and non-http(s) schemes.
    pub fn parse(input: &str) -> Result<Self, &'static str> {
        let trimmed = input.trim();
        if trimmed.is_empty() {
            return Err("empty instance url");
        }
        if trimmed.chars().any(|c| c.is_control()) {
            return Err("control characters are not allowed");
        }
        let with_scheme = if trimmed.contains("://") {
            trimmed.to_string()
        } else {
            format!("https://{trimmed}")
        };
        let url: url::Url = with_scheme.parse().map_err(|_| "invalid url")?;
        if url.scheme() != "https" && url.scheme() != "http" {
            return Err("only http(s) instances are supported");
        }
        if !url.username().is_empty() || url.password().is_some() {
            return Err("credentials in the url are not allowed");
        }
        let mut base = format!(
            "{}://{}",
            url.scheme(),
            url.host_str().ok_or("missing host")?
        );
        if let Some(port) = url.port() {
            base.push_str(&format!(":{port}"));
        }
        Ok(Self { base_url: base })
    }

    pub fn api(&self, path: &str) -> String {
        format!("{}{}", self.base_url, path)
    }

    /// `GET /ws` upgrade URL: `http(s)://host` → `ws(s)://host/ws`.
    /// The client then sends `{ type: 'auth', token, client: 'mobile' }`.
    pub fn ws_url(&self) -> Result<String, &'static str> {
        let url: url::Url = self.base_url.parse().map_err(|_| "invalid url")?;
        let scheme = match url.scheme() {
            "https" => "wss",
            "http" => "ws",
            _ => return Err("only http(s) instances are supported"),
        };
        let mut ws = format!("{}://{}", scheme, url.host_str().ok_or("missing host")?);
        if let Some(port) = url.port() {
            ws.push_str(&format!(":{port}"));
        }
        ws.push_str("/ws");
        Ok(ws)
    }
}

/// Authenticated session: the native account id plus display details from
/// `AuthResponse.user`, and the JWT the API and WS layers bearer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AuthSession {
    pub user_id: String,
    pub username: String,
    pub display_name: Option<String>,
    pub token: String,
}

impl AuthSession {
    pub fn display(&self) -> &str {
        self.display_name.as_deref().unwrap_or(&self.username)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Space {
    pub id: String,
    pub name: String,
    pub unread: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChannelKind {
    Text,
    Voice,
}

impl ChannelKind {
    /// Maps the wire `Channel.type` (`text | voice`) onto the local kind.
    /// Unknown future types read as text so the channel stays reachable.
    pub fn from_wire(raw: &str) -> Self {
        match raw {
            "voice" => ChannelKind::Voice,
            _ => ChannelKind::Text,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Channel {
    pub id: String,
    pub space_id: String,
    pub name: String,
    pub kind: ChannelKind,
    pub unread: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SpaceMember {
    pub id: String,
    pub name: String,
    pub online: bool,
    pub role: Option<String>,
}

/// One DM conversation: members for naming/avatars, last message for the
/// preview + newest-first ordering. Mirrors `DmChannel`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct Dm {
    pub id: String,
    pub name: String,
    pub member_ids: Vec<String>,
    #[serde(default)]
    pub member_names: HashMap<String, String>,
    pub owner_id: Option<String>,
    pub last_message_id: Option<String>,
    pub last_message_preview: Option<String>,
    pub last_message_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub unread: bool,
}

impl Dm {
    /// Sort key for the DM list: newest first, DMs without messages last.
    /// Mirrors `MobileDmsScreen` ordering.
    pub fn sort_key(&self) -> (bool, i64) {
        match self.last_message_at {
            Some(ts) => (false, -ts.timestamp_millis()),
            None => (true, 0),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FriendEntry {
    pub id: String,
    pub username: String,
    pub display_name: Option<String>,
    pub online: bool,
}

impl FriendEntry {
    pub fn display(&self) -> &str {
        self.display_name.as_deref().unwrap_or(&self.username)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChatMessage {
    pub id: String,
    pub channel_id: String,
    pub author_id: String,
    pub author_name: String,
    pub body: String,
    pub created_at: DateTime<Utc>,
    /// True while the send is still in flight. Failed sends become `failed`
    /// rows with an inline retry instead, so a failure never looks stored
    /// and never touches the composer.
    pub pending: bool,
    /// True only for messages that arrived failed (kept for the retry path).
    pub failed: bool,
}

impl ChatMessage {
    pub fn new(
        channel_id: impl Into<String>,
        author_id: impl Into<String>,
        author_name: impl Into<String>,
        body: impl Into<String>,
    ) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            channel_id: channel_id.into(),
            author_id: author_id.into(),
            author_name: author_name.into(),
            body: body.into(),
            created_at: Utc::now(),
            pending: true,
            failed: false,
        }
    }
}

/// Whole-app navigation + data state. Rendered by `lib.rs`.
#[derive(Debug, Clone, Default)]
pub struct AppState {
    pub instance: Option<InstanceConfig>,
    pub session: Option<AuthSession>,
    pub instance_name: Option<String>,
    pub instance_version: Option<String>,
    pub tab: Tab,
    pub stack: Vec<Screen>,
    pub spaces: Vec<Space>,
    pub channels: Vec<Channel>,
    /// Roster cache per space id, filled by `GET /spaces/:id` (detail) and
    /// kept fresh by member WS events. The members screen renders one entry.
    pub members: HashMap<String, Vec<SpaceMember>>,
    pub current_space_id: Option<String>,
    pub dms: Vec<Dm>,
    pub friends: Vec<FriendEntry>,
    pub messages: Vec<ChatMessage>,
    pub bootstrapped: bool,
    pub status_text: String,
}

impl AppState {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set_tab(&mut self, tab: Tab) {
        self.tab = tab;
        self.stack.clear();
    }

    pub fn push(&mut self, screen: Screen) {
        self.stack.push(screen);
    }

    pub fn pop(&mut self) -> bool {
        self.stack.pop().is_some()
    }

    pub fn top(&self) -> Option<&Screen> {
        self.stack.last()
    }

    /// Unread DM count, mirroring the `MobileBottomNav` numeric badge.
    pub fn unread_dm_count(&self) -> usize {
        self.dms.iter().filter(|dm| dm.unread).count()
    }

    pub fn has_unread_space(&self) -> bool {
        self.spaces.iter().any(|s| s.unread)
    }

    /// DM list in display order (newest first). Pure, so the UI and any
    /// future widget share the one ordering.
    pub fn sorted_dms(&self) -> Vec<&Dm> {
        let mut dms: Vec<&Dm> = self.dms.iter().collect();
        dms.sort_by_key(|dm| dm.sort_key());
        dms
    }

    pub fn members_for(&self, space_id: &str) -> &[SpaceMember] {
        self.members.get(space_id).map(Vec::as_slice).unwrap_or(&[])
    }

    pub fn set_members(&mut self, space_id: &str, members: Vec<SpaceMember>) {
        self.members.insert(space_id.to_string(), members);
    }

    pub fn messages_for(&self, channel_id: &str) -> Vec<&ChatMessage> {
        let mut messages: Vec<_> = self
            .messages
            .iter()
            .filter(|m| m.channel_id == channel_id)
            .collect();
        // A live insert can arrive before the REST history page.
        messages.sort_by_key(|m| (m.created_at, m.id.parse::<u64>().unwrap_or(u64::MAX)));
        messages
    }

    /// Inserts a live message, replacing any optimistic entry with the same
    /// id and ignoring exact duplicates (REST echo + WS broadcast race).
    pub fn upsert_message(&mut self, message: ChatMessage) {
        if let Some(existing) = self.messages.iter_mut().find(|m| m.id == message.id) {
            *existing = message;
            return;
        }
        self.messages.push(message);
    }

    pub fn channels_for(&self, space_id: &str) -> Vec<&Channel> {
        self.channels
            .iter()
            .filter(|c| c.space_id == space_id)
            .collect()
    }

    pub fn select_space(&mut self, space_id: &str) {
        self.current_space_id = Some(space_id.to_string());
    }

    pub fn dm_by_id(&self, dm_id: &str) -> Option<&Dm> {
        self.dms.iter().find(|dm| dm.id == dm_id)
    }

    pub fn remove_dm(&mut self, dm_id: &str) {
        self.dms.retain(|dm| dm.id != dm_id);
        self.messages.retain(|m| m.channel_id != dm_id);
    }

    /// Best-effort display name for any known user id (roster cache, DM
    /// co-members, friends, self). Falls back to a short id, never blank.
    pub fn display_name_for(&self, user_id: &str) -> String {
        if let Some(session) = &self.session {
            if session.user_id == user_id {
                return session.display().to_string();
            }
        }
        if let Some(member) = self.members.values().flatten().find(|m| m.id == user_id) {
            return member.name.clone();
        }
        if let Some(name) = self.dms.iter().find_map(|dm| dm.member_names.get(user_id)) {
            return name.clone();
        }
        if let Some(friend) = self.friends.iter().find(|f| f.id == user_id) {
            return friend.display().to_string();
        }
        format!("user-{}", user_id.chars().take(6).collect::<String>())
    }
}

#[cfg(test)]
#[allow(clippy::field_reassign_with_default)]
mod tests {
    use super::*;

    #[test]
    fn tab_keys_match_web_tabs() {
        assert_eq!(Tab::Spaces.as_str(), "spaces");
        assert_eq!(Tab::Dms.as_str(), "dms");
        assert_eq!(Tab::You.as_str(), "you");
    }

    #[test]
    fn screen_keys_match_web_screen_map() {
        let cases: Vec<(Screen, &str)> = vec![
            (
                Screen::ChannelChat {
                    channel_id: "c".into(),
                    space_id: "s".into(),
                },
                "channel-chat",
            ),
            (Screen::Friends, "friends"),
            (Screen::Settings, "settings"),
            (Screen::SettingsAccount, "settings-account"),
            (Screen::SettingsAppearance, "settings-appearance"),
            (Screen::SettingsVoice, "settings-voice"),
            (Screen::SettingsPrivacy, "settings-privacy"),
            (Screen::SettingsInstance, "settings-instance"),
            (
                Screen::Members {
                    space_id: Some("s".into()),
                },
                "members",
            ),
            (
                Screen::GroupDmInfo {
                    channel_id: "d".into(),
                },
                "group-dm-info",
            ),
            (Screen::VoiceFull, "voice-full"),
            (
                Screen::UserProfile {
                    user_id: "u".into(),
                },
                "user-profile",
            ),
        ];
        for (screen, key) in cases {
            assert_eq!(screen.key(), key);
        }
    }

    #[test]
    fn set_tab_clears_stack_like_web() {
        let mut state = AppState::new();
        state.push(Screen::Friends);
        state.set_tab(Tab::Dms);
        assert_eq!(state.tab, Tab::Dms);
        assert!(state.stack.is_empty());
    }

    #[test]
    fn push_pop_stack() {
        let mut state = AppState::new();
        assert!(!state.pop());
        state.push(Screen::Settings);
        state.push(Screen::SettingsVoice);
        assert_eq!(state.top(), Some(&Screen::SettingsVoice));
        assert!(state.pop());
        assert_eq!(state.top(), Some(&Screen::Settings));
        assert!(state.pop());
        assert_eq!(state.top(), None);
    }

    #[test]
    fn unread_badges_match_mobile_bottom_nav_rules() {
        let mut state = AppState::new();
        state.spaces = vec![
            Space {
                id: "s1".into(),
                name: "one".into(),
                unread: false,
            },
            Space {
                id: "s2".into(),
                name: "two".into(),
                unread: true,
            },
        ];
        state.dms = vec![
            Dm {
                id: "d1".into(),
                name: "a".into(),
                member_ids: vec![],
                member_names: HashMap::new(),
                owner_id: None,
                last_message_id: Some("m1".into()),
                last_message_preview: None,
                last_message_at: None,
                unread: true,
            },
            Dm {
                id: "d2".into(),
                name: "b".into(),
                member_ids: vec![],
                member_names: HashMap::new(),
                owner_id: None,
                last_message_id: None,
                last_message_preview: None,
                last_message_at: None,
                unread: false,
            },
        ];
        assert!(state.has_unread_space());
        assert_eq!(state.unread_dm_count(), 1);
    }

    #[test]
    fn dm_order_is_newest_first() {
        let old = Dm {
            id: "old".into(),
            name: "old".into(),
            member_ids: vec![],
            member_names: HashMap::new(),
            owner_id: None,
            last_message_id: Some("m1".into()),
            last_message_preview: None,
            last_message_at: Some(
                DateTime::from_timestamp_millis(1_000).expect("valid test timestamp"),
            ),
            unread: false,
        };
        let fresh = Dm {
            id: "fresh".into(),
            name: "fresh".into(),
            member_ids: vec![],
            member_names: HashMap::new(),
            owner_id: None,
            last_message_id: Some("m2".into()),
            last_message_preview: None,
            last_message_at: Some(
                DateTime::from_timestamp_millis(2_000).expect("valid test timestamp"),
            ),
            unread: false,
        };
        let silent = Dm {
            id: "silent".into(),
            name: "silent".into(),
            member_ids: vec![],
            member_names: HashMap::new(),
            owner_id: None,
            last_message_id: None,
            last_message_preview: None,
            last_message_at: None,
            unread: false,
        };
        let mut state = AppState::new();
        state.dms = vec![silent.clone(), old.clone(), fresh.clone()];
        let ordered: Vec<&str> = state.sorted_dms().iter().map(|dm| dm.id.as_str()).collect();
        assert_eq!(ordered, vec!["fresh", "old", "silent"]);
    }

    #[test]
    fn channels_filter_by_space() {
        let mut state = AppState::new();
        state.channels = vec![
            Channel {
                id: "c1".into(),
                space_id: "s1".into(),
                name: "general".into(),
                kind: ChannelKind::Text,
                unread: false,
            },
            Channel {
                id: "c2".into(),
                space_id: "s2".into(),
                name: "voice".into(),
                kind: ChannelKind::Voice,
                unread: true,
            },
        ];
        assert_eq!(state.channels_for("s1").len(), 1);
        assert_eq!(state.channels_for("s1")[0].name, "general");
        state.select_space("s2");
        assert_eq!(state.current_space_id.as_deref(), Some("s2"));
    }

    #[test]
    fn channel_kind_maps_wire_types() {
        assert_eq!(ChannelKind::from_wire("text"), ChannelKind::Text);
        assert_eq!(ChannelKind::from_wire("voice"), ChannelKind::Voice);
        assert_eq!(ChannelKind::from_wire("future"), ChannelKind::Text);
    }

    #[test]
    fn upsert_replaces_optimistic_and_ignores_duplicates() {
        let mut state = AppState::new();
        let local = ChatMessage::new("c1", "u1", "ann", "hello");
        let id = local.id.clone();
        state.messages.push(local);
        let server = ChatMessage {
            id: id.clone(),
            channel_id: "c1".into(),
            author_id: "u1".into(),
            author_name: "ann".into(),
            body: "hello".into(),
            created_at: Utc::now(),
            pending: false,
            failed: false,
        };
        state.upsert_message(server);
        assert_eq!(state.messages.len(), 1);
        assert_eq!(state.messages[0].id, id);
        // Exact duplicate over WS: still one row.
        let dupe = state.messages[0].clone();
        state.upsert_message(dupe);
        assert_eq!(state.messages.len(), 1);
    }

    #[test]
    fn remove_dm_drops_its_messages() {
        let mut state = AppState::new();
        state.dms = vec![Dm {
            id: "d1".into(),
            name: "g".into(),
            member_ids: vec![],
            member_names: HashMap::new(),
            owner_id: None,
            last_message_id: None,
            last_message_preview: None,
            last_message_at: None,
            unread: false,
        }];
        state
            .messages
            .push(ChatMessage::new("d1", "u1", "ann", "hi"));
        state.remove_dm("d1");
        assert!(state.dms.is_empty());
        assert!(state.messages.is_empty());
    }

    #[test]
    fn display_name_prefers_session_then_roster_then_friends() {
        let mut state = AppState::new();
        state.session = Some(AuthSession {
            user_id: "me".into(),
            username: "me".into(),
            display_name: Some("Me!".into()),
            token: "t".into(),
        });
        state.set_members(
            "s1",
            vec![SpaceMember {
                id: "m1".into(),
                name: "Member One".into(),
                online: true,
                role: None,
            }],
        );
        state.friends = vec![FriendEntry {
            id: "f1".into(),
            username: "f".into(),
            display_name: None,
            online: false,
        }];
        assert_eq!(state.display_name_for("me"), "Me!");
        assert_eq!(state.display_name_for("m1"), "Member One");
        assert_eq!(state.display_name_for("f1"), "f");
        assert!(state.display_name_for("unknown-id").starts_with("user-"));
    }

    #[test]
    fn instance_parse_matches_picker_rules() {
        assert_eq!(
            InstanceConfig::parse("chat.example")
                .expect("host parses")
                .base_url,
            "https://chat.example"
        );
        assert_eq!(
            InstanceConfig::parse("  http://10.0.0.2:3005/ ")
                .expect("lan parses")
                .base_url,
            "http://10.0.0.2:3005"
        );
        assert!(InstanceConfig::parse("").is_err());
        assert!(InstanceConfig::parse("https://user:pass@host").is_err());
        assert!(InstanceConfig::parse("ftp://host").is_err());
        assert!(InstanceConfig::parse("https://ho\nst").is_err());
    }

    #[test]
    fn ws_url_derives_from_base() {
        let https = InstanceConfig::parse("chat.example").expect("host parses");
        assert_eq!(https.ws_url().expect("wss"), "wss://chat.example/ws");
        let http = InstanceConfig::parse("http://10.0.0.2:3005").expect("lan parses");
        assert_eq!(http.ws_url().expect("ws"), "ws://10.0.0.2:3005/ws");
    }
}
