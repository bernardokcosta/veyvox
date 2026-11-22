//! Voice call state machine.
//!
//! Mirrors the web `voiceStore` + `utils/voiceActions` rules 1:1
//! (`docs/systems/voice.md`):
//!
//! - one active space voice channel at a time (`current_voice_channel_id`);
//! - one active DM call at a time (`active_dm_call`);
//! - an outgoing DM ring (`outgoing_call`) blocks a second start;
//! - an incoming DM ring (`incoming_call`) blocks a second start;
//! - `can_start_dm_call` is the single gate both the mini-bar and the
//!   full-screen button read, so the two surfaces cannot disagree;
//! - refusing a ringing DM is scoped to that DM before any pre-arm/send,
//!   and the button for a refused DM is disabled (DM refusal audit).
//!
//! Signaling itself (WS `voice_join` / `dm_call_*` frames, LiveKit token
//! fetch) lives in `ws.rs` / `api.rs`; this module is the pure state
//! machine both surfaces read, so it stays unit-testable with no network.

use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CallRole {
    Space,
    Dm,
}

/// An incoming DM ring: which DM, who is calling, and the name to show.
/// Mirrors the web `incomingCall` object (`dmChannelId`, `callerId`,
/// `callerName`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IncomingCall {
    pub dm_id: String,
    pub caller_id: String,
    pub caller_name: String,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct VoiceState {
    pub current_voice_channel_id: Option<String>,
    pub active_dm_call: Option<String>,
    pub outgoing_call: Option<String>,
    pub incoming_call: Option<IncomingCall>,
    pub muted: bool,
    pub deafened: bool,
    pub camera_on: bool,
    pub screen_sharing: bool,
    /// DM ids with a cancel already queued (ping/pong guard).
    pub pending_dm_cancels: HashSet<String>,
    /// dm_id -> wall-clock ms until which a re-ring is suppressed.
    pub dm_waiting_until: HashMap<String, u64>,
    pub participants: HashMap<String, Vec<String>>,
}

impl VoiceState {
    pub fn in_any_call(&self) -> bool {
        self.current_voice_channel_id.is_some() || self.active_dm_call.is_some()
    }

    pub fn in_space_call(&self, channel_id: &str) -> bool {
        self.current_voice_channel_id.as_deref() == Some(channel_id)
    }

    pub fn incoming_dm_id(&self) -> Option<&str> {
        self.incoming_call.as_ref().map(|c| c.dm_id.as_str())
    }

    /// Single gate for starting a DM call. Mirrors web `canStartDmCall`
    /// (no active/outgoing/incoming call) plus the re-ring and pending
    /// cancel guards, so a cancelled ring cannot fire twice.
    pub fn can_start_dm_call(&self, dm_id: &str, now_ms: u64) -> bool {
        if self.active_dm_call.is_some() {
            return false;
        }
        if self.outgoing_call.is_some() || self.incoming_call.is_some() {
            return false;
        }
        if self.current_voice_channel_id.is_some() {
            return false;
        }
        if self.pending_dm_cancels.contains(dm_id) {
            return false;
        }
        if let Some(until) = self.dm_waiting_until.get(dm_id) {
            if now_ms < *until {
                return false;
            }
        }
        true
    }

    /// Starts an outgoing DM ring. Returns false when the gate refuses.
    pub fn start_dm_call(&mut self, dm_id: &str, now_ms: u64) -> bool {
        if !self.can_start_dm_call(dm_id, now_ms) {
            return false;
        }
        self.outgoing_call = Some(dm_id.to_string());
        true
    }

    pub fn cancel_outgoing_dm_call(&mut self, dm_id: &str, now_ms: u64) {
        if self.outgoing_call.as_deref() == Some(dm_id) {
            self.outgoing_call = None;
        }
        // Suppress the immediate re-ring (ping/pong guard).
        self.dm_waiting_until
            .insert(dm_id.to_string(), now_ms.saturating_add(1_500));
        self.pending_dm_cancels.remove(dm_id);
    }

    pub fn queue_dm_cancel(&mut self, dm_id: &str) {
        self.pending_dm_cancels.insert(dm_id.to_string());
    }

    pub fn ring_incoming(&mut self, call: IncomingCall) {
        self.incoming_call = Some(call);
    }

    pub fn accept_dm_call(&mut self, dm_id: &str) {
        self.incoming_call = None;
        self.outgoing_call = None;
        self.current_voice_channel_id = None;
        self.active_dm_call = Some(dm_id.to_string());
    }

    /// Refuses an incoming DM call. The refused DM is the only one cleared;
    /// any other ring is left untouched (blocked-DM audit).
    pub fn refuse_dm_call(&mut self, dm_id: &str) {
        if self.incoming_dm_id() == Some(dm_id) {
            self.incoming_call = None;
        }
        self.dm_waiting_until.remove(dm_id);
        self.pending_dm_cancels.remove(dm_id);
    }

