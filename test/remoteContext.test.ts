import test from 'node:test';
import assert from 'node:assert/strict';
import { hasRemoteContext, isRemoteWorkspaceScheme } from '../src/services/remoteContext';

test('accepts non-empty remoteName', () => {
    assert.equal(hasRemoteContext({
        remoteName: 'ssh-remote+prod',
        workspaceFolderSchemes: []
    }), true);
});

test('accepts vscode remote workspace scheme without remoteName', () => {
    assert.equal(hasRemoteContext({
        remoteName: '',
        workspaceFolderSchemes: ['vscode-remote']
    }), true);
});

test('accepts custom remote workspace scheme that ends with -remote', () => {
    assert.equal(hasRemoteContext({
        remoteName: undefined,
        workspaceFolderSchemes: ['trae-remote']
    }), true);
});

test('rejects local context without remoteName and remote workspace scheme', () => {
    assert.equal(hasRemoteContext({
        remoteName: '   ',
        workspaceFolderSchemes: ['file', 'untitled']
    }), false);
});

test('detects supported remote workspace scheme variants', () => {
    assert.equal(isRemoteWorkspaceScheme('vscode-remote'), true);
    assert.equal(isRemoteWorkspaceScheme('trae-remote'), true);
    assert.equal(isRemoteWorkspaceScheme('file'), false);
});
