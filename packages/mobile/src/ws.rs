//! Realtime WebSocket layer for the Veyvox protocol.
//!
//! Same wire as the web client (`docs/systems/websocket.md`, event types in
//! `packages/shared/src/types.ts`): JSON frames tagged by `type`, DM ids as
//! `dmChannelId`, refusals as `dm_call_reject`. Auth is `{ type: 'auth',
//! token, client: 'mobile' }` — `mobile` is a first-class `ClientKind`, so
//! the server reads this socket as a mobile session, not a browser one.
//!
//! `WsClient` owns the socket on one worker thread: it authenticates,
//! forwards `ServerFrame`s to the UI through an `mpsc` channel, and sends
//! queued `ClientFrame`s. Network never touches the egui frame; `lib.rs`
//! polls the receiver every update and reconnects with backoff by spawning
//! a fresh worker.

use std::io::{self, Read, Write};
use std::net::{Shutdown, TcpStream};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc::{self, Receiver, Sender, SyncSender},
    Arc, Mutex,
};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

/// Frames this app sends. Tag values are `snake_case` (`ClientEvent`),
/// field names are `camelCase` (`dmChannelId`, `channelId`, `isMuted`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum ClientFrame {
    Auth {
        token: String,
        client: String,
    },
    VoiceJoin {
        channel_id: String,
    },
    VoiceLeave,
    DmCallStart {
        dm_channel_id: String,
    },
    DmCallAccept {
        dm_channel_id: String,
    },
    DmCallReject {
        dm_channel_id: String,
    },
    DmCallEnd {
        dm_channel_id: String,
    },
    VoiceStatus {
        is_muted: bool,
        is_deafened: bool,
        is_camera_on: bool,
        is_screen_sharing: bool,
    },
    ChannelAck {
        channel_id: String,
        message_id: String,
    },
}

impl ClientFrame {
    pub fn mobile_auth(token: &str) -> Self {
        ClientFrame::Auth {
            token: token.to_string(),
            client: "mobile".to_string(),
        }
    }

    /// DM-call refusal must name the blocked DM before any pre-arm/send,
    /// mirroring the web refusal audit: a rejection for another DM never
    /// satisfies this DM.
    pub fn is_rejection_for(&self, dm_channel_id: &str) -> bool {
        matches!(
            self,
            ClientFrame::DmCallReject { dm_channel_id: id } if id == dm_channel_id
        )
    }

    pub fn dm_channel_id(&self) -> Option<&str> {
        match self {
            ClientFrame::DmCallStart { dm_channel_id }
            | ClientFrame::DmCallAccept { dm_channel_id }
            | ClientFrame::DmCallReject { dm_channel_id }
            | ClientFrame::DmCallEnd { dm_channel_id } => Some(dm_channel_id),
            _ => None,
        }
    }
}

