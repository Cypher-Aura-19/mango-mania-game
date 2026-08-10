export const gameStartNow = 'GAME_START_NOW'
export const gameUserOption = 'GAME_USER_OPTION'
export const hardMode = 'HARD_MODE'

/* The canvas fills the whole window, but the tower is stacked inside a centred
 * portrait COLUMN of it — the same 1:1.5 box the canvas used to be clamped to.
 * Everything the player aims with (block width, hook, tower line, HUD) is keyed
 * to the column so the game plays identically at every screen shape; only the
 * scenery — backdrop, clouds, balloon, birds — uses the full canvas, which is
 * what makes a laptop feel like a wider view of the same world rather than a
 * phone screen with wallpaper either side.
 *
 * On a portrait screen the column IS the canvas and both are the same number. */
export const playWidth = 'PLAY_WIDTH'
export const playLeft = 'PLAY_LEFT'

export const successCount = 'SUCCESS_COUNT'
export const failedCount = 'FAILED_COUNT'
export const perfectCount = 'PERFECT_COUNT'
export const gameScore = 'GAME_SCORE'

// How happy the customer is with the cake, 0-100. Rises when a layer lands
// mostly intact, falls when one gets clipped or missed entirely. Also swings
// the score in both directions — see addSatisfaction in utils.js.
export const satisfaction = 'SATISFACTION'
// What the bar is currently showing. Chases `satisfaction` a little behind it
// so a big swing slides instead of snapping.
export const satisfactionShown = 'SATISFACTION_SHOWN'
// Meter points per second the bar slides at while catching up.
export const satisfactionSlideRate = 70
export const satisfactionStart = 60
// A landing that keeps at least this much of the layer pleases the customer;
// below it, they mind the waste.
export const satisfactionGoodKeep = 0.8
// Score is nudged by (satisfaction change) x this. Small on purpose: a full
// swing from delighted to furious is worth about two clean landings, so the
// meter colours the score rather than dominating it.
export const satisfactionScoreRate = 0.6
// Where the reaction markers sit along the channel, and the satisfaction each
// one speaks for. The lit face is the highest whose `at` you have reached.
export const satisfactionLevels = [
  { pos: 0.16, at: 0 },
  { pos: 0.50, at: 40 },
  { pos: 0.84, at: 75 }
]

export const hookDown = 'HOOK_DOWN'
export const hookUp = 'HOOK_UP'
export const hookNormal = 'HOOK_NORMAL'

export const bgImgOffset = 'BACKGROUND_IMG_OFFSET_HEIGHT'
export const lineInitialOffset = 'LINE_INITIAL_OFFSET'
export const bgLinearGradientOffset = 'BACKGROUND_LINEAR_GRADIENT_OFFSET_HEIGHT'


export const blockCount = 'BLOCK_COUNT'
export const blockWidth = 'BLOCK_WIDTH'
export const blockHeight = 'BLOCK_HEIGHT'
export const currentWidth = 'CURRENT_WIDTH'
// Height of the layer that most recently landed. The scroll-down distance is
// derived from this rather than the full blockHeight, because clipped layers
// are shorter — using the fixed height would scroll further than the tower
// actually grew and the stack would sink.
export const currentHeight = 'CURRENT_HEIGHT'
// Floor on the proportional height squeeze, as a fraction of the full block
// height. Keeps a heavily-clipped tower's layers thick enough to see and land
// on instead of collapsing into slivers.
export const minHeightRatio = 0.45
// How much of the width loss carries into the height. 1 = shrink height in
// lockstep with width (too aggressive — clipped layers became slivers);
// 0.5 = lose only half as much height as width.
export const heightSqueezeFactor = 0.5
export const cloudSize = 'CLOUD_SIZE'
export const ropeHeight = 'ROPE_HEIGHT'
// Where the rope/hook hangs from, as a multiple of ropeHeight. More negative
// lifts the block higher up off the top of the screen. This is the knob for the
// BLOCK's hang height only — the hook's rope stretches to follow it.
export const ropeTopFactor = -1.55
// Where the HOOK hangs from, as a multiple of ropeHeight. This is the rope's
// TOP, which sits well off the top of the screen, so changing it does not move
// anything you can see.
export const hookTopFactor = -3.4
// The rope's visible LENGTH is no longer a constant. It used to be
// hookRopeLength = 2.72 of ropeHeight, and that could never be right: the sling
// ring it has to close on rides at a multiple of the BLOCK's height, the block
// is sized off the play column, and ropeHeight comes off the canvas height — so
// the two drift apart with the window's aspect and again with every clipped
// floor. hookPainter now solves the length from the ring's real position; see
// slingRingPos in block.js.

// Width of the drawn rope, as a multiple of ropeHeight. Also sets the size of
// the hook head, which is drawn at its native aspect off this width — so this is
// the one knob for "make the hook bigger".
export const hookSize = 0.13
export const flightCount = 'FLIGHT_COUNT'
export const flightLayer = 'FLIGHT_LAYER'
// The balloon has its own layer, painted after the tower, so it flies IN FRONT
// of the blocks. The birds on flightLayer stay behind them.
export const balloonLayer = 'BALLOON_LAYER'
// Set when the third life is lost. The whole scene freezes on this frame: no
// scrolling, no new blocks, no drifting sprites — see freezeGame().
export const gameOver = 'GAME_OVER'

export const rotateRight = 'ROTATE_RIGHT'
export const rotateLeft = 'ROTATE_LEFT'
export const swing = 'SWING'
export const beforeDrop = 'BEFORE_DROP'
export const drop = 'DROP'
export const land = 'LAND'
export const tip = 'TIP'
export const out = 'OUT'

export const initialAngle = 'INITIAL_ANGLE'

export const bgInitMovement = 'BG_INIT_MOVEMENT'
export const hookDownMovement = 'HOOK_DOWN_MOVEMENT'
export const hookUpMovement = 'HOOK_UP_MOVEMENT'
export const lightningMovement = 'LIGHTNING_MOVEMENT'
export const tutorialMovement = 'TUTORIAL_MOVEMENT'
export const moveDownMovement = 'MOVE_DOWN_MOVEMENT'

// When the last cream drip was voiced, so the tower bloops occasionally rather
// than once per bead. See playDrip in block.js.
export const dripSoundTime = 'DRIP_SOUND_TIME'