    pub fn end_dm_call(&mut self, dm_id: &str) {
        if self.active_dm_call.as_deref() == Some(dm_id) {
            self.active_dm_call = None;
        }
        if self.outgoing_call.as_deref() == Some(dm_id) {
            self.outgoing_call = None;
        }
        if self.incoming_dm_id() == Some(dm_id) {
            self.incoming_call = None;
        }
        self.dm_waiting_until.remove(dm_id);
        self.pending_dm_cancels.remove(dm_id);
        self.participants.remove(dm_id);
    }

    pub fn join_space_voice(&mut self, channel_id: &str) -> bool {
        if self.active_dm_call.is_some() {
            return false;
        }
        self.current_voice_channel_id = Some(channel_id.to_string());
        true
    }

    pub fn leave_space_voice(&mut self) {
        self.current_voice_channel_id = None;
        self.muted = false;
        self.deafened = false;
        self.camera_on = false;
        self.screen_sharing = false;
    }

    pub fn toggle_mic(&mut self) {
        self.muted = !self.muted;
        if self.muted {
            self.camera_on = false;
        }
    }

    pub fn toggle_deafen(&mut self) {
        self.deafened = !self.deafened;
        if self.deafened {
            self.muted = true;
        }
    }

    pub fn set_participants(&mut self, channel_id: &str, user_ids: Vec<String>) {
        self.participants.insert(channel_id.to_string(), user_ids);
    }

    pub fn participant_count(&self, channel_id: &str) -> usize {
        self.participants.get(channel_id).map(Vec::len).unwrap_or(0)
    }
}

#[cfg(test)]
#[allow(clippy::field_reassign_with_default)]
mod tests {
    use super::*;

    fn incoming(dm_id: &str) -> IncomingCall {
        IncomingCall {
            dm_id: dm_id.to_string(),
            caller_id: "u9".to_string(),
            caller_name: "Ann".to_string(),
        }
    }

    #[test]
    fn idle_dm_can_start() {
        let voice = VoiceState::default();
        assert!(voice.can_start_dm_call("d1", 10_000));
    }

    #[test]
    fn busy_states_block_dm_start() {
        let mut voice = VoiceState::default();
        voice.active_dm_call = Some("d9".into());
        assert!(!voice.can_start_dm_call("d1", 0));

        let mut voice = VoiceState::default();
        voice.outgoing_call = Some("d2".into());
        assert!(!voice.can_start_dm_call("d1", 0));

        let mut voice = VoiceState::default();
        voice.incoming_call = Some(incoming("d3"));
        assert!(!voice.can_start_dm_call("d1", 0));

        let mut voice = VoiceState::default();
        voice.current_voice_channel_id = Some("v1".into());
        assert!(!voice.can_start_dm_call("d1", 0));
    }

    #[test]
    fn pending_cancel_and_rering_guard_block_start() {
        let mut voice = VoiceState::default();
        voice.queue_dm_cancel("d1");
        assert!(!voice.can_start_dm_call("d1", 0));
        assert!(voice.can_start_dm_call("d2", 0));

        let mut voice = VoiceState::default();
        voice.dm_waiting_until.insert("d1".into(), 5_000);
        assert!(!voice.can_start_dm_call("d1", 4_999));
        assert!(voice.can_start_dm_call("d1", 5_000));
    }

    #[test]
    fn cancel_suppresses_immediate_rering() {
        let mut voice = VoiceState::default();
        assert!(voice.start_dm_call("d1", 0));
        voice.cancel_outgoing_dm_call("d1", 1_000);
        assert_eq!(voice.outgoing_call, None);
        assert!(!voice.can_start_dm_call("d1", 1_001));
        assert!(voice.can_start_dm_call("d1", 2_500));
    }

    #[test]
    fn refusal_only_clears_the_refused_dm() {
        let mut voice = VoiceState::default();
        voice.ring_incoming(incoming("blocked"));
        voice.refuse_dm_call("blocked");
        assert_eq!(voice.incoming_call, None);

        let mut voice = VoiceState::default();
        voice.ring_incoming(incoming("other"));
        voice.refuse_dm_call("blocked");
        assert_eq!(voice.incoming_dm_id(), Some("other"));
    }

    #[test]
    fn accept_clears_ring_and_activates() {
        let mut voice = VoiceState::default();
        voice.ring_incoming(incoming("d1"));
        voice.accept_dm_call("d1");
        assert_eq!(voice.incoming_call, None);
        assert_eq!(voice.active_dm_call.as_deref(), Some("d1"));
    }

    #[test]
    fn space_join_refused_during_dm_call() {
        let mut voice = VoiceState::default();
        voice.active_dm_call = Some("d1".into());
        assert!(!voice.join_space_voice("v1"));
        voice.active_dm_call = None;
        assert!(voice.join_space_voice("v1"));
        assert!(voice.in_space_call("v1"));
    }

    #[test]
    fn deafen_forces_mute_like_web() {
        let mut voice = VoiceState::default();
        voice.toggle_deafen();
        assert!(voice.deafened);
        assert!(voice.muted);
    }
}
