//! REST client for the Veyvox HTTP API.
//!
//! Same routes and envelopes as the web client
//! (`packages/web/src/api/client.ts`, `docs/systems/api.md`): every path is
//! relative to the `/api` base, bearer JWT, JSON bodies, and the shared
//! error envelope `{ error, code, statusCode, details? }`. Transport is
//! `ureq` (pure Rust, blocking) so requests run on worker threads and never
//! on the egui frame. Wire DTOs use the server's camelCase names and
//! convert into the internal `state.rs` model.

use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::state::{
    AuthSession, ChannelKind, ChatMessage, Dm, FriendEntry, InstanceConfig, SpaceMember,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ApiError {
    pub code: String,
    pub message: String,
}

impl std::fmt::Display for ApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for ApiError {}

/// The shared error envelope: `{ error, code, statusCode, details? }`
/// (`packages/server/src/utils/httpErrors.ts`). `error` is the English
/// message; `code` is what the client reacts to.
#[derive(Debug, Clone, Deserialize)]
struct WireErrorBody {
    #[serde(default)]
    error: Option<String>,
    #[serde(default)]
    code: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LoginRequest<'a> {
    pub username: &'a str,
    pub password: &'a str,
}

#[derive(Debug, Clone, Deserialize)]
#[allow(non_snake_case)]
pub(crate) struct ApiUser {
    id: String,
    username: String,
    #[serde(default)]
    #[allow(dead_code)]
    displayName: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct AuthResponse {
    token: String,
    user: ApiUser,
}

#[derive(Debug, Clone, Deserialize)]
pub struct InstanceInfo {
    pub name: String,
    pub version: String,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct ApiSpaceDetail {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub channels: Vec<ApiChannel>,
    #[serde(default)]
    pub members: Vec<ApiMember>,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct ApiSpace {
    id: String,
    name: String,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct ApiChannel {
    id: String,
    #[serde(default)]
    name: String,
    #[serde(rename = "type", default)]
    kind: String,
}

#[derive(Debug, Clone, Deserialize)]
#[allow(non_snake_case)]
pub(crate) struct ApiMember {
    #[serde(default)]
    userId: String,
    #[serde(default)]
    nickname: Option<String>,
    user: ApiUser,
}

#[derive(Debug, Clone, Deserialize)]
struct SpaceDetail {
    channels: Vec<ApiChannel>,
    members: Vec<ApiMember>,
}

#[derive(Debug, Clone, Deserialize)]
#[allow(non_snake_case)]
pub(crate) struct ApiLastMessage {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    content: Option<String>,
    #[serde(default)]
    createdAt: Option<i64>,
    #[serde(default)]
    #[allow(dead_code)]
    userId: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[allow(non_snake_case)]
pub(crate) struct ApiDm {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub ownerId: Option<String>,
    #[serde(default)]
    pub members: Vec<ApiUser>,
    #[serde(default)]
    #[allow(dead_code)]
    pub lastMessage: Option<ApiLastMessage>,
}

#[derive(Debug, Clone, Deserialize)]
#[allow(non_snake_case)]
pub(crate) struct ApiMessageUser {
    #[serde(default)]
    username: String,
    #[serde(default)]
    displayName: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[allow(non_snake_case)]
pub(crate) struct ApiMessage {
    pub id: String,
    #[serde(default)]
    pub userId: String,
    #[serde(default)]
    pub content: Option<String>,
    #[serde(default)]
    pub createdAt: i64,
    #[serde(default)]
    pub user: Option<ApiMessageUser>,
}

#[derive(Debug, Clone, Deserialize)]
#[allow(non_snake_case)]
pub(crate) struct ApiDmMessage {
    pub id: String,
    #[serde(default)]
    pub dmChannelId: String,
    #[serde(default)]
    pub userId: String,
    #[serde(default)]
    pub content: Option<String>,
    #[serde(default)]
    pub createdAt: i64,
    #[serde(default)]
    pub user: Option<ApiMessageUser>,
}

#[derive(Debug, Clone, Deserialize)]
#[allow(non_snake_case)]
pub(crate) struct ApiMe {
    #[serde(default)]
    isAdmin: bool,
    #[serde(default)]
    discoverable: Option<bool>,
    #[serde(default)]
    showActivity: Option<bool>,
}

#[derive(Debug, Clone)]
pub struct MeInfo {
    pub is_admin: bool,
    pub discoverable: Option<bool>,
    pub show_activity: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
#[allow(non_snake_case)]
pub(crate) struct ApiFriend {
    id: String,
    username: String,
    #[serde(default)]
    displayName: Option<String>,
    #[serde(default)]
    status: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct LiveKitToken {
    token: String,
    #[allow(dead_code)]
    url: String,
}

/// Blocking REST client. Cheap to clone: it only holds strings.
#[derive(Debug, Clone)]
pub struct RestClient {
    pub instance: InstanceConfig,
    pub session: Option<AuthSession>,
}

impl RestClient {
    pub fn new(instance: InstanceConfig) -> Self {
        Self {
            instance,
            session: None,
        }
    }

    pub fn authenticated(instance: InstanceConfig, session: AuthSession) -> Self {
        Self {
            instance,
            session: Some(session),
        }
    }

    fn auth_header(&self) -> Option<String> {
        self.session.as_ref().map(|s| format!("Bearer {}", s.token))
    }

    /// Builds a full endpoint URL without sending anything. All paths are
    /// relative to the `/api` base, exactly like the web client.
    pub fn endpoint(&self, path: &str) -> String {
        format!("{}/api{path}", self.instance.base_url)
    }

    fn agent(&self) -> ureq::Agent {
        ureq::AgentBuilder::new()
            .timeout(Duration::from_secs(20))
            .build()
    }

    fn authed(&self, request: ureq::Request) -> ureq::Request {
        match self.auth_header() {
            Some(header) => request.set("Authorization", &header),
            None => request,
        }
    }

    fn check(response: ureq::Response) -> Result<ureq::Response, ApiError> {
        let status = response.status();
        if (200..300).contains(&status) {
            return Ok(response);
        }
        let envelope: Result<WireErrorBody, _> = response.into_json();
        match envelope {
            Ok(wire) => Err(ApiError {
                code: wire.code.unwrap_or_else(|| "request_failed".into()),
                message: wire.error.unwrap_or_else(|| format!("http {status}")),
            }),
            Err(_) => Err(ApiError {
                code: "request_failed".into(),
                message: format!("http {status}"),
            }),
        }
    }

    fn network(err: impl std::fmt::Display) -> ApiError {
        ApiError {
            code: "network_error".into(),
            message: err.to_string(),
        }
    }

    fn decode<T: serde::de::DeserializeOwned>(response: ureq::Response) -> Result<T, ApiError> {
        response.into_json().map_err(|e| ApiError {
            code: "bad_response".into(),
            message: e.to_string(),
        })
    }

    pub fn login(&self, username: &str, password: &str) -> Result<AuthSession, ApiError> {
        let url = self.endpoint("/auth/login");
        let response = Self::check(
            self.agent()
                .post(&url)
                .send_json(LoginRequest { username, password })
                .map_err(Self::network)?,
        )?;
        let body: AuthResponse = Self::decode(response)?;
        Ok(AuthSession {
            user_id: body.user.id,
            username: body.user.username,
            display_name: body.user.displayName,
            token: body.token,
        })
    }

    pub fn instance_info(&self) -> Result<InstanceInfo, ApiError> {
        let url = self.endpoint("/instance/info");
        let response = Self::check(self.agent().get(&url).call().map_err(Self::network)?)?;
        Self::decode(response)
    }

    pub fn list_spaces(&self) -> Result<Vec<crate::state::Space>, ApiError> {
        let url = self.endpoint("/spaces");
        let response = Self::check(
            self.authed(self.agent().get(&url))
                .call()
                .map_err(Self::network)?,
        )?;
        let spaces: Vec<ApiSpace> = Self::decode(response)?;
        Ok(spaces
            .into_iter()
            .map(|s| crate::state::Space {
                id: s.id,
                name: s.name,
                unread: false,
            })
            .collect())
    }

    /// Full space detail: channels + members for the channel list and the
    /// member roster. Same `GET /spaces/:id` the web sidebar uses.
    pub fn space_detail(
        &self,
        space_id: &str,
    ) -> Result<(Vec<crate::state::Channel>, Vec<SpaceMember>), ApiError> {
        let url = self.endpoint(&format!("/spaces/{space_id}"));
        let response = Self::check(
            self.authed(self.agent().get(&url))
                .call()
                .map_err(Self::network)?,
        )?;
        let detail: SpaceDetail = Self::decode(response)?;
        let channels = detail
            .channels
            .into_iter()
            .map(|c| crate::state::Channel {
                id: c.id,
                space_id: space_id.to_string(),
                name: if c.name.is_empty() {
                    "channel".to_string()
                } else {
                    c.name
                },
                kind: ChannelKind::from_wire(&c.kind),
                unread: false,
            })
            .collect();
        let members = detail
            .members
            .into_iter()
            .map(|m| {
                let id = if m.userId.is_empty() {
                    m.user.id.clone()
                } else {
                    m.userId
                };
                let name = m
                    .nickname
                    .filter(|n| !n.trim().is_empty())
                    .or(m.user.displayName.clone())
                    .unwrap_or(m.user.username);
                SpaceMember {
                    id,
                    name,
                    online: false,
                    role: None,
                }
            })
            .collect();
        Ok((channels, members))
    }

    pub fn list_dms(&self) -> Result<Vec<Dm>, ApiError> {
        let url = self.endpoint("/dm");
        let response = Self::check(
            self.authed(self.agent().get(&url))
                .call()
                .map_err(Self::network)?,
        )?;
        let dms: Vec<ApiDm> = Self::decode(response)?;
        Ok(dms.into_iter().map(dm_from_wire).collect())
    }

    pub fn list_friends(&self) -> Result<Vec<FriendEntry>, ApiError> {
        let url = self.endpoint("/social/friends");
        let response = Self::check(
            self.authed(self.agent().get(&url))
                .call()
                .map_err(Self::network)?,
        )?;
        let friends: Vec<ApiFriend> = Self::decode(response)?;
        Ok(friends
            .into_iter()
            .map(|f| FriendEntry {
                id: f.id,
                username: f.username,
                display_name: f.displayName,
                online: matches!(f.status.as_deref(), Some("online" | "idle" | "dnd")),
            })
            .collect())
    }

    pub fn channel_history(
        &self,
        channel_id: &str,
        limit: u32,
    ) -> Result<Vec<ChatMessage>, ApiError> {
        let limit = limit.clamp(1, 100);
        let url = self.endpoint(&format!("/channels/{channel_id}/messages?limit={limit}"));
        let response = Self::check(
            self.authed(self.agent().get(&url))
                .call()
                .map_err(Self::network)?,
        )?;
        let messages: Vec<ApiMessage> = Self::decode(response)?;
        Ok(messages
            .into_iter()
            .map(|m| message_from_wire(channel_id, m))
            .collect())
    }

    pub fn dm_history(&self, dm_id: &str, limit: u32) -> Result<Vec<ChatMessage>, ApiError> {
        let limit = limit.clamp(1, 100);
        let url = self.endpoint(&format!("/dm/{dm_id}/messages?limit={limit}"));
        let response = Self::check(
            self.authed(self.agent().get(&url))
                .call()
                .map_err(Self::network)?,
        )?;
        let messages: Vec<ApiDmMessage> = Self::decode(response)?;
        Ok(messages
            .into_iter()
            .map(|m| ChatMessage {
                id: m.id,
                channel_id: m.dmChannelId.clone(),
                author_id: m.userId,
                author_name: m
                    .user
                    .as_ref()
                    .and_then(|u| u.displayName.clone())
                    .unwrap_or_else(|| {
                        m.user
                            .as_ref()
                            .map(|u| u.username.clone())
                            .unwrap_or_default()
                    }),
                body: m.content.unwrap_or_default(),
                created_at: millis_to_dt(m.createdAt),
                pending: false,
                failed: false,
            })
            .collect())
    }

    /// Sends to a space channel. The body field is `content` (a missing or
    /// empty value answers `400 message_empty`); DMs use their own route.
    pub fn send_channel_message(
        &self,
        channel_id: &str,
        content: &str,
    ) -> Result<ChatMessage, ApiError> {
        let url = self.endpoint(&format!("/channels/{channel_id}/messages"));
        let response = Self::check(
            self.authed(self.agent().post(&url))
                .send_json(serde_json::json!({ "content": content }))
                .map_err(Self::network)?,
        )?;
        let message: ApiMessage = Self::decode(response)?;
        Ok(message_from_wire(channel_id, message))
    }

    /// Sends to a DM conversation: `POST /dm/:id/messages { content }`.
    pub fn send_dm_message(&self, dm_id: &str, content: &str) -> Result<ChatMessage, ApiError> {
        let url = self.endpoint(&format!("/dm/{dm_id}/messages"));
        let response = Self::check(
            self.authed(self.agent().post(&url))
                .send_json(serde_json::json!({ "content": content }))
                .map_err(Self::network)?,
        )?;
        let message: ApiDmMessage = Self::decode(response)?;
        Ok(ChatMessage {
            id: message.id,
            channel_id: message.dmChannelId,
            author_id: message.userId,
            author_name: message
                .user
                .as_ref()
                .and_then(|u| u.displayName.clone())
                .unwrap_or_else(|| {
                    message
                        .user
                        .as_ref()
                        .map(|u| u.username.clone())
                        .unwrap_or_default()
                }),
            body: message.content.unwrap_or_default(),
            created_at: millis_to_dt(message.createdAt),
            pending: false,
            failed: false,
        })
    }

    /// LiveKit token for a space voice channel: `POST /livekit/token
    /// { channelId } → { token, url }`, the same endpoint the web
    /// `useLiveKit` connect path uses.
    pub fn voice_token_channel(&self, channel_id: &str) -> Result<(String, String), ApiError> {
        let url = self.endpoint("/livekit/token");
        let response = Self::check(
            self.authed(self.agent().post(&url))
                .send_json(serde_json::json!({ "channelId": channel_id }))
                .map_err(Self::network)?,
        )?;
        let body: LiveKitToken = Self::decode(response)?;
        Ok((body.token, body.url))
    }

    /// LiveKit token for a DM call: `POST /livekit/token { dmChannelId }`.
    pub fn voice_token_dm(&self, dm_id: &str) -> Result<(String, String), ApiError> {
        let url = self.endpoint("/livekit/token");
        let response = Self::check(
            self.authed(self.agent().post(&url))
                .send_json(serde_json::json!({ "dmChannelId": dm_id }))
                .map_err(Self::network)?,
        )?;
        let body: LiveKitToken = Self::decode(response)?;
        Ok((body.token, body.url))
    }

    /// Leaves a group DM: `DELETE /dm/:id/members`. The conversation stays
    /// listed as closed; the client drops it locally.
    pub fn leave_dm(&self, dm_id: &str) -> Result<(), ApiError> {
        let url = self.endpoint(&format!("/dm/{dm_id}/members"));
        Self::check(
            self.authed(self.agent().delete(&url))
                .call()
                .map_err(Self::network)?,
        )?;
        Ok(())
    }

    /// Renames a group DM (owner only): `PATCH /dm/:id { name }`.
    pub fn rename_dm(&self, dm_id: &str, name: &str) -> Result<(), ApiError> {
        let url = self.endpoint(&format!("/dm/{dm_id}"));
        Self::check(
            self.authed(self.agent().patch(&url))
                .send_json(serde_json::json!({ "name": name }))
                .map_err(Self::network)?,
        )?;
        Ok(())
    }

    pub fn me(&self) -> Result<MeInfo, ApiError> {
        let url = self.endpoint("/users/@me");
        let response = Self::check(
            self.authed(self.agent().get(&url))
                .call()
                .map_err(Self::network)?,
        )?;
        let me: ApiMe = Self::decode(response)?;
        Ok(MeInfo {
            is_admin: me.isAdmin,
            discoverable: me.discoverable,
            show_activity: me.showActivity,
        })
    }

    /// Opens (or creates) a 1-on-1 DM: `POST /dm { userId }` reuses the
    /// existing conversation (200) or creates it (201).
    pub fn create_dm(&self, user_id: &str) -> Result<Dm, ApiError> {
        let url = self.endpoint("/dm");
        let response = Self::check(
            self.authed(self.agent().post(&url))
                .send_json(serde_json::json!({ "userId": user_id }))
                .map_err(Self::network)?,
        )?;
        let dm: ApiDm = Self::decode(response)?;
        Ok(dm_from_wire(dm))
    }

    /// Sends a friend request by exact username:
    /// `POST /social/requests { username }`.
    pub fn send_friend_request(&self, username: &str) -> Result<(), ApiError> {
        let url = self.endpoint("/social/requests");
        Self::check(
            self.authed(self.agent().post(&url))
                .send_json(serde_json::json!({ "username": username }))
                .map_err(Self::network)?,
        )?;
        Ok(())
    }

    /// Updates self-view privacy flags: `PATCH /users/@me`.
    pub fn update_me(&self, patch: serde_json::Value) -> Result<(), ApiError> {
        let url = self.endpoint("/users/@me");
        Self::check(
            self.authed(self.agent().patch(&url))
                .send_json(patch)
                .map_err(Self::network)?,
        )?;
        Ok(())
    }
}

/// Parses one `SpaceWithChannelsAndMembers`-shaped value (REST detail or a
/// WS `ready` entry) into local state pieces. Returns None when the value
/// is not an object with a usable id, so one bad entry never drops the
/// whole bootstrap.
pub(crate) fn parse_space_value(
    v: &serde_json::Value,
) -> Option<(
    crate::state::Space,
    Vec<crate::state::Channel>,
    Vec<SpaceMember>,
)> {
    let detail: ApiSpaceDetail = serde_json::from_value(v.clone()).ok()?;
    if detail.id.is_empty() {
        return None;
    }
    let space_id = detail.id.clone();
    let space = crate::state::Space {
        id: space_id.clone(),
        name: if detail.name.is_empty() {
            "space".to_string()
        } else {
            detail.name
        },
        unread: false,
    };
    let channels = detail
        .channels
        .into_iter()
        .filter(|c| !c.id.is_empty())
        .map(|c| crate::state::Channel {
            id: c.id,
            space_id: space_id.clone(),
            name: if c.name.is_empty() {
                "channel".to_string()
            } else {
                c.name
            },
            kind: ChannelKind::from_wire(&c.kind),
            unread: false,
        })
        .collect();
    let members = detail
        .members
        .into_iter()
        .map(|m| {
            let id = if m.userId.is_empty() {
                m.user.id.clone()
            } else {
                m.userId
            };
            let name = m
                .nickname
                .filter(|n| !n.trim().is_empty())
                .or(m.user.displayName.clone())
                .unwrap_or(m.user.username);
            SpaceMember {
                id,
                name,
                online: false,
                role: None,
            }
        })
        .filter(|m| !m.id.is_empty())
        .collect();
    Some((space, channels, members))
}

/// Parses one `DmChannel`-shaped value (REST list or a WS `ready` entry).
pub(crate) fn parse_dm_value(v: &serde_json::Value) -> Option<Dm> {
    let dm: ApiDm = serde_json::from_value(v.clone()).ok()?;
    if dm.id.is_empty() {
        return None;
    }
    Some(dm_from_wire(dm))
}

fn millis_to_dt(millis: i64) -> chrono::DateTime<chrono::Utc> {
    chrono::DateTime::from_timestamp_millis(millis).unwrap_or_else(chrono::Utc::now)
}

fn author_name(user: Option<ApiMessageUser>, fallback: &str) -> String {
    user.as_ref()
        .and_then(|u| u.displayName.clone())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| {
            user.as_ref()
                .map(|u| u.username.clone())
                .filter(|n| !n.is_empty())
                .unwrap_or_else(|| fallback.to_string())
        })
}

fn message_from_wire(channel_id: &str, m: ApiMessage) -> ChatMessage {
    ChatMessage {
        id: m.id,
        channel_id: channel_id.to_string(),
        author_id: m.userId,
        author_name: author_name(m.user, "unknown"),
        body: m.content.unwrap_or_default(),
        created_at: millis_to_dt(m.createdAt),
        pending: false,
        failed: false,
    }
}

pub(crate) fn dm_from_wire(dm: ApiDm) -> Dm {
    let preview = dm.lastMessage.as_ref();
    let name = dm.name.filter(|n| !n.trim().is_empty()).unwrap_or_else(|| {
        let mut members: Vec<String> = dm.members.iter().map(|m| m.username.clone()).collect();
        members.sort();
        members.join(", ")
    });
    Dm {
        id: dm.id,
        name,
        member_ids: dm.members.iter().map(|m| m.id.clone()).collect(),
        member_names: dm
            .members
            .iter()
            .map(|m| (m.id.clone(), m.username.clone()))
            .collect(),
        owner_id: dm.ownerId,
        last_message_id: preview.and_then(|m| m.id.clone()),
        last_message_preview: preview.and_then(|m| m.content.clone()),
        last_message_at: preview
            .and_then(|m| m.createdAt)
            .and_then(chrono::DateTime::from_timestamp_millis),
        unread: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::InstanceConfig;

    fn client() -> RestClient {
        RestClient::new(
            InstanceConfig::parse("https://chat.example").expect("test instance parses"),
        )
    }

    #[test]
    fn endpoints_match_web_client_routes() {
        let c = client();
        assert_eq!(
            c.endpoint("/auth/login"),
            "https://chat.example/api/auth/login"
        );
        assert_eq!(
            c.endpoint("/channels/c1/messages"),
            "https://chat.example/api/channels/c1/messages"
        );
        assert_eq!(
            c.endpoint("/dm/d1/messages"),
            "https://chat.example/api/dm/d1/messages"
        );
        assert_eq!(
            c.endpoint("/livekit/token"),
            "https://chat.example/api/livekit/token"
        );
        assert_eq!(c.endpoint("/spaces"), "https://chat.example/api/spaces");
        assert_eq!(c.endpoint("/dm"), "https://chat.example/api/dm");
    }

    #[test]
    fn login_parses_real_auth_response_shape() {
        // `AuthResponse = { token, user }` (shared/types.ts); the id lives
        // in `user.id`, never at the top level.
        let body: AuthResponse = serde_json::from_value(serde_json::json!({
            "token": "jwt",
            "user": { "id": "u1", "username": "ann", "displayName": "Ann" }
        }))
        .expect("auth response parses");
        assert_eq!(body.user.id, "u1");
        assert_eq!(body.token, "jwt");
    }

    #[test]
    fn error_envelope_matches_send_error_contract() {
        // `{ error, code, statusCode, details? }` (utils/httpErrors.ts).
        let wire: WireErrorBody = serde_json::from_value(serde_json::json!({
            "error": "Message cannot be empty.",
            "code": "message_empty",
            "statusCode": 400
        }))
        .expect("error envelope parses");
        assert_eq!(wire.code.as_deref(), Some("message_empty"));
        assert!(wire.error.unwrap_or_default().contains("empty"));
    }

    #[test]
    fn dm_wire_maps_members_and_last_message() {
        let dm: ApiDm = serde_json::from_value(serde_json::json!({
            "id": "d1",
            "name": null,
            "ownerId": "u1",
            "members": [
                { "id": "u1", "username": "ann" },
                { "id": "u2", "username": "bob" }
            ],
            "lastMessage": {
                "id": "m9", "content": "hey",
                "createdAt": 1_700_000_000_000_i64, "userId": "u2"
            }
        }))
        .expect("dm wire parses");
        let mapped = dm_from_wire(dm);
        assert_eq!(mapped.name, "ann, bob");
        assert_eq!(mapped.owner_id.as_deref(), Some("u1"));
        assert_eq!(mapped.last_message_preview.as_deref(), Some("hey"));
        assert!(mapped.last_message_at.is_some());
    }

    #[test]
    fn channel_message_wire_maps_author_and_content() {
        let m: ApiMessage = serde_json::from_value(serde_json::json!({
            "id": "m1", "userId": "u2", "content": "hi",
            "createdAt": 1_700_000_000_000_i64,
            "user": { "username": "bob", "displayName": null }
        }))
        .expect("message wire parses");
        let mapped = message_from_wire("c1", m);
        assert_eq!(mapped.author_name, "bob");
        assert_eq!(mapped.body, "hi");
        assert!(!mapped.pending);
        assert!(!mapped.failed);
    }

    #[test]
    fn auth_header_is_bearer() {
        let authed = RestClient::authenticated(
            InstanceConfig::parse("https://chat.example").expect("test instance parses"),
            AuthSession {
                user_id: "u1".into(),
                username: "ann".into(),
                display_name: None,
                token: "tok".into(),
            },
        );
        assert_eq!(authed.auth_header(), Some("Bearer tok".to_string()));
        assert_eq!(client().auth_header(), None);
    }

    #[test]
    fn api_error_displays_code_and_message() {
        let err = ApiError {
            code: "forbidden".into(),
            message: "no".into(),
        };
        assert_eq!(err.to_string(), "forbidden: no");
    }
}
