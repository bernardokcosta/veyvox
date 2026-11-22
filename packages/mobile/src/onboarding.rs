//! Native counterpart of instance-picker.html and the web LoginPage.
use egui::{
    vec2, Align, Button, Color32, Context, FontData, FontDefinitions, FontFamily, FontId, Frame,
    Layout, Margin, Response, RichText, ScrollArea, Stroke, TextEdit, Ui, Vec2,
};

const BASE: Color32 = Color32::from_rgb(11, 11, 16);
const CARD: Color32 = Color32::from_rgb(37, 37, 48);
const INPUT: Color32 = Color32::from_rgb(17, 17, 24);
const TEXT: Color32 = Color32::from_rgb(239, 239, 239);
const MUTED: Color32 = Color32::from_rgb(176, 176, 186);
const ERROR: Color32 = Color32::from_rgb(253, 164, 175);
const TOUCH: f32 = super::screens::TOUCH_TARGET;

#[derive(Clone, Copy, Hash)]
pub(crate) enum Field {
    Server,
    Username,
    Password,
}

impl Field {
    pub(crate) fn id(self) -> egui::Id {
        egui::Id::new(("veyvox-onboarding", self))
    }
}

pub(crate) fn clear_credential_editors(ctx: &Context) {
    for field in [Field::Username, Field::Password] {
        let id = field.id();
        ctx.memory_mut(|memory| memory.surrender_focus(id));
        ctx.data_mut(|data| data.remove::<egui::text_edit::TextEditState>(id));
    }
}

#[derive(Clone, Copy, Default)]
pub(crate) enum Language {
    #[default]
    English,
    Portuguese,
}

pub(crate) struct Copy {
    pub welcome: &'static str,
    pub connect_prompt: &'static str,
    pub server: &'static str,
    pub continue_action: &'static str,
    pub invalid_server: &'static str,
    pub change_server: &'static str,
    pub login_title: &'static str,
    pub login_prompt: &'static str,
    pub username: &'static str,
    pub password: &'static str,
    pub username_required: &'static str,
    pub password_required: &'static str,
    pub show: &'static str,
    pub hide: &'static str,
    pub submit: &'static str,
    pub submitting: &'static str,
    pub failed: &'static str,
}

impl Language {
    pub(crate) fn from_tag(tag: &str) -> Self {
        match tag.split(['-', '_', '.']).next() {
            Some("pt") => Self::Portuguese,
            _ => Self::English,
        }
    }

    pub(crate) fn copy(self) -> Copy {
        match self {
            Self::English => Copy {
                welcome: "Welcome to Veyvox",
                connect_prompt: "Connect to your instance",
                server: "Server address",
                continue_action: "Continue",
                invalid_server: "Enter a valid server address.",
                change_server: "Change server",
                login_title: "Welcome back!",
                login_prompt: "We're so excited to see you again!",
                username: "Username",
                password: "Password",
                username_required: "Username is required",
                password_required: "Password is required",
                show: "Show",
                hide: "Hide",
                submit: "Log In",
                submitting: "Logging in…",
                failed: "Couldn't log in. Check your server address and credentials, then try again.",
            },
            Self::Portuguese => Copy {
                welcome: "Boas-vindas ao Veyvox",
                connect_prompt: "Conecte-se à sua instância",
                server: "Endereço do servidor",
                continue_action: "Continuar",
                invalid_server: "Digite um endereço de servidor válido.",
                change_server: "Trocar servidor",
                login_title: "Boas-vindas de volta!",
                login_prompt: "Estamos muito felizes em ver você novamente!",
                username: "Nome de usuário",
                password: "Senha",
                username_required: "O nome de usuário é obrigatório",
                password_required: "A senha é obrigatória",
                show: "Mostrar",
                hide: "Ocultar",
                submit: "Entrar",
                submitting: "Entrando…",
                failed: "Não foi possível entrar. Confira o endereço do servidor e suas credenciais e tente novamente.",
            },
        }
    }
}

