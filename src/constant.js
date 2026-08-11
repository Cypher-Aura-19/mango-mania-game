export const gameStartNow = 'GAME_START_NOW'
export const gameUserOption = 'GAME_USER_OPTION'
export const hardMode = 'HARD_MODE'

/* The canvas fills the whole window, but the tower is stacked inside a centred
 * portrait COLUMN of it — the same 1:1.5 box the canvas used to be clamped to.
 * Everything the player aims with (block width, hook, tower line, HUD) is keyed
 * to the column so the game plays identically at every screen shape; only the
 * scenery — backdrop, clouds, customer, birds — uses the full canvas, which is
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
//
// It has no gauge any more: the customer says it themselves, on video. What the
// number still does is carry the mood between landings and pay the tip.
export const satisfaction = 'SATISFACTION'
export const satisfactionStart = 60
// A landing that keeps at least this much of the layer pleases the customer;
// below it, they mind the waste. Also the bar for the HAPPY reaction clip: a
// landing has to be perfect or near-perfect to be worth a face.
export const satisfactionGoodKeep = 0.8
// ...and the bar for the ANGRY one, from the other end: keep a third or less of
// the layer and the customer minds out loud. Between the two they say nothing
// and keep watching, which is most drops — see moodForKeep in utils.js.
export const moodAngryKeep = 0.65
// Score is nudged by (satisfaction change) x this. Small on purpose: a full
// swing from delighted to furious is worth about two clean landings, so the
// meter colours the score rather than dominating it.
export const satisfactionScoreRate = 0.6

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
// The customer has their own layer, painted after the tower, so they hover IN
// FRONT of the blocks. The birds on flightLayer stay behind them.
export const customerLayer = 'CUSTOMER_LAYER'
/* Which reaction clip the customer should be playing, and the game time the ask
 * came in — a reaction holds for a moment and then lapses back to watching, so
 * the request needs its timestamp as much as its name. See src/customer.js. */
export const customerMood = 'CUSTOMER_MOOD'
export const customerMoodAt = 'CUSTOMER_MOOD_AT'
/* The engine hands the frame time to actions but keeps no clock a non-action can
 * read, and the landing path is a plain function call — so the customer's action
 * parks the time here for setCustomerMood to stamp a request with. */
export const gameTime = 'GAME_TIME'
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
