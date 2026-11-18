# Bake Loop to Keyframes (Cavalry script)

> Written by **Claude** (Anthropic's AI). The uploader only had the idea. See [Credits](#credits-and-licence).

Turns an animation curve's loop (**Loop**, **Loop with Offset** or **Ping-Pong**) into **regular, editable keyframes**, for an exact number of repetitions.

Why? Cavalry's loops are "all or nothing":
- you can't tweak a single repetition;
- after *Limit Loops* ends, the value jumps back to the original last keyframe (without the offset);
- *Animation → Bake Animation* removes the loop instead of baking it.

This script copies the range as real keyframes, so you can edit any repetition and keep animating afterwards.

Feature request for a native version: [scenegroup-public/cavalry#347](https://gitlab.com/scenegroup-public/cavalry/-/work_items/347).

## Install
1. Copy `Bake Loop to Keyframes.js` into Cavalry's Scripts folder. On Windows this is `%APPDATA%\Cavalry\Scripts\`.
2. Restart Cavalry. The script appears in the **Scripts** menu.

The script opens a window, so run it from the Scripts menu, not from the JavaScript Editor.

## Use
1. In the **Graph Editor**, select the keyframes of the range to repeat (at least the first and the last). You can select ranges on several attributes at once.
2. **Scripts → Bake Loop to Keyframes**, then set:
   - **Mode:**
     - **Loop:** repeats the range as is.
     - **Loop with Offset:** each repetition adds (last − first). Good for counters, seeds and continuous rotations.
     - **Ping-Pong:** back and forth.
   - **Times:** number of new repetitions, not counting the original range.
   - **Ripple later keyframes:** pushes any later keyframes forward to make room. If it is off and they don't fit, the script warns you and changes nothing.
   - **Remove the curve's loop:** switches off the native loop, since it is now baked.
3. Press **Bake**. The new keyframes are left selected, and **Ctrl+Z** undoes it.

You don't need a loop set in *Loop Settings*. Animate the range once and the script repeats it.

## What is copied
- value;
- interpolation (Bézier / Linear / Step);
- tangents and their locks;
- Magic Easing. On the Ping-Pong way back, Custom expressions are inverted.

## Tested
Tested in Cavalry 2.8.1 with 19 frame-by-frame tests against the native loop:
- the three modes;
- Bézier, Linear, Step and mixed curves;
- Magic Easing;
- several attributes at once;
- rippling later keys.

The difference was 0, with a maximum of 0.005 in one Linear → Bézier case.

## Known limitations
- **Numeric attributes only.** Colours are skipped with a warning.
- **Extra keyframes at some seams.** Cavalry doesn't allow keyframes between frames, and Linear/Step keyframes drop their incoming tangent. So at some seams the script adds either a tiny tangent or a one-frame "hold" keyframe to reproduce the exact shape. Don't delete them.
- **Preset Magic Easings in Ping-Pong.** Presets (not Custom expressions) can't be inverted on the Ping-Pong way back. They are copied as is, with a warning.

## Credits and licence
This script was **written by Claude, Anthropic's AI**: the design, the code and the frame-by-frame testing. The person who published this repository is a Cavalry user who only had the idea (and the real problem it solves); they don't take credit for the code.

MIT License: free to use, modify and share. See `LICENSE`.