fn dm_sans(bold: bool, size: f32) -> FontId {
    FontId::new(
        size,
        FontFamily::Name(if bold { "dm-sans-bold" } else { "dm-sans" }.into()),
    )
}

pub(crate) fn install_fonts(ctx: &Context) {
    let mut fonts = FontDefinitions::default();
    for (name, bytes) in [
        (
            "dm-sans",
            include_bytes!("../assets/DMSans-Regular.ttf").as_slice(),
        ),
        (
            "dm-sans-bold",
            include_bytes!("../assets/DMSans-Bold.ttf").as_slice(),
        ),
    ] {
        let mut family = vec![name.to_owned()];
        family.extend(fonts.families[&FontFamily::Proportional].iter().cloned());
        fonts
            .font_data
            .insert(name.to_owned(), FontData::from_static(bytes).into());
        fonts.families.insert(FontFamily::Name(name.into()), family);
    }
    ctx.set_fonts(fonts);
}

pub(crate) fn page(ctx: &Context, login: bool, content: impl FnOnce(&mut Ui)) {
    egui::CentralPanel::default()
        .frame(Frame::new().fill(BASE))
        .show(ctx, |ui| {
            let top = ((ui.available_height() - if login { 468.0 } else { 260.0 }) / 2.0).max(16.0);
            ScrollArea::vertical()
                .auto_shrink([false; 2])
                .show(ui, |ui| {
                    ui.add_space(top);
                    let width = ui.available_width();
                    let card_width = (width - 32.0).clamp(0.0, 480.0);
                    ui.horizontal(|ui| {
                        ui.spacing_mut().item_spacing.x = 0.0;
                        ui.add_space((width - card_width) / 2.0);
                        ui.allocate_ui_with_layout(
                            vec2(card_width, 0.0),
                            Layout::top_down(Align::Min),
                            |ui| {
                                let padding = if card_width < 420.0 { 24 } else { 32 };
                                Frame::new()
                                    .fill(CARD)
                                    .inner_margin(Margin::same(padding))
                                    .corner_radius(6)
                                    .show(ui, |ui| {
                                        let width =
                                            (card_width - 2.0 * f32::from(padding)).max(0.0);
                                        ui.set_width(width);
                                        ui.spacing_mut().item_spacing = vec2(8.0, 0.0);
                                        content(ui);
                                    });
                            },
                        );
                    });
                    ui.add_space(24.0);
                });
        });
}

pub(crate) fn header(ui: &mut Ui, title: &str, subtitle: &str) {
    ui.vertical_centered(|ui| {
        ui.label(RichText::new(title).font(dm_sans(true, 24.0)).color(TEXT));
        ui.add_space(4.0);
        ui.label(
            RichText::new(subtitle)
                .font(dm_sans(false, 15.0))
                .color(MUTED),
        );
    });
    ui.add_space(24.0);
}

pub(crate) fn error(ui: &mut Ui, text: &str) {
    if text.is_empty() {
        return;
    }
    Frame::new()
        .fill(Color32::from_rgb(61, 43, 59))
        .corner_radius(4)
        .inner_margin(Margin::same(12))
        .show(ui, |ui| {
            ui.set_width(ui.available_width());
            ui.label(RichText::new(text).font(dm_sans(false, 14.0)).color(ERROR));
        });
    ui.add_space(16.0);
}

pub(crate) fn field_label(ui: &mut Ui, text: &str, required: bool) -> Response {
    let mut job = egui::text::LayoutJob::default();
    job.append(
        &text.to_uppercase(),
        0.0,
        egui::TextFormat::simple(dm_sans(true, 12.0), MUTED),
    );
    if required {
        job.append(
            " *",
            0.0,
            egui::TextFormat::simple(dm_sans(true, 12.0), ERROR),
        );
    }
    let response = ui.label(job);
    ui.add_space(8.0);
    response
}

