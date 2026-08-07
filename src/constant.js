export const gameStartNow = 'GAME_START_NOW'
export const gameUserOption = 'GAME_USER_OPTION'
export const hardMode = 'HARD_MODE'

export const successCount = 'SUCCESS_COUNT'
export const failedCount = 'FAILED_COUNT'
export const perfectCount = 'PERFECT_COUNT'
export const gameScore = 'GAME_SCORE'

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
export const cloudSize = 'CLOUD_SIZE'
export const ropeHeight = 'ROPE_HEIGHT'
// Where the rope/hook hangs from, as a multiple of ropeHeight. More negative
// lifts the block higher up off the top of the screen. This is the knob for the
// BLOCK's hang height only — the hook stays put, see hookRopeLength.
export const ropeTopFactor = -1.55
// Where the HOOK hangs from, as a multiple of ropeHeight. This is the rope's
// TOP, which sits well off the top of the screen, so changing it does not move
// anything you can see — use hookRopeLength for that.
export const hookTopFactor = -3.4
// Visible length of the drawn rope, as a multiple of ropeHeight, measured down
// from the hook's pivot. Bigger = hook head lower, smaller = higher.
//
// Held INDEPENDENT of ropeTopFactor on purpose. The rope used to be sized from
// the hook-to-block gap, which meant every nudge of the block's hang height
// lengthened the rope by the same amount and dragged the hook down with it —
// the block could never move relative to the hook.
//
// The slack between the two is taken up by the sling drawn into the top half of
// block-rope.png: the hook head just needs to overlap it somewhere. That gives
// roughly 0.19 of ropeHeight of play before the head clears the sling entirely
// and the rig visibly separates into two floating pieces.
export const hookRopeLength = 2.72
// Width of the drawn rope, as a multiple of ropeHeight. Also sets the size of
// the hook head, which is drawn at its native aspect off this width — so this is
// the one knob for "make the hook bigger".
export const hookSize = 0.13
export const flightCount = 'FLIGHT_COUNT'
export const flightLayer = 'FLIGHT_LAYER'

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
