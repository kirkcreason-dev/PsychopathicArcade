# Big Foot sprite preparation

The owner supplied `Big Foot.zip` and requested Big Foot in JCW Rumble and
Ladder Wars. These are imagegen-prepared derivatives of that supplied artwork,
not additional Lunacy Unlocked sprites. The original ZIP is left untouched.

Preparation briefs used with the corresponding supplied sheets:

- **Movement:** preserve Big Foot's appearance; extract a right-facing idle,
  six right-facing running poses and the two-fist victory pose. Use transparent
  backgrounds, separated full-body poses and no labels.
- **Combat:** preserve the supplied five kick poses and six stages of the
  one-handed chokeslam. Isolate Big Foot without an opponent, props or text, on
  transparency. A repeated guard pose in the generated sheet is unused.
- **Reactions:** two dazed poses, a forward stagger, buckled knees, a completely
  horizontal face-down pose, two climbing poses with ropes removed, and a
  horizontal flying dive. Keep the character's proportions and transparent
  backgrounds; remove labels.

`frames.json` contains individually reviewed rectangles and foot/body anchors.
The two left-facing kick poses are corrected with per-frame `flipX`. Running
poses face right naturally. Different sheet scales preserve body size; the
prone and dive frames remain short and wide instead of being stretched upright.
The tightly spaced fourth/fifth run poses have adjoining crop boundaries to
avoid including pixels from the neighboring pose. Packing adds four clear
pixels around every frame and uses a WebP atlas embedded in the standalone game.

Rebuild with `node scripts/import-big-foot.mjs`, then
`node scripts/import-rumble.mjs --embed`. The original Lunacy importer preserves
`additional-roster.json`, so reimporting that cast does not remove Big Foot.

Reuse is at the owner's request; no new artwork license is granted.
