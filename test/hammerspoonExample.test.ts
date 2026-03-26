import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

const HAMMERSPOON_EXAMPLE_PATH = path.join(process.cwd(), 'examples', 'hammerspoon', 'init.lua');

test('uses hs.hotkey.bind instead of eventtap interception for Ghostty upload', () => {
    const script = fs.readFileSync(HAMMERSPOON_EXAMPLE_PATH, 'utf8');

    assert.match(script, /hs\.hotkey\.bind/);
    assert.doesNotMatch(script, /hs\.eventtap\.new/);
});