/// The subset of `ServerEvent` this app acts on. Unknown future events
/// parse as `Unknown` and are ignored, so the stream never breaks on a
/// newer server.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerFrame {
    Ready {
        user: ReadyUser,
        #[serde(default)]
        spaces: Vec<serde_json::Value>,
        #[serde(default, rename = "dmChannels")]
        dm_channels: Vec<serde_json::Value>,
        #[serde(default, rename = "unreadCounts")]
        unread_counts: std::collections::HashMap<String, i64>,
        #[serde(default, rename = "readStates")]
        read_states: Vec<ReadStateWire>,
    },
    MessageCreated {
        message: WireMessage,
    },
    DmMessageCreated {
        message: WireDmMessage,
    },
    ChannelAck {
        #[serde(rename = "channelId")]
        channel_id: String,
        #[serde(rename = "messageId")]
        message_id: String,
    },
    MarkUnread {
        #[serde(rename = "channelId")]
        channel_id: String,
    },
    VoiceStateUpdate {
        #[serde(rename = "channelId")]
        channel_id: String,
        #[serde(rename = "userId")]
        user_id: String,
        action: String,
    },
    SpaceVoiceState {
        #[serde(rename = "spaceId")]
        space_id: String,
        #[serde(default, rename = "voiceStates")]
        voice_states: std::collections::HashMap<String, Vec<String>>,
    },
    DmCallIncoming {
        #[serde(rename = "dmChannelId")]
        dm_channel_id: String,
        #[serde(rename = "callerId")]
        caller_id: String,
        #[serde(rename = "callerName")]
        caller_name: String,
    },
    DmCallAccepted {
        #[serde(rename = "dmChannelId")]
        dm_channel_id: String,
    },
    DmCallRejected {
        #[serde(rename = "dmChannelId")]
        dm_channel_id: String,
    },
    DmCallWaiting {
        #[serde(rename = "dmChannelId")]
        dm_channel_id: String,
    },
    DmCallEnded {
        #[serde(rename = "dmChannelId")]
        dm_channel_id: String,
    },
    VoiceStatusUpdate {
        #[serde(rename = "userId")]
        user_id: String,
        #[serde(rename = "channelId")]
        channel_id: String,
    },
    DmChannelUpdated {
        #[serde(rename = "dmChannelId")]
        dm_channel_id: String,
    },
    DmChannelClosed {
        #[serde(rename = "dmChannelId")]
        dm_channel_id: String,
    },
    DmChannelCreated {
        #[serde(rename = "dmChannel")]
        dm_channel: serde_json::Value,
    },
    DmMemberAdded {
        #[serde(rename = "dmChannelId")]
        dm_channel_id: String,
        user: WirePeer,
    },
    DmMemberRemoved {
        #[serde(rename = "dmChannelId")]
        dm_channel_id: String,
        #[serde(rename = "userId")]
        user_id: String,
    },
    DmOwnerUpdated {
        #[serde(rename = "dmChannelId")]
        dm_channel_id: String,
        #[serde(rename = "newOwnerId")]
        new_owner_id: String,
    },
    MemberJoined {
        #[serde(rename = "spaceId")]
        space_id: String,
    },
    MemberUpdated {
        #[serde(rename = "spaceId")]
        space_id: String,
    },
    MemberLeft {
        #[serde(rename = "spaceId")]
        space_id: String,
        #[serde(rename = "userId")]
        user_id: String,
    },
    ChannelCreated {
        #[serde(rename = "spaceId")]
        space_id: String,
    },
    ChannelUpdated {
        #[serde(rename = "spaceId")]
        space_id: String,
    },
    ChannelDeleted {
        #[serde(rename = "spaceId")]
        space_id: String,
        #[serde(rename = "channelId")]
        channel_id: String,
    },
    SpaceUpdated {
        space: serde_json::Value,
    },
    Error {
        message: String,
        #[serde(default)]
        code: Option<String>,
        #[serde(default, rename = "dmChannelId")]
        dm_channel_id: Option<String>,
    },
    Pong,
    #[serde(other)]
    Unknown,
}

