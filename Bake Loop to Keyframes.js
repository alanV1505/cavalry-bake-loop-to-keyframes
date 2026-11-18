// =====================================================================
// BAKE LOOP TO KEYFRAMES  ·  for Cavalry (tested on 2.8.1)
// Written by Claude, Anthropic's AI: design, code and testing.
// The person who published it only had the idea. MIT License (see LICENSE)
// =====================================================================
// Turns the repetitions of a loop into REGULAR, EDITABLE KEYFRAMES,
// like copy-pasting a range of keyframes as many times as you want.
//
// HOW TO USE
//   1. In the Graph Editor (or Time Editor) select the keyframes of the RANGE
//      you want to repeat: at least 2 (the first and the last of the range).
//      You can select ranges on several attributes at once (e.g. Position X
//      and Y): each one is repeated on its own with the same settings.
//   2. Run the script from the Scripts menu (window "Bake Loop to Keyframes"):
//        · Mode:   Loop · Loop with Offset · Ping-Pong
//        · Times:  how many repetitions to create (not counting the original range)
//        · Ripple later keyframes: if there are keyframes after the range, they
//          are pushed forward to make room (otherwise you get a warning and
//          nothing changes).
//        · Remove the curve's loop: if the curve had a loop (Loop Settings),
//          it is switched off, because it is now baked.
//   3. Press "Bake". The new keyframes are left selected.
//   Ctrl+Z undoes it.
//
//   Tip: you don't need a loop set in Loop Settings. Animate the range once
//   and the script repeats it.
//
// PREVIEW
//   Instead of step 3, press "Preview": the script sets CAVALRY'S OWN LOOP on the
//   curve (your mode, your times and only your range, using Limit Loops and Filter
//   Last Keyframes). While previewing you can edit or move the range (Cavalry
//   updates it live) and change Mode or Times. Ctrl+Z works as usual.
//   · Keyframes AFTER the range are set aside meanwhile (Cavalry's loop only exists
//     after the last keyframe). They are saved to a backup file.
//   · "Bake" → the loop becomes real keyframes and the set-aside keys come back
//     (rippled if "Ripple" is on).
//   · "Cancel preview" → the loop is removed and the set-aside keys go back in place;
//     your edits to the range are kept.
//   · "Restore set-aside keys" → if a preview was left halfway (window or Cavalry
//     closed…), brings the set-aside keys back from the backup.
//
// WHAT IS COPIED FROM EACH KEYFRAME
//   Value, interpolation (Bézier / Linear / Step), tangents (position, angle,
//   angle and weight locks) and Magic Easing.
//
// HOW EACH MODE BEHAVES (same as Cavalry's loops)
//   · Loop: repeats the range as is.
//       - If the first and last keyframes have the same value, each repetition
//         starts where the previous one ends (each cycle lasts as long as the range).
//       - If they differ, there is a jump: the last value is held (Step) and the
//         copy starts on the next frame (each cycle lasts the range + 1 frame).
//   · Loop with Offset: each repetition adds (last − first). For things that
//     keep advancing (counters, seeds, continuous rotations).
//   · Ping-Pong: back and forth (the way back is the range reversed, with
//     mirrored tangents).
//   At the seams (the keyframe where one cycle ends and the next begins), the
//   INCOMING tangent is the one from the end of the range and the OUTGOING one
//   is from the start, just like Cavalry's loop; that is why those keyframes
//   end up with unlocked tangents.
//
// TESTED (19 frame-by-frame tests against Cavalry's native loop):
//   Bézier, Linear, Step, mixes of the three, Magic Easing (Custom), all three
//   modes, several attributes at once, rippling later keys and the warnings.
//   Difference with the native loop: 0 (max. 0.005 in one Linear→Bézier case).
//
// KNOWN LIMITATIONS
//   · Numeric attributes only (position, scale, opacity, seed, etc.).
//     Colours and other types are skipped with a warning.
//   · Cavalry doesn't allow keyframes between frames, so at some seams an
//     extra "hold" keyframe (Step) or a tiny tangent may appear: they are what
//     keeps the curve identical to the loop. Don't delete them.
//   · Ping-Pong + a preset Magic Easing (not Custom): the way back can't be
//     inverted; it is copied as is and you get a warning.
//
// Internal data (checked live in Cavalry 2.8.1):
//   api.get(keyframeId, "data") -> {numValue, interpolation (0 Bézier, 1 Linear,
//   2 Step), leftBez{x,y}, rightBez{x,y}, locked, weightLocked, ...}
//   and api.set(keyframeId, {"data": {...}}) writes it whole.
//   Curve: api.getInConnection(layer, attr) -> "animationCurve#N.out";
//   postInfinity: 0 none, 1 Loop, 2 Loop with Offset, 3 Linear, 4 Ping-Pong.
// =====================================================================

