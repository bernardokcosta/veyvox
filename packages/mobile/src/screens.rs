//! Shared mobile UI primitives.
//!
//! 1:1 with the web `MobileShell` chrome: 56 px bottom tab bar with the
//! safe-area inset, pushed-screen stack with back headers, 44 px minimum
//! touch targets, and the same DM-call button states as
//! `MobileChatScreen` (Idle / Ringing / In call / Busy, first match wins).
//!
//! Pure helpers are unit-tested here; the screen bodies live in `lib.rs`
//! (`render_spaces_tab`, `render_dms_tab`, …) so there is exactly one
//! owner for egui frame code.

use crate::voice::VoiceState;

/// Minimum touch target, px. Matches the 44 px DM-call tap target.
pub const TOUCH_TARGET: f32 = 44.0;
/// Bottom tab bar height before the safe-area inset (matches web 56 px).
pub const TAB_BAR_HEIGHT: f32 = 56.0;
/// Brand accent used for the active tab + primary actions (`#7c6cf6`).
pub const ACCENT: egui::Color32 = egui::Color32::from_rgb(0x7c, 0x6c, 0xf6);

/// DM-call button state. First match wins, exactly like the web header.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DmCallButton {
    InCall,
    Ringing,
    Idle,
    Busy,
}

impl DmCallButton {
    pub fn label(self) -> &'static str {
        match self {
            DmCallButton::InCall => "In call — open",
            DmCallButton::Ringing => "Ringing — cancel",
            DmCallButton::Idle => "Start call",
            DmCallButton::Busy => "Unavailable",
        }
    }

    pub fn enabled(self) -> bool {
        !matches!(self, DmCallButton::Busy)
    }
}

/// Resolves the DM-call button for one DM, mirroring `MobileChatScreen`:
/// in-call > ringing > idle (gate allows) > busy.
pub fn dm_call_button(
    voice: &VoiceState,
    dm_id: &str,
    is_deleted_partner: bool,
    now_ms: u64,
) -> DmCallButton {
    if is_deleted_partner {
        return DmCallButton::Busy;
    }
    if voice.active_dm_call.as_deref() == Some(dm_id) {
        return DmCallButton::InCall;
    }
    if voice.outgoing_call.as_deref() == Some(dm_id) {
        return DmCallButton::Ringing;
    }
    if voice.can_start_dm_call(dm_id, now_ms) {
        DmCallButton::Idle
    } else {
        DmCallButton::Busy
    }
}

/// Badge text for the DMs tab. Caps at `99+`, like `MobileBottomNav`.
pub fn dm_badge_text(count: usize) -> Option<String> {
    if count == 0 {
        None
    } else if count > 99 {
        Some("99+".to_string())
    } else {
        Some(count.to_string())
    }
}

/// The bottom tab bar hides whenever a pushed screen is on top.
pub fn should_show_bottom_nav(stack_len: usize) -> bool {
    stack_len == 0
}

/// Draws the 56 px bottom tab bar with three 44 px+ targets.
/// Returns the tab the user tapped, if any.
pub fn bottom_nav(
    ui: &mut egui::Ui,
    active: crate::state::Tab,
    dm_unread: usize,
    space_unread: bool,
) -> Option<crate::state::Tab> {
    let mut tapped = None;
    ui.horizontal(|ui| {
        ui.set_min_height(TAB_BAR_HEIGHT.max(TOUCH_TARGET));
        tapped = tab_button(
            ui,
            "Spaces",
            active == crate::state::Tab::Spaces,
            space_unread,
        )
        .then_some(crate::state::Tab::Spaces)
        .or(tapped);
        let dm_label = match dm_badge_text(dm_unread) {
            Some(n) => format!("DMs ({n})"),
            None => "DMs".to_string(),
        };
        tapped = tab_button(
            ui,
            &dm_label,
            active == crate::state::Tab::Dms,
            dm_unread > 0,
        )
        .then_some(crate::state::Tab::Dms)
        .or(tapped);
        tapped = tab_button(ui, "You", active == crate::state::Tab::You, false)
            .then_some(crate::state::Tab::You)
            .or(tapped);
    });
    tapped
}

fn tab_button(ui: &mut egui::Ui, label: &str, active: bool, dot: bool) -> bool {
    let text = if dot {
        format!("● {label}")
    } else {
        label.to_string()
    };
    let button = egui::Button::new(text).min_size(egui::vec2(88.0, TOUCH_TARGET));
    let response = ui.add(button);
    if active {
        ui.painter().rect_stroke(
            response.rect,
            8.0,
            egui::Stroke::new(1.0_f32, ACCENT),
            egui::StrokeKind::Middle,
        );
    }
    response.clicked()
}

/// Pushed-screen header with a back chevron. Mirrors `MobileScreenHeader`.
pub fn screen_header(ui: &mut egui::Ui, title: &str) -> bool {
    let mut back = false;
    ui.horizontal(|ui| {
        ui.set_min_height(TOUCH_TARGET);
        if ui
            .add(egui::Button::new("‹ Back").min_size(egui::vec2(88.0, TOUCH_TARGET)))
            .clicked()
        {
            back = true;
        }
        ui.heading(title);
    });
    ui.separator();
    back
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::voice::VoiceState;

    #[test]
    fn badge_caps_like_web() {
        assert_eq!(dm_badge_text(0), None);
        assert_eq!(dm_badge_text(3), Some("3".to_string()));
        assert_eq!(dm_badge_text(99), Some("99".to_string()));
        assert_eq!(dm_badge_text(100), Some("99+".to_string()));
    }

    #[test]
    fn bottom_nav_hides_on_stack() {
        assert!(should_show_bottom_nav(0));
        assert!(!should_show_bottom_nav(1));
    }

    #[test]
    fn dm_button_first_match_wins() {
        let mut voice = VoiceState::default();
        assert_eq!(dm_call_button(&voice, "d1", false, 0), DmCallButton::Idle);
        voice.outgoing_call = Some("d1".into());
        assert_eq!(
            dm_call_button(&voice, "d1", false, 0),
            DmCallButton::Ringing
        );
        voice.outgoing_call = None;
        voice.active_dm_call = Some("d1".into());
        assert_eq!(dm_call_button(&voice, "d1", false, 0), DmCallButton::InCall);
        assert_eq!(dm_call_button(&voice, "d1", true, 0), DmCallButton::Busy);
        let busy = VoiceState {
            current_voice_channel_id: Some("v".into()),
            ..VoiceState::default()
        };
        assert_eq!(dm_call_button(&busy, "d9", false, 0), DmCallButton::Busy);
    }
}