pub(crate) fn input(
    ui: &mut Ui,
    value: &mut String,
    label: &Response,
    field: Field,
    hint: &str,
    password: bool,
) -> Response {
    ui.scope(|ui| {
        let visuals = ui.visuals_mut();
        visuals.override_text_color = Some(TEXT);
        let accent = super::screens::ACCENT;
        for state in [
            &mut visuals.widgets.inactive,
            &mut visuals.widgets.hovered,
            &mut visuals.widgets.active,
        ] {
            state.bg_stroke = Stroke::NONE;
            state.corner_radius = 4.into();
            state.expansion = 0.0;
        }
        visuals.selection.stroke = Stroke::new(2.0_f32, accent);
        visuals.selection.bg_fill = accent.gamma_multiply(0.45);
        ui.add(
            TextEdit::singleline(value)
                .id(field.id())
                .password(password)
                .font(dm_sans(false, 16.0))
                .hint_text(RichText::new(hint).color(MUTED))
                .background_color(INPUT)
                .margin(Margin::symmetric(12, 8))
                .vertical_align(Align::Center)
                .desired_width(f32::INFINITY)
                .min_size(vec2(0.0, TOUCH)),
        )
        .labelled_by(label.id)
    })
    .inner
}

pub(crate) fn primary(ui: &mut Ui, text: &str) -> Response {
    ui.scope(|ui| {
        let widgets = &mut ui.visuals_mut().widgets;
        for (state, fill) in [
            (&mut widgets.inactive, super::screens::ACCENT),
            (&mut widgets.hovered, Color32::from_rgb(132, 119, 247)),
            (&mut widgets.active, Color32::from_rgb(107, 92, 224)),
        ] {
            state.weak_bg_fill = fill;
            state.bg_fill = fill;
            state.corner_radius = 4.into();
            state.expansion = 0.0;
        }
        ui.add_sized(
            vec2(ui.available_width(), TOUCH),
            Button::new(
                RichText::new(text)
                    .font(dm_sans(true, 15.0))
                    .color(Color32::WHITE),
            ),
        )
    })
    .inner
}

pub(crate) fn secondary(ui: &mut Ui, text: &str) -> Response {
    ui.add(
        Button::new(
            RichText::new(text)
                .font(dm_sans(false, 14.0))
                .color(Color32::from_rgb(195, 185, 255)),
        )
        .frame(false)
        .min_size(Vec2::new(TOUCH, TOUCH)),
    )
}

pub(crate) fn selected_server(ui: &mut Ui, server: &str, action: &str) -> Response {
    ui.vertical_centered(|ui| {
        ui.label(
            RichText::new(server)
                .font(dm_sans(false, 13.0))
                .color(MUTED),
        );
        secondary(ui, action)
    })
    .inner
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn portuguese_system_locale_uses_the_web_login_title() {
        assert_eq!(
            Language::from_tag("pt-BR").copy().login_title,
            "Boas-vindas de volta!"
        );
        assert_eq!(
            Language::from_tag("en-US").copy().login_title,
            "Welcome back!"
        );
    }

    #[test]
    fn auth_card_has_equal_side_margins_at_phone_and_tablet_widths() {
        for width in [320.0, 390.0, 820.0] {
            let ctx = Context::default();
            install_fonts(&ctx);
            let output = ctx.run(
                egui::RawInput {
                    screen_rect: Some(egui::Rect::from_min_size(
                        egui::Pos2::ZERO,
                        vec2(width, 780.0),
                    )),
                    ..Default::default()
                },
                |ctx| {
                    page(ctx, false, |ui| {
                        header(ui, "Welcome", "Connect");
                    })
                },
            );
            let rect = output
                .shapes
                .iter()
                .find_map(|clipped| match &clipped.shape {
                    egui::Shape::Rect(shape) if shape.fill == CARD => Some(shape.rect),
                    _ => None,
                })
                .expect("auth card is rendered");
            assert_eq!(rect.center().x, width / 2.0);
            assert!(rect.left() >= 16.0 && rect.width() <= 480.0);
        }
    }
}