var MODES = ["Loop", "Loop with Offset", "Ping-Pong"];
var SHAPE_FIELDS = ["interpolation", "leftBez", "rightBez", "locked", "weightLocked"];

function clone(o) { return JSON.parse(JSON.stringify(o)); }
function nearlyEqual(a, b) { return Math.abs(a - b) < 1e-9 * Math.max(1, Math.abs(a), Math.abs(b)); }
function mirror(b) { return b ? {x: -b.x, y: b.y} : undefined; }
// No "interpolation" field = Linear (Cavalry doesn't store the 1, and a freshly
// created keyframe without the field behaves as linear).
function interp(d) { return d.interpolation === undefined ? 1 : d.interpolation; }

// Does the keyframe hold a number? (if not, it is a colour or another type)
function isNumeric(d) {
    if (typeof d.numValue === "number") return true;
    for (var k in d) if (SHAPE_FIELDS.indexOf(k) < 0) return false;
    return true;   // keyframe at 0 without a numValue field
}
function value(d) { return typeof d.numValue === "number" ? d.numValue : 0; }

// ---------------------------------------------------------------------
// CURVE MODEL (checked live)
//   The segment between keyframe A and keyframe B:
//     · if A is Step: it holds A's value until B.
//     · otherwise it is a Bézier: it leaves A with A's right tangent ONLY if A
//       is Bézier, and reaches B with B's left tangent ONLY if B is Bézier.
//   A Linear or Step keyframe does NOT keep tangents (Cavalry deletes them).
//   So each point we create is described like this:
//     useIn / inTan   : does the INCOMING segment use a tangent? and which one
//     outType / outTan: type of the OUTGOING segment (0 Bézier, 1 Linear, 2 Step) and its tangent
//   and then "resolve" translates it into Cavalry keyframes. If a point receives
//   a segment with a tangent but must leave as Linear or Step, it stays Bézier
//   (so the tangent isn't lost) with a tiny outgoing tangent, equivalent to
//   Linear; for Step a "hold" keyframe is also added 1 frame before the next one.
// ---------------------------------------------------------------------
var TINY = 0.001;
function isBez(d) { return interp(d) === 0; }

// Magic Easing: stored in the keyframe ("easing", "exprEasing") and it affects
// the segment that LEAVES it. It is treated as part of the outgoing segment.
function isEasingField(k) { return /asing/i.test(k) || /^expr/i.test(k); }
function extractEase(d) {
    var e = null;
    for (var k in d) if (isEasingField(k)) { e = e || {}; e[k] = d[k]; }
    return e;
}
var WARNINGS = [];
// For the Ping-Pong way back the easing is inverted: g(t) = 1 - e(1 - t)
function invertEase(e) {
    if (!e) return null;
    if (typeof e.exprEasing === "string" && e.exprEasing.length) {
        var inv = clone(e);
        inv.exprEasing = "1-(" + e.exprEasing.replace(/\bt\b/g, "(1-t)") + ")";
        return inv;
    }
    WARNINGS.push("a preset Magic Easing can't be inverted on the Ping-Pong way back; it was copied as is");
    return clone(e);
}

function point(t, v, base, source, useIn, inTan, outType, outTan, aligned, ease) {
    return {t: t, v: v, base: base, source: source, useIn: useIn, inTan: inTan, outType: outType, outTan: outTan, aligned: aligned, ease: ease || null};
}
// Point that copies an original keyframe as is (shifted and with another value)
function copyPoint(t, v, k) {
    return point(t, v, k.d, k, isBez(k.d), k.d.leftBez, interp(k.d), k.d.rightBez, true, extractEase(k.d));
}

// Translates points into keyframe data. nextT(t) = time of the keyframe that will come after.
function resolve(points, nextT) {
    var out = [];
    for (var i = 0; i < points.length; i++) {
        var p = points[i], d = clone(p.base);
        for (var c = 0; c < SHAPE_FIELDS.length; c++) delete d[SHAPE_FIELDS[c]];
        for (var k in p.base) if (isEasingField(k)) delete d[k];
        if (p.ease) for (var e in p.ease) d[e] = clone(p.ease[e]);
        d.numValue = p.v;
        if (p.outType === 0) {
            d.interpolation = 0;
            d.leftBez = p.useIn && p.inTan ? clone(p.inTan) : {x: -TINY, y: 0};
            d.rightBez = p.outTan ? clone(p.outTan) : {x: TINY, y: 0};
            d.locked = p.aligned && p.base.locked === true;
            d.weightLocked = p.aligned && p.base.weightLocked === true;
        } else if (p.useIn && p.inTan) {
            d.interpolation = 0;
            d.leftBez = clone(p.inTan);
            d.rightBez = {x: TINY, y: 0};
            d.locked = false; d.weightLocked = false;
            if (p.outType === 2) {
                var nt = nextT(p.t);
                if (nt !== null && nt - 1 > p.t)
                    out.push({t: nt - 1, d: {numValue: p.v, interpolation: 2}, source: null});
            }
        } else {
            d.interpolation = p.outType;
        }
        out.push({t: p.t, d: d, id: p.id});
    }
    return out;
}