impl ServerFrame {
    pub fn dm_channel_id(&self) -> Option<&str> {
        match self {
            ServerFrame::DmCallIncoming { dm_channel_id, .. }
            | ServerFrame::DmCallAccepted { dm_channel_id }
            | ServerFrame::DmCallRejected { dm_channel_id }
            | ServerFrame::DmCallWaiting { dm_channel_id }
            | ServerFrame::DmCallEnded { dm_channel_id }
            | ServerFrame::DmChannelUpdated { dm_channel_id }
            | ServerFrame::DmChannelClosed { dm_channel_id }
            | ServerFrame::DmMemberAdded { dm_channel_id, .. }
            | ServerFrame::DmMemberRemoved { dm_channel_id, .. }
            | ServerFrame::DmOwnerUpdated { dm_channel_id, .. } => Some(dm_channel_id),
            ServerFrame::Error { dm_channel_id, .. } => dm_channel_id.as_deref(),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[allow(non_snake_case)]
pub struct WirePeer {
    pub id: String,
    pub username: String,
    #[serde(default)]
    pub displayName: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[allow(non_snake_case)]
pub struct ReadyUser {
    pub id: String,
    pub username: String,
    #[serde(default)]
    pub displayName: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[allow(non_snake_case)]
pub struct ReadStateWire {
    #[serde(default, rename = "channelId")]
    pub channel_id: String,
    #[serde(default, rename = "lastReadMessageId")]
    pub last_read_message_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[allow(non_snake_case)]
pub struct WireMessage {
    pub id: String,
    #[serde(default, rename = "channelId")]
    pub channel_id: String,
    #[serde(default, rename = "userId")]
    pub user_id: String,
    #[serde(default)]
    pub content: Option<String>,
    #[serde(default, rename = "createdAt")]
    pub created_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[allow(non_snake_case)]
pub struct WireDmMessage {
    pub id: String,
    #[serde(default, rename = "dmChannelId")]
    pub dm_channel_id: String,
    #[serde(default, rename = "userId")]
    pub user_id: String,
    #[serde(default)]
    pub content: Option<String>,
    #[serde(default, rename = "createdAt")]
    pub created_at: i64,
}

/// Parse one text frame. Used by the worker and unit-tested here.
pub fn parse_server_frame(text: &str) -> ServerFrame {
    serde_json::from_str(text).unwrap_or(ServerFrame::Unknown)
}

fn frame_to_ws(frame: &ClientFrame) -> Option<tungstenite::Message> {
    serde_json::to_string(frame)
        .ok()
        .map(tungstenite::Message::Text)
}

/// The UI can distinguish a pending connection from one that can send.
#[derive(Debug)]
pub struct WsHandle {
    tx: SyncSender<ClientFrame>,
    connection: Arc<Connection>,
}

#[derive(Debug)]
struct Connection {
    running: AtomicBool,
    connected: AtomicBool,
    tcp: Mutex<Option<TcpStream>>,
}

impl Connection {
    fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }

    fn attach(&self, stream: &TcpStream) -> io::Result<()> {
        let mut tcp = self.tcp.lock().expect("ws transport mutex");
        if !self.is_running() {
            return Err(io::ErrorKind::Interrupted.into());
        }
        *tcp = Some(stream.try_clone()?);
        Ok(())
    }

    fn stop(&self) {
        self.running.store(false, Ordering::SeqCst);
        if let Some(stream) = self.tcp.lock().expect("ws transport mutex").take() {
            let _ = stream.shutdown(Shutdown::Both);
        }
    }
}

impl WsHandle {
    pub fn send(&self, frame: ClientFrame) -> bool {
        self.is_alive() && self.tx.try_send(frame).is_ok()
    }

    pub fn is_alive(&self) -> bool {
        self.is_running() && self.connection.connected.load(Ordering::SeqCst)
    }

    pub fn is_running(&self) -> bool {
        self.connection.is_running()
    }

    pub fn shutdown(&self) {
        self.connection.stop();
    }
}

impl Drop for WsHandle {
    fn drop(&mut self) {
        self.shutdown();
    }
}

/// Spawns the socket worker: connects, sends `auth` with `client:
/// 'mobile', forwards inbound `ServerFrame`s to `events`, and writes
/// queued `ClientFrame`s. Closes `alive` on any terminal condition so
/// the UI can reconnect with backoff by spawning a fresh worker.
pub fn spawn_ws(url: String, token: String, events: Sender<ServerFrame>) -> WsHandle {
    let (tx, rx) = mpsc::sync_channel(64);
    let connection = Arc::new(Connection {
        running: AtomicBool::new(true),
        connected: AtomicBool::new(false),
        tcp: Mutex::new(None),
    });
    let handle = WsHandle {
        tx,
        connection: Arc::clone(&connection),
    };
    std::thread::spawn(move || {
        run_socket(&url, &token, rx, &events, &connection);
        connection.stop();
    });
    handle
}

const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const READ_TICK: Duration = Duration::from_millis(100);
const WRITE_TIMEOUT: Duration = Duration::from_secs(3);

// A shared deadline across TCP, TLS and HTTP upgrade. Per-read timeouts
// alone would let a slowly dripping upgrade hold a worker indefinitely.
struct SocketIo<'a> {
    tcp: TcpStream,
    deadline: Option<Instant>,
    connection: &'a Connection,
}

impl SocketIo<'_> {
    fn limit(&self, after_connect: Duration) -> io::Result<Duration> {
        if !self.connection.is_running() {
            return Err(io::ErrorKind::ConnectionAborted.into());
        }
        match self.deadline {
            Some(deadline) => Ok(remaining(deadline)?.min(after_connect)),
            None => Ok(after_connect),
        }
    }
}

impl Read for SocketIo<'_> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        loop {
            self.tcp.set_read_timeout(Some(self.limit(READ_TICK)?))?;
            let result = self.tcp.read(buf);
            // Keep waiting during the upgrade, but poll cancellation even
            // on hosts where shutdown does not wake a pending read.
            if self.deadline.is_some() && matches!(&result, Err(err) if io_timed_out(err)) {
                continue;
            }
            return result;
        }
    }
}

impl Write for SocketIo<'_> {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.tcp
            .set_write_timeout(Some(self.limit(WRITE_TIMEOUT)?))?;
        self.tcp.write(buf)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.tcp.flush()
    }
}

