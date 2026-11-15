// input.js — keyboard, mouse and pointer lock. Movement keys are read as a
// set; look comes from pointer-lock deltas, with a drag fallback so the game
// stays playable when pointer lock is refused (headless browsers, iframes).
// 'use' (KeyE) is the plant/defuse key; 'fire' is the left mouse button.
export function createInput(canvas) {
  const input = {
    keys: new Set(),
    lookDX: 0,
    lookDY: 0,
    firing: false,
    scoped: false,
    locked: false,
    dragging: false,
    pressed: new Set(), // keys pressed since last step (edge-triggered)
  };

  const KEYMAP = {
    KeyW: 'forward', KeyA: 'left', KeyS: 'back', KeyD: 'right',
    ShiftLeft: 'walk', ShiftRight: 'walk',
    ControlLeft: 'crouch', ControlRight: 'crouch',
    Space: 'jump', KeyE: 'use',
  };

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    const mapped = KEYMAP[e.code];
    if (mapped) {
      input.keys.add(mapped);
      input.pressed.add(mapped);
      if (mapped === 'jump' || mapped === 'crouch') e.preventDefault();
    }
    input.pressed.add(e.code);
    if (e.code === 'Space') e.preventDefault();
  });
  window.addEventListener('keyup', (e) => {
    const mapped = KEYMAP[e.code];
    if (mapped) input.keys.delete(mapped);
    input.pressed.delete(e.code);
  });
  window.addEventListener('blur', () => { input.keys.clear(); input.firing = false; });

  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) {
      input.firing = true;
      input.dragging = true;
    }
    if (e.button === 2) input.scoped = true;
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) { input.firing = false; input.dragging = false; }
    if (e.button === 2) input.scoped = false;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  document.addEventListener('pointerlockchange', () => {
    input.locked = document.pointerLockElement === canvas;
  });
  document.addEventListener('mousemove', (e) => {
    if (input.locked) {
      input.lookDX += e.movementX;
      input.lookDY += e.movementY;
    } else if (input.dragging) {
      input.lookDX += e.movementX;
      input.lookDY += e.movementY;
    }
  });

  input.requestLock = () => {
    if (!input.locked) {
      try {
        const p = canvas.requestPointerLock();
        if (p && p.catch) p.catch(() => { /* drag fallback stays on */ });
      } catch { /* drag fallback stays on */ }
    }
  };
  input.consumeLook = () => {
    const dx = input.lookDX, dy = input.lookDY;
    input.lookDX = 0; input.lookDY = 0;
    return [dx, dy];
  };
  input.consumePressed = (code) => {
    if (input.pressed.has(code)) { input.pressed.delete(code); return true; }
    return false;
  };
  input.clearPressed = () => input.pressed.clear();

  return input;
}