// Reads an attribute's keyframes, sorted by time.
function readKeys(layer, attr) {
    var ids = api.getKeyframeIdsForAttribute(layer, attr), out = [];
    for (var i = 0; i < ids.length; i++)
        out.push({id: ids[i], t: api.get(ids[i], "timeOffset"), d: api.get(ids[i], "data")});
    out.sort(function (a, b) { return a.t - b.t; });
    return out;
}

// Computes the new points for a range.
// Returns {points:[...], seamL: point for the last original keyframe, duration}
function plan(range, mode, times) {
    var n = range.length, F = range[0], L = range[n - 1];
    var P = L.t - F.t, vF = value(F.d), vL = value(L.d);
    var points = [], seamL, duration;

    // Seam "end of range -> starts again forwards": arrives like L, leaves like F
    function forwardSeam(t, v) {
        return point(t, v, L.d, L, isBez(L.d), L.d.leftBez, interp(F.d), F.d.rightBez, false, extractEase(F.d));
    }
    // Outgoing side of a point that starts the WAY BACK from keyframe r (Ping-Pong):
    // the way back of segment (r-1 -> r) starts with the shape that segment had when reaching r.
    function backOut(r) {
        if (interp(range[r - 1].d) === 2) return {type: 1, tan: undefined, jump: true, ease: null};   // reversed Step: jumps right away
        var ease = invertEase(extractEase(range[r - 1].d));
        if (isBez(range[r].d)) return {type: 0, tan: mirror(range[r].d.leftBez), jump: false, ease: ease};
        return {type: 1, tan: undefined, jump: false, ease: ease};
    }

    if (mode === 0 || mode === 1) {
        var delta = mode === 1 ? vL - vF : 0;
        var continuous = mode === 1 || nearlyEqual(vF, vL);
        if (continuous) {
            duration = P * times;
            for (var k = 1; k <= times; k++)
                for (var i = 1; i < n; i++) {
                    var t = range[i].t + k * P, v = value(range[i].d) + k * delta;
                    points.push(i === n - 1 && k < times ? forwardSeam(t, v) : copyPoint(t, v, range[i]));
                }
            seamL = forwardSeam(L.t, vL);
        } else {
            // Loop with a jump: the end is held and the copy starts 1 frame later
            var cycle = P + 1;
            duration = cycle * times;
            for (var k2 = 1; k2 <= times; k2++)
                for (var j = 0; j < n; j++) {
                    var t2 = range[j].t + k2 * cycle;
                    if (j === n - 1 && k2 < times)
                        points.push(point(t2, vL, L.d, L, isBez(L.d), L.d.leftBez, 2, undefined, false));
                    else points.push(copyPoint(t2, value(range[j].d), range[j]));
                }
            seamL = point(L.t, vL, L.d, L, isBez(L.d), L.d.leftBez, 2, undefined, false);
        }
    } else {
        // Ping-Pong: odd cycles backwards (L -> F), even cycles forwards (F -> L)
        duration = P * times;
        var pendingJump = null;
        function addBack(t, r, last) {
            var o = range[r].d, inc = interp(o) === 0;   // arrives with r's outgoing shape
            var p;
            if (r === 0) {
                p = last ? point(t, value(o), o, range[r], inc, mirror(o.rightBez), 1, undefined, false)
                         : point(t, value(o), o, range[r], inc, mirror(o.rightBez), interp(o), o.rightBez, false, extractEase(o));
            } else {
                var s = backOut(r);
                p = point(t, value(o), o, range[r], inc, mirror(o.rightBez), s.type, s.tan, true, s.ease);
                if (s.jump) pendingJump = {t: t + 1, v: value(range[r - 1].d)};
            }
            points.push(p);
        }
        for (var c = 1; c <= times; c++) {
            var S = L.t + (c - 1) * P, lastCycle = c === times;
            if (c % 2 === 1) {
                for (var r = n - 2; r >= 0; r--) {
                    var tr = S + (L.t - range[r].t);
                    if (pendingJump && pendingJump.t < tr)
                        points.push(point(pendingJump.t, pendingJump.v, {}, null, false, undefined, 2, undefined, false));
                    pendingJump = null;
                    addBack(tr, r, lastCycle);
                }
            } else {
                for (var q = 1; q < n; q++) {
                    var tq = S + (range[q].t - F.t);
                    if (q === n - 1 && !lastCycle) {
                        var s2 = backOut(n - 1);
                        points.push(point(tq, vL, L.d, L, isBez(L.d), L.d.leftBez, s2.type, s2.tan, false, s2.ease));
                        if (s2.jump) pendingJump = {t: tq + 1, v: value(range[n - 2].d)};
                    } else points.push(copyPoint(tq, value(range[q].d), range[q]));
                }
            }
        }
        var s3 = backOut(n - 1);
        seamL = point(L.t, vL, L.d, L, isBez(L.d), L.d.leftBez, s3.type, s3.tan, false, s3.ease);
        if (s3.jump) {
            // the jump of the first way back is added right after L
            var firstT = L.t + (L.t - range[n - 2].t);
            if (L.t + 1 < firstT) points.unshift(point(L.t + 1, value(range[n - 2].d), {}, null, false, undefined, 2, undefined, false));
        }
    }
    return {points: points, seamL: seamL, duration: duration};
}

