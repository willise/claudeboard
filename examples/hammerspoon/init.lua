local config = {
    hotkey = { mods = { "ctrl", "alt" }, key = "v" },
    ghosttyAppName = "Ghostty",
    vscodeUri = "vscode://dkodr.claudeboard/ghostty-upload",
    serverInterface = "localhost",
    serverPort = 17777,
    callbackPath = "/claudeboard/callback",
    requestTimeoutSeconds = 30,
    typeDelaySeconds = 0.05,
}

math.randomseed(os.time())

local pendingRequests = {}
local server = hs.httpserver.new(false, false)
local ghosttyHotkey = nil
local appWatcher = nil

local function alert(message)
    hs.alert.show(message, 2)
end

local function encode(value)
    return hs.http.encodeForQuery(value)
end

local function buildCallbackUrl(requestId)
    return string.format(
        "http://127.0.0.1:%d%s",
        config.serverPort,
        config.callbackPath
    )
end

local function buildVscodeUri(requestId)
    local callbackUrl = buildCallbackUrl(requestId)
    return string.format(
        "%s?requestId=%s&callback=%s",
        config.vscodeUri,
        encode(requestId),
        encode(callbackUrl)
    )
end

local function isGhosttyFrontmost()
    local frontmost = hs.application.frontmostApplication()
    return frontmost and frontmost:name() == config.ghosttyAppName
end

local function typeIntoGhostty(remotePath)
    local ghostty = hs.application.get(config.ghosttyAppName)
    if not ghostty then
        alert("Claudeboard: Ghostty is not running")
        return
    end

    ghostty:activate()
    hs.timer.doAfter(config.typeDelaySeconds, function()
        if not isGhosttyFrontmost() then
            alert("Claudeboard: Ghostty is no longer focused")
            return
        end

        hs.eventtap.keyStrokes(remotePath)
    end)
end

local function clearPendingRequest(requestId)
    pendingRequests[requestId] = nil
end

server:setInterface(config.serverInterface)
server:setPort(config.serverPort)
server:setCallback(function(method, path, headers, body)
    if method ~= "POST" or path ~= config.callbackPath then
        return "not found", 404, { ["Content-Type"] = "text/plain" }
    end

    local ok, payload = pcall(hs.json.decode, body or "")
    if not ok or type(payload) ~= "table" then
        return "invalid json", 400, { ["Content-Type"] = "text/plain" }
    end

    local requestId = payload.requestId
    if type(requestId) ~= "string" or requestId == "" then
        return "missing requestId", 400, { ["Content-Type"] = "text/plain" }
    end

    if not pendingRequests[requestId] then
        return "unknown request", 404, { ["Content-Type"] = "text/plain" }
    end

    clearPendingRequest(requestId)

    if payload.ok then
        local remotePath = payload.remotePath
        if type(remotePath) ~= "string" or remotePath == "" then
            alert("Claudeboard: callback was missing the remote path")
            return "missing remotePath", 400, { ["Content-Type"] = "text/plain" }
        end

        typeIntoGhostty(remotePath)
        return "ok", 200, { ["Content-Type"] = "text/plain" }
    end

    local errorMessage = payload.error or "Upload failed"
    alert("Claudeboard: " .. errorMessage)
    return "ok", 200, { ["Content-Type"] = "text/plain" }
end)

if not server:start() then
    alert("Claudeboard: failed to start localhost callback server")
    return
end

local function startGhosttyUpload()
    if not isGhosttyFrontmost() then
        return
    end

    local requestId = string.format("%d-%d", math.floor(hs.timer.secondsSinceEpoch()), math.random(100000, 999999))
    pendingRequests[requestId] = true

    hs.timer.doAfter(config.requestTimeoutSeconds, function()
        if pendingRequests[requestId] then
            clearPendingRequest(requestId)
            alert("Claudeboard: upload timed out")
        end
    end)

    local uri = buildVscodeUri(requestId)
    local task = hs.task.new("/usr/bin/open", nil, { "-g", uri })
    if not task or not task:start() then
        clearPendingRequest(requestId)
        alert("Claudeboard: failed to open VS Code")
    end
end

local function disableGhosttyHotkey()
    if ghosttyHotkey then
        ghosttyHotkey:delete()
        ghosttyHotkey = nil
    end
end

local function enableGhosttyHotkey()
    if ghosttyHotkey then
        return
    end

    ghosttyHotkey = hs.hotkey.bind(
        config.hotkey.mods,
        config.hotkey.key,
        startGhosttyUpload
    )
end

local function syncGhosttyHotkey()
    if isGhosttyFrontmost() then
        enableGhosttyHotkey()
    else
        disableGhosttyHotkey()
    end
end

appWatcher = hs.application.watcher.new(function(appName, eventType)
    if eventType == hs.application.watcher.activated
        or eventType == hs.application.watcher.deactivated
        or eventType == hs.application.watcher.hidden
        or eventType == hs.application.watcher.unhidden then
        syncGhosttyHotkey()
    end
end)

appWatcher:start()
syncGhosttyHotkey()

alert("Claudeboard Ghostty bridge loaded")
