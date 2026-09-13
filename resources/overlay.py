"""
Native macOS overlay for video-translator host.
- Auto-hides: appears only when mouse is near top of screen
- Full controls: Mic, Mouse, Keyboard, Stop
- Communicates with Electron via JSON stdin/stdout

Electron -> Python:
  {"type": "state", "micOn": bool, "allowMouse": bool, "allowKeyboard": bool}
  {"type": "quit"}

Python -> Electron:
  {"action": "stop"}
  {"action": "toggle-mic"}
  {"action": "toggle-mouse"}
  {"action": "toggle-keyboard"}
"""

import sys
import json
import threading
import Cocoa
import AppKit
import objc
import Quartz
import subprocess
from PyObjCTools import AppHelper

# ── Shared state ────────────────────────────────────────────────────────────────
_state = {"micOn": False, "allowMouse": True, "allowKeyboard": False}
_buttons = {}
_win_ref = [None]           # [NSPanel]
_visible = [False]          # current alpha state

HOVER_ZONE = 64             # px from top to trigger show
HIDE_DELAY = 1.8            # seconds to wait before hiding

# ── IPC ─────────────────────────────────────────────────────────────────────────
def send_action(action: str):
    sys.stdout.write(json.dumps({"action": action}) + "\n")
    sys.stdout.flush()

# ── Window show/hide ─────────────────────────────────────────────────────────────
_hide_timer = [None]

def _cancel_hide_timer():
    if _hide_timer[0]:
        _hide_timer[0].invalidate()
        _hide_timer[0] = None

def show_overlay():
    win = _win_ref[0]
    if not win or _visible[0]:
        return
    _visible[0] = True
    _cancel_hide_timer()
    AppKit.NSAnimationContext.runAnimationGroup_completionHandler_(
        lambda ctx: (ctx.setDuration_(0.2), win.animator().setAlphaValue_(1.0)),
        None
    )

def schedule_hide():
    _cancel_hide_timer()
    timer = Cocoa.NSTimer.scheduledTimerWithTimeInterval_target_selector_userInfo_repeats_(
        HIDE_DELAY,
        AppKit.NSApplication.sharedApplication().delegate(),
        objc.selector(None, selector=b"doHide:", signature=b"v@:@"),
        None,
        False,
    )
    _hide_timer[0] = timer

def hide_overlay_now():
    win = _win_ref[0]
    if not win or not _visible[0]:
        return
    _visible[0] = False
    _cancel_hide_timer()
    AppKit.NSAnimationContext.runAnimationGroup_completionHandler_(
        lambda ctx: (ctx.setDuration_(0.35), win.animator().setAlphaValue_(0.0)),
        None
    )

_labels = {}
def refresh_buttons():
    for key in ("mic", "mouse", "keyboard"):
        sw = _buttons.get(key)
        lbl = _labels.get(key)
        if not sw or not lbl:
            continue
        state_key = {"mic": "micOn", "mouse": "allowMouse", "keyboard": "allowKeyboard"}[key]
        is_on = _state.get(state_key, False)
        sw.setState_(1 if is_on else 0)
        
        if is_on:
            lbl.setTextColor_(AppKit.NSColor.colorWithRed_green_blue_alpha_(0.20, 0.85, 0.60, 1.0))
        else:
            lbl.setTextColor_(AppKit.NSColor.colorWithRed_green_blue_alpha_(0.95, 0.35, 0.35, 1.0))

# ── Button target ────────────────────────────────────────────────────────────────
class BtnTarget(AppKit.NSObject):

    def handleMic_(self, sender):
        _state["micOn"] = not _state["micOn"]
        refresh_buttons()
        send_action("toggle-mic")

    def handleMouse_(self, sender):
        _state["allowMouse"] = not _state["allowMouse"]
        refresh_buttons()
        send_action("toggle-mouse")

    def handleKeyboard_(self, sender):
        _state["allowKeyboard"] = not _state["allowKeyboard"]
        refresh_buttons()
        send_action("toggle-keyboard")

    def handleStop_(self, sender):
        send_action("stop")