// Does everything on one attribute. Returns a text describing what it did.
function bakeAttribute(layer, attr, selFrames, mode, times, ripple, removeLoop, newIds) {
    var name = api.getNiceName(layer) + " › " + attr;
    if (selFrames.length < 2) return "⚠ " + name + ": select at least 2 keyframes (start and end of the range).";
    var t0 = Math.min.apply(null, selFrames), t1 = Math.max.apply(null, selFrames);
    var all = readKeys(layer, attr), range = [], after = [];
    for (var i = 0; i < all.length; i++) {
        if (all[i].t >= t0 - 1e-6 && all[i].t <= t1 + 1e-6) range.push(all[i]);
        else if (all[i].t > t1) after.push(all[i]);
    }
    if (range.length < 2) return "⚠ " + name + ": the range needs at least 2 keyframes.";
    for (var c = 0; c < range.length; c++)
        if (!isNumeric(range[c].d)) return "⚠ " + name + ": not a numeric attribute (a colour?). Skipped.";

    var pl = plan(range, mode, times);
    var newEnd = range[range.length - 1].t + pl.duration;

    if (after.length && !ripple && after[0].t <= newEnd + 1e-6)
        return "⚠ " + name + ": there are keyframes after the range (frame " + after[0].t + ") that would be overwritten. Turn on \"Ripple later keyframes\" or move them. Nothing was changed.";

    // NOTE (checked live): when a keyframe is created or moved, Cavalry recalculates
    // its neighbours' tangents. So all keyframes are created/moved first and, AT THE
    // END, the data of all of them (originals included) is written and verified.
    // Final times of every keyframe, to know which one comes after each one
    var shift = after.length && ripple ? pl.duration : 0;
    var times_ = [];
    for (var a = 0; a < all.length; a++) times_.push(all[a].t > t1 ? all[a].t + shift : all[a].t);
    for (var b = 0; b < pl.points.length; b++) times_.push(pl.points[b].t);
    times_.sort(function (x, y) { return x - y; });
    function nextT(t) { for (var s = 0; s < times_.length; s++) if (times_[s] > t + 1e-6) return times_[s]; return null; }

    var lastId = range[range.length - 1].id;
    pl.seamL.id = lastId;
    var resolved = resolve([pl.seamL].concat(pl.points), nextT);
    var dataL = null, created = [];
    for (var z = 0; z < resolved.length; z++) {
        if (resolved[z].id === lastId) dataL = resolved[z].d; else created.push(resolved[z]);
    }

    var target = [];   // [{id, d}] data each keyframe must have at the end
    for (var o = 0; o < all.length; o++) target.push({id: all[o].id, d: all[o].id === lastId ? dataL : clone(all[o].d)});

    // 1) Ripple later keyframes (from last to first so nothing is overwritten)
    if (after.length && ripple) {
        for (var p = after.length - 1; p >= 0; p--) {
            var mov = {}; mov[attr] = {frame: after[p].t, newFrame: after[p].t + pl.duration};
            api.modifyKeyframe(layer, mov);
        }
    }

    // 2) Create the copies
    for (var k = 0; k < created.length; k++) {
        var nk = created[k], obj = {};
        obj[attr] = value(nk.d);
        var id = api.keyframe(layer, nk.t, obj);
        target.push({id: id, d: nk.d});
        newIds.push(id);
    }

    // 3) Write the data of all of them (Magic Easing included) and check it is exact
    var failed = writeAndVerify(target);

    // 4) Switch off the curve's loop if it started at the end of the range
    var extra = "";
    if (removeLoop && !after.length) {
        var conn = api.getInConnection(layer, attr), curve = conn ? conn.split(".")[0] : "";
        if (curve.indexOf("animationCurve") === 0) {
            var pi = 0;
            try { pi = api.get(curve, "postInfinity"); } catch (e) {}
            if (pi === 1 || pi === 2 || pi === 4) {
                api.set(curve, {"postInfinity": 0});
                extra = " Curve loop switched off (it is baked now).";
            }
        }
    }

    return (failed ? "⚠ " : "✓ ") + name + ": " + created.length + " new keyframes (" + MODES[mode] + " × " + times +
           ", frames " + range[0].t + "–" + newEnd + ")." +
           (after.length && ripple ? " Later keyframes moved " + pl.duration + " frames." : "") + extra +
           (failed ? " WARNING: " + failed + " keyframes are not exact; check them." : "");
}

