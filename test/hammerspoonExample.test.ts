import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

const HAMMERSPOON_EXAMPLE_PATH = path.join(process.cwd(), 'examples', 'hammerspoon', 'init.lua');

test('uses eventtap interception for Ghostty-only hotkey handling', () => {
    const script = fs.readFileSync(HAMMERSPOON_EXAMPLE_PATH, 'utf8');

    assert.match(script, /hotkey = \{ mods = \{ "cmd", "alt" \}, key = "v" \}/);
    assert.match(script, /hs\.eventtap\.new/);
    assert.match(script, /if not isGhosttyFrontmost\(\) then\s+return false/);
    assert.match(script, /hs\.application\.watcher\.new/);
    assert.match(script, /keyInterceptor:stop\(\)/);
    assert.match(script, /syncKeyInterceptorState\(\)/);
    assert.doesNotMatch(script, /hs\.hotkey\.bind/);
});