# ── App delegate ─────────────────────────────────────────────────────────────────
class AppDelegate(AppKit.NSObject):

    def applicationDidFinishLaunching_(self, notification):
        target = BtnTarget.alloc().init()
        self._target = target  # strong ref

        sw_width = AppKit.NSScreen.mainScreen().frame().size.width
        sh_height = AppKit.NSScreen.mainScreen().frame().size.height
        W, H = 500, 52
        ox = (sw_width - W) / 2
        oy = sh_height - H - 42  # 42px from top to avoid MacBook notch

        win = AppKit.NSPanel.alloc().initWithContentRect_styleMask_backing_defer_(
            AppKit.NSMakeRect(ox, oy, W, H),
            AppKit.NSWindowStyleMaskBorderless,
            AppKit.NSBackingStoreBuffered,
            False,
        )
        win.setOpaque_(False)
        win.setBackgroundColor_(AppKit.NSColor.clearColor())
        win.setHasShadow_(True)
        win.setMovableByWindowBackground_(True)
        win.setHidesOnDeactivate_(False)
        win.setAlphaValue_(0.0)      # start hidden

        # ── Magic overlay flags (same as GhostNote) ────────────────────────────
        win.setLevel_(Cocoa.NSScreenSaverWindowLevel)
        win.setCollectionBehavior_(1 | 256 | 1024)  # CanJoinAllSpaces|FullScreenAux|Stationary
        win.setHidesOnDeactivate_(False)

        # ── Background: Native macOS Vibrancy ─────────────────────────────────
        vfx = AppKit.NSVisualEffectView.alloc().initWithFrame_(
            AppKit.NSMakeRect(0, 0, W, H)
        )
        vfx.setMaterial_(AppKit.NSVisualEffectMaterialDark)
        vfx.setBlendingMode_(AppKit.NSVisualEffectBlendingModeBehindWindow)
        vfx.setState_(AppKit.NSVisualEffectStateActive)
        vfx.setWantsLayer_(True)
        vfx.layer().setCornerRadius_(14)
        vfx.layer().setMasksToBounds_(True)
        
        win.setContentView_(vfx)

        # ── Status dot + label ────────────────────────────────────────────────
        dot = AppKit.NSTextField.labelWithString_("●")
        dot.setTextColor_(AppKit.NSColor.colorWithRed_green_blue_alpha_(0.20, 0.85, 0.60, 1.0))
        dot.setFont_(AppKit.NSFont.systemFontOfSize_(11))
        dot.setFrame_(AppKit.NSMakeRect(20, 17, 14, 18))
        vfx.addSubview_(dot)

        lbl = AppKit.NSTextField.labelWithString_("На лінії")
        lbl.setTextColor_(AppKit.NSColor.colorWithWhite_alpha_(0.80, 1.0))
        lbl.setFont_(AppKit.NSFont.systemFontOfSize_weight_(11, AppKit.NSFontWeightSemibold))
        lbl.setFrame_(AppKit.NSMakeRect(36, 17, 72, 18))
        vfx.addSubview_(lbl)

        # ── Separator ─────────────────────────────────────────────────────────
        def sep(x):
            s = AppKit.NSBox.alloc().initWithFrame_(AppKit.NSMakeRect(x, 8, 1, 36))
            s.setBoxType_(AppKit.NSBoxSeparator)
            vfx.addSubview_(s)

        sep(110)

        # ── Toggle Switches (Native macOS Control Center style) ───────────────
        def make_switch(x, sel_name):
            sw = AppKit.NSSwitch.alloc().initWithFrame_(AppKit.NSMakeRect(x, 15, 40, 22))
            sw.setTarget_(target)
            sw.setAction_(sel_name)
            vfx.addSubview_(sw)
            return sw

        def make_lbl(text, x, w):
            lbl = AppKit.NSTextField.labelWithString_(text)
            lbl.setFont_(AppKit.NSFont.systemFontOfSize_weight_(12, AppKit.NSFontWeightSemibold))
            lbl.setFrame_(AppKit.NSMakeRect(x, 17, w, 18))
            vfx.addSubview_(lbl)
            return lbl

        _buttons["mic"]      = make_switch(125, "handleMic:")
        _labels["mic"]       = make_lbl("Мік", 165, 30)

        _buttons["mouse"]    = make_switch(220, "handleMouse:")
        _labels["mouse"]     = make_lbl("Миша", 260, 40)

        _buttons["keyboard"] = make_switch(315, "handleKeyboard:")
        _labels["keyboard"]  = make_lbl("Клав", 355, 40)

        sep(405)

        stop_b = AppKit.NSButton.alloc().initWithFrame_(AppKit.NSMakeRect(415, 11, 70, 30))
        stop_b.setTitle_("■ Стоп")
        stop_b.setBezelStyle_(AppKit.NSBezelStyleInline)
        stop_b.setFont_(AppKit.NSFont.systemFontOfSize_weight_(12, AppKit.NSFontWeightBold))
        stop_b.setContentTintColor_(AppKit.NSColor.colorWithRed_green_blue_alpha_(0.95, 0.35, 0.35, 1.0))
        stop_b.setTarget_(target)
        stop_b.setAction_("handleStop:")
        vfx.addSubview_(stop_b)

        refresh_buttons()

        # ── Global mouse monitor (auto-hide) ───────────────────────────────────
        def on_mouse_move(event):
            loc = AppKit.NSEvent.mouseLocation()
            sy  = AppKit.NSScreen.mainScreen().frame().size.height
            if loc.y >= sy - HOVER_ZONE:
                AppHelper.callAfter(show_overlay)
            else:
                # Only schedule hide if not hovering over the window itself
                win_frame = win.frame()
                in_win = (win_frame.origin.x <= loc.x <= win_frame.origin.x + win_frame.size.width
                          and win_frame.origin.y <= loc.y <= win_frame.origin.y + win_frame.size.height)
                if not in_win:
                    AppHelper.callAfter(schedule_hide)

        self._monitor = AppKit.NSEvent.addGlobalMonitorForEventsMatchingMask_handler_(
            AppKit.NSEventMaskMouseMoved, on_mouse_move
        )
        # Also monitor inside the app's own windows
        self._local_monitor = AppKit.NSEvent.addLocalMonitorForEventsMatchingMask_handler_(
            AppKit.NSEventMaskMouseMoved,
            lambda e: (on_mouse_move(e), e)[1]
        )

        win.makeKeyAndOrderFront_(None)
        _win_ref[0] = win

        # ── Initial blink effect ───────────────────────────────────────────────
        def anim_in1():
            def run1(ctx):
                ctx.setDuration_(0.2)
                win.animator().setAlphaValue_(1.0)
            def done1():
                anim_out2()
            AppKit.NSAnimationContext.runAnimationGroup_completionHandler_(run1, done1)

        def anim_out1():
            def run(ctx):
                ctx.setDuration_(0.2)
                win.animator().setAlphaValue_(0.3)
            def done():
                anim_in1()
            AppKit.NSAnimationContext.runAnimationGroup_completionHandler_(run, done)

        def anim_out2():
            def run(ctx):
                ctx.setDuration_(0.2)
                win.animator().setAlphaValue_(0.3)
            def done():
                anim_final_in()
            AppKit.NSAnimationContext.runAnimationGroup_completionHandler_(run, done)

        def anim_final_in():
            def run(ctx):
                ctx.setDuration_(0.2)
                win.animator().setAlphaValue_(1.0)
            def done():
                AppHelper.callAfter(schedule_hide)
            AppKit.NSAnimationContext.runAnimationGroup_completionHandler_(run, done)

        def start_blink():
            _visible[0] = True
            win.setAlphaValue_(1.0)
            anim_out1()

        # Run the blink effect
        AppHelper.callAfter(start_blink)

    def doHide_(self, timer):
        """Called by NSTimer to hide overlay."""
        hide_overlay_now()