// Does the stored data match what we wanted?
function sameData(a, b) {
    function n(x) { return x === undefined ? 0 : x; }
    if (!nearlyEqual(value(a), value(b))) return false;
    if (interp(a) !== interp(b)) return false;
    if (JSON.stringify(extractEase(a)) !== JSON.stringify(extractEase(b))) return false;
    var bez = ["leftBez", "rightBez"];
    for (var i = 0; i < bez.length; i++) {
        var p = a[bez[i]], q = b[bez[i]];
        if (!q) continue;                     // if we didn't ask for a tangent, Cavalry's own is fine
        if (bez[i] === "rightBez" && interp(b) !== 0) continue;   // the outgoing tangent only matters on Bézier
        if (!p) return false;
        if (Math.abs(n(p.x) - n(q.x)) > 1e-6 || Math.abs(n(p.y) - n(q.y)) > 1e-6) return false;
    }
    return true;
}

// Writes each keyframe's data and repeats if Cavalry changed it. Returns how many fail.
function writeAndVerify(target) {
    var pending = target;
    for (var pass = 0; pass < 3 && pending.length; pass++) {
        for (var i = 0; i < pending.length; i++) api.set(pending[i].id, {"data": pending[i].d});
        var still = [];
        for (var j = 0; j < pending.length; j++)
            if (!sameData(api.get(pending[j].id, "data"), pending[j].d)) still.push(pending[j]);
        pending = still;
    }
    return pending.length;
}

function bakeLoop(mode, times, ripple, removeLoop) {
    times = Math.round(times);
    if (times < 1) return "⚠ \"Times\" must be 1 or more.";
    var sel = api.getSelectedKeyframes(), keys = Object.keys(sel || {});
    if (!keys.length) return "⚠ No keyframes selected. Select the range you want to repeat in the Graph Editor.";
    var report = [], newIds = [];
    WARNINGS = [];
    for (var i = 0; i < keys.length; i++) {
        var dot = keys[i].indexOf(".");
        var layer = keys[i].substring(0, dot), attr = keys[i].substring(dot + 1);
        try {
            report.push(bakeAttribute(layer, attr, sel[keys[i]], mode, times, ripple, removeLoop, newIds));
        } catch (e) {
            report.push("✗ " + keys[i] + ": unexpected error: " + e.message);
        }
    }
    if (newIds.length) api.setSelectedKeyframeIds(newIds);
    if (WARNINGS.length) report.push("⚠ Note: " + WARNINGS.filter(function (a, i) { return WARNINGS.indexOf(a) === i; }).join("; ") + ".");
    var text = report.join("\n");
    console.log("Bake Loop to Keyframes\n" + text);
    return text;
}

// ------------------------------ PREVIEW ------------------------------
// The preview IS Cavalry's own loop (Loop Settings), set up by the script:
//   Mode → postInfinity (1 Loop, 2 Loop with Offset, 4 Oscillate = Ping-Pong)
//   Limit Loops → postInfinityLoopCount (0 = no limit)
//   Filter Last Keyframes → postInfinityLoopKeyframes (0 = no filter)
//   (names checked by saving a test scene in Cavalry 2.8.1)
// So Cavalry updates it live while you drag, and Ctrl+Z works as usual.
// Cavalry's loop only exists after the LAST keyframe: keyframes after the range are
// SET ASIDE (saved to a backup file) and come back when you bake (rippled) or cancel
// (in place). If something closes halfway, "Restore set-aside keys" brings them back.
// Baking gives exactly the same result as the native loop (19 frame-by-frame tests).
var PREVIEW = null;
var MODE_TO_CAVALRY = [1, 2, 4];   // Loop, Loop with Offset, Oscillate (Ping-Pong)

function alive(layer, attr) { return api.getKeyframeIdsForAttribute(layer, attr); }
function backupPath() { return api.getAppDataFolder() + "/Bake Loop to Keyframes - set-aside keyframes.json"; }
function curveOf(layer, attr) {
    var c = api.getInConnection(layer, attr);
    c = c ? c.split(".")[0] : "";
    return c.indexOf("animationCurve") === 0 ? c : null;
}
function readLoop(curve) {
    function g(a) { try { return api.get(curve, a) || 0; } catch (e) { return 0; } }
    return {postInfinity: g("postInfinity"), postInfinityLoopCount: g("postInfinityLoopCount"),
            postInfinityLoopKeyframes: g("postInfinityLoopKeyframes")};
}
var LOOP_OFF = {postInfinity: 0, postInfinityLoopCount: 0, postInfinityLoopKeyframes: 0};