fn io_timed_out(err: &io::Error) -> bool {
    matches!(
        err.kind(),
        io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut
    )
}

fn remaining(deadline: Instant) -> io::Result<Duration> {
    let remaining = deadline.saturating_duration_since(Instant::now());
    if remaining.is_zero() {
        Err(io::ErrorKind::TimedOut.into())
    } else {
        Ok(remaining)
    }
}

fn connect_tcp(url: url::Url, deadline: Instant, connection: &Connection) -> Option<TcpStream> {
    // The platform resolver has its own timeout; it owns only the URL and
    // must not tie up a session worker or retain credentials.
    let (tx, rx) = mpsc::sync_channel(1);
    std::thread::spawn(move || {
        let _ = tx.send(url.socket_addrs(|| None));
    });
    let addresses = loop {
        if !connection.is_running() {
            return None;
        }
        match rx.recv_timeout(remaining(deadline).ok()?.min(READ_TICK)) {
            Ok(addresses) => break addresses.ok()?,
            Err(mpsc::RecvTimeoutError::Timeout) => (),
            Err(mpsc::RecvTimeoutError::Disconnected) => return None,
        }
    };
    for addr in addresses {
        if !connection.is_running() {
            return None;
        }
        if let Ok(stream) = TcpStream::connect_timeout(&addr, remaining(deadline).ok()?) {
            return Some(stream);
        }
    }
    None
}