# ── Mute global system audio ──────────────────────────────────────────────────
def set_system_mute(mute: bool):
    vol = 0 if mute else 100
    script = f'set volume input volume {vol}'
    subprocess.run(['osascript', '-e', script])

# ── stdin reader ─────────────────────────────────────────────────────────────────
def stdin_reader():
    for raw in sys.stdin:
        raw = raw.strip()
        if not raw:
            continue
        try:
            msg = json.loads(raw)
        except json.JSONDecodeError:
            continue

        if msg.get("type") == "quit":
            AppHelper.callAfter(
                AppKit.NSApplication.sharedApplication().terminate_, None
            )
            return

        if msg.get("type") == "state":
            _state.update({k: v for k, v in msg.items() if k != "type"})
            AppHelper.callAfter(refresh_buttons)
            
    # If we exit the loop, stdin was closed (parent died)
    AppHelper.callAfter(
        AppKit.NSApplication.sharedApplication().terminate_, None
    )


# ── Entry point ──────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    app = AppKit.NSApplication.sharedApplication()
    app.setActivationPolicy_(AppKit.NSApplicationActivationPolicyAccessory)

    delegate = AppDelegate.alloc().init()
    app.setDelegate_(delegate)

    threading.Thread(target=stdin_reader, daemon=True).start()
    AppHelper.runEventLoop()