// Sets the native loop: only the range keyframes, "times" repetitions
function setLoop(e, mode, times) {
    var ids = alive(e.layer, e.attr), n = 0;
    for (var i = 0; i < e.source.length; i++) if (ids.indexOf(e.source[i]) >= 0) n++;
    api.set(e.curve, {"postInfinity": MODE_TO_CAVALRY[mode], "postInfinityLoopCount": times,
                      "postInfinityLoopKeyframes": n < ids.length ? n : 0});
}

// The range keyframes as they are now (edited or moved)
function currentRange(e) {
    var ids = alive(e.layer, e.attr), range = [];
    for (var i = 0; i < e.source.length; i++)
        if (ids.indexOf(e.source[i]) >= 0)
            range.push({id: e.source[i], t: api.get(e.source[i], "timeOffset"), d: api.get(e.source[i], "data")});
    range.sort(function (a, b) { return a.t - b.t; });
    return range;
}

// Puts the set-aside keyframes back, shifted D frames, with their exact data.
// If one is already back (e.g. via Ctrl+Z), it is only repositioned: never duplicated.
function bringBack(layer, attr, after, D) {
    var ids = alive(layer, attr), target = [], far = 0;
    for (var a = 0; a < ids.length; a++) {
        var ta = api.get(ids[a], "timeOffset");
        if (ta > far) far = ta;
        target.push({id: ids[a], d: api.get(ids[a], "data")});   // everything else keeps its data
    }
    far += 100000;
    for (var i = 0; i < after.length; i++) {
        var k = after[i], id = k.id;
        if (ids.indexOf(id) < 0) {
            var obj = {}; obj[attr] = value(k.d);
            id = api.keyframe(layer, far + i, obj);   // far away first, so no keyframe is overwritten
        }
        api.set(id, {"timeOffset": k.t + D});
        target.push({id: id, d: clone(k.d)});
    }
    return writeAndVerify(target);
}

// The Graph Editor doesn't redraw when a script deletes keyframes (it keeps the old
// curve and "ghost" points). Deselecting and reselecting a moment later refreshes it,
// just like clicking the layer.
var REFRESH_CLOCK = null;
function refreshView() {
    if (typeof api.select !== "function") return;
    var layers = api.getSelection(), keys = api.getSelectedKeyframeIds();
    api.select([]);
    function back() { api.select(layers); api.setSelectedKeyframeIds(keys); }
    if (typeof api.Timer !== "function") { back(); return; }
    REFRESH_CLOCK = new api.Timer({onTimeout: function () { REFRESH_CLOCK.stop(); back(); }});
    REFRESH_CLOCK.setInterval(120);
    REFRESH_CLOCK.setRepeating(false);
    REFRESH_CLOCK.start();
}

function saveBackup() {
    var data = {scene: api.getSceneFilePath(), states: []};
    for (var i = 0; i < PREVIEW.states.length; i++) {
        var e = PREVIEW.states[i];
        data.states.push({layer: e.layer, attr: e.attr, curve: e.curve, after: e.after, loopBefore: e.loopBefore});
    }
    api.writeToFile(backupPath(), JSON.stringify(data), true);
}
function deleteBackup() { if (api.filePathExists(backupPath())) api.deleteFilePath(backupPath()); }
function hasBackup() { return !PREVIEW && api.filePathExists(backupPath()); }

function startPreview(mode, times, ripple) {
    times = Math.round(times);
    if (PREVIEW) return "Already previewing.";
    if (api.filePathExists(backupPath()))
        return "⚠ There are set-aside keyframes from a preview that wasn't closed. Press \"Restore set-aside keys\" first.";
    if (times < 1) return "⚠ \"Times\" must be 1 or more.";
    var sel = api.getSelectedKeyframes(), keys = Object.keys(sel || {});
    if (!keys.length) return "⚠ No keyframes selected. In the Graph Editor, select the range you want to repeat.";
    var states = [], notes = [];
    for (var i = 0; i < keys.length; i++) {
        var dot = keys[i].indexOf(".");
        var layer = keys[i].substring(0, dot), attr = keys[i].substring(dot + 1);
        var name = api.getNiceName(layer) + " › " + attr, frames = sel[keys[i]];
        if (frames.length < 2) { notes.push("⚠ " + name + ": select at least 2 keyframes."); continue; }
        var curve = curveOf(layer, attr);
        if (!curve) { notes.push("⚠ " + name + ": can't find its animation curve."); continue; }
        var t0 = Math.min.apply(null, frames), t1 = Math.max.apply(null, frames);
        var all = readKeys(layer, attr), range = [], after = [], numeric = true;
        for (var j = 0; j < all.length; j++) {
            if (all[j].t >= t0 - 1e-6 && all[j].t <= t1 + 1e-6) range.push(all[j]);
            else if (all[j].t > t1) after.push({id: all[j].id, t: all[j].t, d: clone(all[j].d)});
        }
        for (var c = 0; c < range.length; c++) if (!isNumeric(range[c].d)) numeric = false;
        if (range.length < 2) { notes.push("⚠ " + name + ": the range needs at least 2 keyframes."); continue; }
        if (!numeric) { notes.push("⚠ " + name + ": not a numeric attribute (a colour?). Skipped."); continue; }
        states.push({layer: layer, attr: attr, name: name, curve: curve,
                     source: range.map(function (k) { return k.id; }), origEnd: range[range.length - 1].t,
                     after: after, loopBefore: readLoop(curve),
                     rangeData: range.map(function (k) { return {id: k.id, d: clone(k.d)}; })});
    }
    if (!states.length) return notes.join("\n");
    PREVIEW = {states: states, mode: mode, times: times};
    saveBackup();   // BEFORE setting anything aside
    var report = [];
    for (var s = 0; s < states.length; s++) {
        var st = states[s];
        for (var a = 0; a < st.after.length; a++) api.deleteLayer(st.after[a].id);
        setLoop(st, mode, times);
        writeAndVerify(st.rangeData);   // removing neighbours can make Cavalry retouch tangents
        report.push("👁 " + st.name + ": " + MODES[mode] + " × " + times +
                    (st.after.length ? " (" + st.after.length + " later keyframes set aside; they come back when you bake or cancel)" : ""));
    }
    if (notes.length) report = report.concat(notes);
    refreshView();
    return "PREVIEWING with Cavalry's loop: edit or move the range, Ctrl+Z works as usual.\n" + report.join("\n");
}

