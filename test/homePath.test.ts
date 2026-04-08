import test from 'node:test';
import assert from 'node:assert/strict';
import { inferHomeDirectoryFromWorkspacePath } from '../src/services/homePath';

test('infers linux user home from workspace path', () => {
    assert.equal(
        inferHomeDirectoryFromWorkspacePath('/home/alice/workspace/project'),
        '/home/alice'
    );
});

test('infers macOS user home from workspace path', () => {
    assert.equal(
        inferHomeDirectoryFromWorkspacePath('/Users/bob/dev/project'),
        '/Users/bob'
    );
});

test('infers root home from root workspace path', () => {
    assert.equal(
        inferHomeDirectoryFromWorkspacePath('/root/workspace/project'),
        '/root'
    );
});

test('returns undefined for unsupported workspace path layout', () => {
    assert.equal(
        inferHomeDirectoryFromWorkspacePath('/opt/company/workspace/project'),
        undefined
    );
});
