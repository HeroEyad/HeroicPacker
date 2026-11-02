# Unreleased

- Import character files from Psych Engine, Codename Engine, Nightmare Vision and V-Slice, and export them for texture atlases too
- Per-frame offsets in the animation preview, kept when repacking
- Convert Adobe Animate texture atlases to Sparrow frames
- Export Sparrow sheets as Adobe Animate texture atlases
- Frame timing editor to reorder the frames of an animation
- Repack check, which confirms every exported frame sits where it should
- Rename frames from the image list
- Bulk optimize, which repacks a folder or zip of sheets and keeps whichever version takes less space
- Auto-align animations to the idle pose, and a per-animation space usage breakdown
- "Shrink to fit" and "Tightest pack" options, and a switch for PNG compression
- Aseprite tags, layers and slices are kept when repacking JSON sheets
- GIF and APNG import, with frame durations
- Dark theme and a layout for phones
- Removed the HTTP API and the old Electron app

# 0.1.5

- Repacking Adobe Animate texture atlases, with `Animation.json` adjusted to trimmed and scaled sprites
- Lanczos scaling
- Lossless PNG compression on export
- Frame durations in the JSON formats

# 0.1.3

- Stores the order of the repacked sparrow sheet, to prevent frame order from changing when exporting
- Sorted export setting, to sort the exported frames

# 0.1.2

- Fixed bug where repacked rotated frames had its width and height bugged out

# 0.1.1

- Fixed bug where you couldn't repack rotated frames.

# 0.1.0

- Better padding that works like Adobe Animate
- Fixed bug where frames with duplicate graphics but different offsets didn't retain the unique offsets
- Added subtitle and github icon to the site

# 0.0.4

- Fixed the zip not accounting for the timezone
- Fixed some clipping issues

# 0.0.3

- Cached trimming

# 0.0.2

- Added repacking
- Cached trimming
- Fixed bug where 100% transparent image didn't get trimmed

# 0.0.1

- Improved trim