// Called every few ms (Timer): if you change Mode or Times, the loop is updated
function watchPreview(mode, times, ripple) {
    if (!PREVIEW) return null;
    times = Math.round(times);
    if (times < 1 || (mode === PREVIEW.mode && times === PREVIEW.times)) return null;
    PREVIEW.mode = mode; PREVIEW.times = times;
    for (var i = 0; i < PREVIEW.states.length; i++) setLoop(PREVIEW.states[i], mode, times);
    return "PREVIEWING with Cavalry's loop: " + MODES[mode] + " × " + times + ".";
}

// Cancel: removes the loop (restores whatever loop there was) and puts set-aside keys back
function cancelPreview() {
    if (!PREVIEW) return "Not previewing.";
    var failed = 0;
    for (var i = 0; i < PREVIEW.states.length; i++) {
        var e = PREVIEW.states[i];
        api.set(e.curve, e.loopBefore);
        failed += bringBack(e.layer, e.attr, e.after, 0);
        api.setSelectedKeyframeIds(currentRange(e).map(function (k) { return k.id; }));
    }
    PREVIEW = null;
    deleteBackup();
    refreshView();
    return "Preview cancelled: later keyframes are back in place (your edits to the range are kept)." +
           (failed ? " WARNING: " + failed + " keyframes are not exact." : "");
}

// Bake while previewing: the loop becomes real keyframes
function confirmPreview(mode, times, ripple, removeLoop) {
    times = Math.round(times);
    if (times < 1) return "⚠ \"Times\" must be 1 or more.";
    var report = [], newIds = [];
    WARNINGS = [];
    // 1) Check everything fits before touching anything
    for (var c = 0; c < PREVIEW.states.length; c++) {
        var ec = PREVIEW.states[c], rc = currentRange(ec);
        if (rc.length < 2) return "⚠ " + ec.name + ": the range has fewer than 2 keyframes left.";
        var endC = rc[rc.length - 1].t + plan(rc, mode, times).duration;
        if (!ripple)
            for (var a = 0; a < ec.after.length; a++)
                if (ec.after[a].t <= endC + 1e-6)
                    return "⚠ " + ec.name + ": it doesn't fit; there is a set-aside keyframe on frame " + ec.after[a].t +
                           ". Turn on \"Ripple later keyframes\" or reduce Times. Still previewing.";
    }
    // 2) Remove the loop, bring the set-aside keys back (rippled) and bake
    for (var i = 0; i < PREVIEW.states.length; i++) {
        var e = PREVIEW.states[i], range = currentRange(e);
        var L = range[range.length - 1], end = L.t + plan(range, mode, times).duration;
        var D = ripple ? end - e.origEnd : 0;
        api.set(e.curve, removeLoop ? LOOP_OFF : e.loopBefore);
        bringBack(e.layer, e.attr, e.after, D);
        var frames = range.map(function (k) { return k.t; });
        try { report.push(bakeAttribute(e.layer, e.attr, frames, mode, times, false, false, newIds)); }
        catch (err) { report.push("✗ " + e.name + ": unexpected error: " + err.message); }
    }
    PREVIEW = null;
    deleteBackup();
    if (newIds.length) api.setSelectedKeyframeIds(newIds);
    refreshView();
    if (WARNINGS.length) report.push("⚠ Note: " + WARNINGS.filter(function (x, j) { return WARNINGS.indexOf(x) === j; }).join("; ") + ".");
    return report.join("\n");
}