fn run_socket(
    url: &str,
    token: &str,
    outbound: Receiver<ClientFrame>,
    events: &Sender<ServerFrame>,
    connection: &Connection,
) {
    let Ok(parsed) = url::Url::parse(url) else {
        return;
    };
    if !matches!(parsed.scheme(), "ws" | "wss") {
        return;
    }
    let deadline = Instant::now() + CONNECT_TIMEOUT;
    let Some(tcp) = connect_tcp(parsed, deadline, connection) else {
        return;
    };
    if connection.attach(&tcp).is_err() {
        return;
    }
    let io = SocketIo {
        tcp,
        deadline: Some(deadline),
        connection,
    };
    // Unlike `tungstenite::connect`, this performs exactly one upgrade on
    // the selected TCP/TLS stream, failing on a redirect before auth.
    let Ok((mut socket, _)) = tungstenite::client_tls(url, io) else {
        return;
    };
    let Some(auth) = frame_to_ws(&ClientFrame::mobile_auth(token)) else {
        return;
    };
    if !connection.is_running() || socket.send(auth).is_err() {
        return;
    }
    match socket.get_mut() {
        tungstenite::stream::MaybeTlsStream::Plain(stream) => stream.deadline = None,
        tungstenite::stream::MaybeTlsStream::Rustls(stream) => {
            stream.get_mut().deadline = None;
        }
        _ => return,
    }
    connection.connected.store(true, Ordering::SeqCst);
    while connection.is_running() {
        for frame in outbound.try_iter().take(16) {
            if !connection.is_running() {
                return;
            }
            if let Some(msg) = frame_to_ws(&frame) {
                if socket.send(msg).is_err() {
                    return;
                }
            }
        }
        match socket.read() {
            Ok(tungstenite::Message::Text(text)) => {
                if events.send(parse_server_frame(&text)).is_err() {
                    return;
                }
            }
            Ok(tungstenite::Message::Ping(_)) => {}
            Ok(_) => {}
            Err(tungstenite::Error::Io(err)) if io_timed_out(&err) => {}
            Err(_) => return,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc::channel;

    #[test]
    fn auth_names_the_mobile_client() {
        let value =
            serde_json::to_value(ClientFrame::mobile_auth("jwt")).expect("auth frame serialises");
        assert_eq!(value.get("type").and_then(|v| v.as_str()), Some("auth"));
        assert_eq!(value.get("client").and_then(|v| v.as_str()), Some("mobile"));
    }

    #[test]
    fn control_frames_use_type_and_dm_channel_id() {
        for frame in [
            ClientFrame::DmCallStart {
                dm_channel_id: "d".into(),
            },
            ClientFrame::DmCallAccept {
                dm_channel_id: "d".into(),
            },
            ClientFrame::DmCallReject {
                dm_channel_id: "d".into(),
            },
            ClientFrame::DmCallEnd {
                dm_channel_id: "d".into(),
            },
        ] {
            let value = serde_json::to_value(&frame).expect("frame serialises");
            assert_eq!(value.get("dmChannelId").and_then(|v| v.as_str()), Some("d"));
            assert!(value.get("dm_id").is_none());
            assert!(value.get("op").is_none());
        }
        let start = serde_json::to_value(ClientFrame::DmCallStart {
            dm_channel_id: "d".into(),
        })
        .expect("start serialises");
        assert_eq!(
            start.get("type").and_then(|v| v.as_str()),
            Some("dm_call_start")
        );
        let join = serde_json::to_value(ClientFrame::VoiceJoin {
            channel_id: "v".into(),
        })
        .expect("join serialises");
        assert_eq!(
            join.get("type").and_then(|v| v.as_str()),
            Some("voice_join")
        );
        assert_eq!(join.get("channelId").and_then(|v| v.as_str()), Some("v"));
    }

    #[test]
    fn rejection_is_scoped_to_one_dm() {
        let rejection = ClientFrame::DmCallReject {
            dm_channel_id: "blocked".into(),
        };
        assert!(rejection.is_rejection_for("blocked"));
        assert!(!rejection.is_rejection_for("other"));
        assert!(!ClientFrame::DmCallEnd {
            dm_channel_id: "blocked".into()
        }
        .is_rejection_for("blocked"));
    }

    #[test]
    fn incoming_call_parses_caller_identity() {
        let frame = parse_server_frame(
            r#"{"type":"dm_call_incoming","dmChannelId":"d1","callerId":"u9","callerName":"Ann"}"#,
        );
        assert_eq!(frame.dm_channel_id(), Some("d1"));
        match frame {
            ServerFrame::DmCallIncoming {
                dm_channel_id,
                caller_id,
                caller_name,
            } => {
                assert_eq!(dm_channel_id, "d1");
                assert_eq!(caller_id, "u9");
                assert_eq!(caller_name, "Ann");
            }
            other => panic!("wrong variant: {other:?}"),
        }
    }

    #[test]
    fn voice_state_update_parses_join_and_leave() {
        let join = parse_server_frame(
            r#"{"type":"voice_state_update","channelId":"v1","userId":"u2","action":"join"}"#,
        );
        assert_eq!(
            join,
            ServerFrame::VoiceStateUpdate {
                channel_id: "v1".into(),
                user_id: "u2".into(),
                action: "join".into()
            }
        );
    }

    #[test]
    fn unknown_ops_do_not_break_the_stream() {
        assert_eq!(
            parse_server_frame(r#"{"type":"future_op","anything":1}"#),
            ServerFrame::Unknown
        );
        assert_eq!(parse_server_frame("not json at all"), ServerFrame::Unknown);
        assert_eq!(ServerFrame::Unknown.dm_channel_id(), None);
    }

    #[test]
    fn error_carries_call_correlation() {
        let frame = parse_server_frame(
            r#"{"type":"error","message":"Busy","code":"dm_call_in_progress","dmChannelId":"d1"}"#,
        );
        assert_eq!(frame.dm_channel_id(), Some("d1"));
    }

    #[test]
    fn tls_stack_is_compiled_in_for_wss_urls() {
        // Without a TLS feature this fails fast with
        // `Url(TlsFeatureNotEnabled)`; with `rustls-tls-webpki-roots` the
        // handshake at least reaches the (closed) socket and fails as a
        // plain I/O error instead.
        if let Err(tungstenite::Error::Url(tungstenite::error::UrlError::TlsFeatureNotEnabled)) =
            tungstenite::connect("wss://127.0.0.1:1/")
        {
            panic!("wss support is not compiled in")
        }
    }

    #[test]
    fn ready_parses_spaces_and_dm_channels() {
        let frame = parse_server_frame(
            r#"{"type":"ready","user":{"id":"me","username":"me"},"spaces":[{"id":"s1","name":"One"}],"dmChannels":[],"unreadCounts":{"c1":2},"readStates":[{"channelId":"d1","lastReadMessageId":"m1"}]}"#,
        );
        match frame {
            ServerFrame::Ready {
                user,
                spaces,
                unread_counts,
                read_states,
                ..
            } => {
                assert_eq!(user.id, "me");
                assert_eq!(spaces.len(), 1);
                assert_eq!(unread_counts.get("c1"), Some(&2));
                assert_eq!(read_states.len(), 1);
                assert_eq!(read_states[0].channel_id, "d1");
            }
            other => panic!("wrong variant: {other:?}"),
        }
    }

    #[test]
    fn socket_carries_auth_and_sends_while_idle() {
        // Full duplex against loopback: the server completes the handshake,
        // reads the `auth` frame (mobile client tag), pushes one event, then
        // stays silent. The client must still deliver a later send — the
        // exact scenario where a blocking reader used to starve the writer.
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("loopback listener binds");
        listener
            .set_nonblocking(false)
            .expect("listener is blocking");
        let port = listener.local_addr().expect("listener has a port").port();

        let (sent_tx, sent_rx) = channel();
        let server = std::thread::spawn(move || {
            let (stream, _) = listener.accept().expect("client connects");
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .expect("server read timeout");
            let mut ws = tungstenite::accept(stream).expect("handshake completes");
            let auth = ws.read().expect("auth frame arrives");
            let text = auth.into_text().expect("auth is text");
            assert!(text.contains("\"type\":\"auth\""), "auth tag: {text}");
            assert!(text.contains("\"client\":\"mobile\""), "client tag: {text}");
            ws.send(tungstenite::Message::Text("{\"type\":\"pong\"}".into()))
                .expect("server pushes one event");
            // Then silence: the client send below must still get through.
            let next = ws.read().expect("client send arrives while idle");
            let text = next.into_text().expect("send is text");
            assert!(text.contains("\"type\":\"voice_leave\""), "send: {text}");
            sent_tx.send(()).unwrap();
            ws.get_mut()
                .set_read_timeout(Some(Duration::from_millis(900)))
                .unwrap();
            let next = ws.read();
            assert!(
                !matches!(next, Err(tungstenite::Error::Io(err)) if io_timed_out(&err)),
                "socket stayed open after logout"
            );
        });

        let (tx, rx) = channel();
        let url = format!("ws://127.0.0.1:{port}/ws");
        let handle = spawn_ws(url, "test-token".into(), tx);
        let frame = rx
            .recv_timeout(Duration::from_secs(5))
            .expect("server event is dispatched");
        assert_eq!(frame, ServerFrame::Pong);
        assert!(handle.is_alive());
        assert!(handle.send(ClientFrame::VoiceLeave));
        sent_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        handle.shutdown();
        server.join().expect("server thread finishes");
    }

    #[test]
    fn ws_does_not_follow_redirects_with_session_credentials() {
        use std::io::{Read, Write};
        let source = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let target = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let from = source.local_addr().unwrap();
        let to = target.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = source.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut request = Vec::new();
            while !request.ends_with(b"\r\n\r\n") {
                let mut byte = [0];
                stream.read_exact(&mut byte).unwrap();
                request.push(byte[0]);
            }
            write!(
                stream,
                "HTTP/1.1 302 Found\r\nLocation: ws://{to}/ws\r\nContent-Length: 0\r\n\r\n"
            )
            .unwrap();
        });
        let (tx, rx) = channel();
        let handle = spawn_ws(format!("ws://{from}/ws"), "test-token".into(), tx);
        server.join().unwrap();
        assert!(matches!(
            rx.recv_timeout(Duration::from_millis(900)),
            Err(mpsc::RecvTimeoutError::Disconnected)
        ));
        assert!(!handle.is_alive());
        target.set_nonblocking(true).unwrap();
        assert!(
            matches!(target.accept(), Err(err) if err.kind() == std::io::ErrorKind::WouldBlock)
        );
    }

    #[test]
    fn pending_upgrade_cannot_send_and_is_cancelled_on_logout() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let (tx, rx) = channel();
        let handle = spawn_ws(format!("ws://{address}/ws"), "test-token".into(), tx);
        let (mut stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        let mut request = Vec::new();
        while !request.ends_with(b"\r\n\r\n") {
            let mut byte = [0];
            stream.read_exact(&mut byte).unwrap();
            request.push(byte[0]);
        }
        assert!(handle.is_running());
        assert!(!handle.is_alive());
        assert!(!handle.send(ClientFrame::VoiceLeave));
        handle.shutdown();
        assert!(matches!(
            rx.recv_timeout(Duration::from_secs(1)),
            Err(mpsc::RecvTimeoutError::Disconnected)
        ));
        assert!(!handle.is_running());
        match stream.read(&mut [0]) {
            Ok(0) => (),
            Err(err) if !io_timed_out(&err) => (),
            result => panic!("unexpected read after logout: {result:?}"),
        }
    }
}
