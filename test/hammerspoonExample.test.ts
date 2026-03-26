import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

const HAMMERSPOON_EXAMPLE_PATH = path.join(process.cwd(), 'examples', 'hammerspoon', 'init.lua');

test('uses hotkey binding for Ghostty-only upload handling', () => {
    const script = fs.readFileSync(HAMMERSPOON_EXAMPLE_PATH, 'utf8');

    assert.match(script, /hotkey = \{ mods = \{ "cmd", "alt" \}, key = "v" \}/);
    assert.match(script, /hs\.hotkey\.bind/);
    assert.match(script, /if not isGhosttyFrontmost\(\) then\s+return\s+end/);
    assert.doesNotMatch(script, /hs\.eventtap\.new/);
    assert.doesNotMatch(script, /hs\.application\.watcher\.new/);
    assert.doesNotMatch(script, /syncKeyInterceptorState\(\)/);
});