// Restore from the backup (if a preview was left halfway)
function restoreBackup() {
    if (PREVIEW) return "You are previewing: use \"Cancel preview\".";
    if (!api.filePathExists(backupPath())) return "There are no set-aside keyframes to restore.";
    var data = JSON.parse(api.readFromFile(backupPath()));
    var scene = api.getSceneFilePath();
    if (data.scene && scene !== data.scene)
        return "⚠ The set-aside keyframes belong to another scene:\n" + data.scene + "\nOpen it and press \"Restore set-aside keys\".";
    var done = 0;
    for (var i = 0; i < data.states.length; i++) {
        var e = data.states[i];
        try {
            var ids = alive(e.layer, e.attr), taken = {};
            for (var a = 0; a < ids.length; a++) taken[api.get(ids[a], "timeOffset")] = ids[a];
            // if a keyframe already sits on that frame (or came back via Ctrl+Z), don't duplicate
            var missing = e.after.filter(function (k) { return ids.indexOf(k.id) < 0 && taken[k.t] === undefined; });
            bringBack(e.layer, e.attr, missing, 0);
            api.set(e.curve, e.loopBefore);
            done += missing.length;
        } catch (err) { return "✗ Couldn't restore " + e.layer + " › " + e.attr + ": " + err.message + ". The backup is still at:\n" + backupPath(); }
    }
    deleteBackup();
    refreshView();
    return "✓ Restored " + done + " set-aside keyframes and the loop there was before.";
}

// ------------------------------ WINDOW ------------------------------
if (typeof BAKE_LOOP_TEST === "undefined" && (typeof ui === "undefined" || typeof ui.setTitle !== "function")) {
    console.log("Bake Loop to Keyframes has a window: run it from Cavalry's Scripts menu, not from the JavaScript Editor.");
} else if (typeof BAKE_LOOP_TEST === "undefined") {
    ui.setTitle("Bake Loop to Keyframes");
    ui.setFixedWidth(360);
    ui.setMargins(10, 10, 10, 10);
    ui.setSpaceBetween(6);

    var help = new ui.Label("1. In the Graph Editor, select the range to repeat (at least 2 keyframes).\n2. Choose mode and times.\n3. \"Preview\" to see and adjust it live, or \"Bake\" straight away.");
    var modeUI = new ui.DropDown();
    for (var mm = 0; mm < MODES.length; mm++) modeUI.addEntry(MODES[mm]);
    var timesUI = new ui.NumericField(3);
    timesUI.setType(0); timesUI.setMin(1); timesUI.setMax(9999);
    var rippleUI = new ui.Checkbox(true);
    var removeUI = new ui.Checkbox(true);
    var result = new ui.Label("");
    var button = new ui.Button("Bake");

    var row1 = new ui.HLayout(); row1.add(new ui.Label("Mode"), modeUI);
    var row2 = new ui.HLayout(); row2.add(new ui.Label("Times"), timesUI);
    var row3 = new ui.HLayout(); row3.add(rippleUI, new ui.Label("Ripple later keyframes")); row3.addStretch();
    var row4 = new ui.HLayout(); row4.add(removeUI, new ui.Label("Remove the curve's loop")); row4.addStretch();

    var previewButton = new ui.Button("Preview");
    var cancelButton = new ui.Button("Cancel preview");

    function safely(fn) {
        try { var t = fn(); if (t) result.setText(t); }
        catch (e) { result.setText("✗ Error: " + e.message); console.error(e.message); }
    }

    button.onClick = function () {
        safely(function () {
            if (PREVIEW) return confirmPreview(modeUI.getValue(), timesUI.getValue(), rippleUI.getValue(), removeUI.getValue());
            return bakeLoop(modeUI.getValue(), timesUI.getValue(), rippleUI.getValue(), removeUI.getValue());
        });
    };
    previewButton.onClick = function () {
        safely(function () { return startPreview(modeUI.getValue(), timesUI.getValue(), rippleUI.getValue()); });
    };
    cancelButton.onClick = function () { safely(cancelPreview); };

    var restoreButton = new ui.Button("Restore set-aside keys");
    restoreButton.onClick = function () { safely(restoreBackup); };

    // Watcher: every 200 ms, if you change Mode or Times, the preview loop is updated
    function Watcher() {
        this.onTimeout = function () {
            if (!PREVIEW) return;
            safely(function () { return watchPreview(modeUI.getValue(), timesUI.getValue(), rippleUI.getValue()); });
        };
    }
    var clock = new api.Timer(new Watcher());
    clock.setInterval(200);
    clock.setRepeating(true);
    clock.start();

    var buttonRow = new ui.HLayout(); buttonRow.add(previewButton, cancelButton);
    ui.add(help, row1, row2, row3, row4, buttonRow, button, result, restoreButton);
    safely(function () {
        return hasBackup() ? "⚠ There are set-aside keyframes from a preview that wasn't closed. Press \"Restore set-aside keys\"." : null;
    });
    ui.show();
}
