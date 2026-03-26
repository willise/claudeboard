local config = {
    hotkey = { mods = { "cmd", "alt" }, key = "v" },
    ghosttyAppName = "Ghostty",
    registryDir = os.getenv("HOME") .. "/.claudeboard/ghostty-bridges",
    bridgeUploadPath = "/ghostty-upload",
    requestTimeoutSeconds = 30,
    typeDelaySeconds = 0.05,
}

math.randomseed(os.time())

local uploadHotkey = nil
local activeRequestId = nil
local activeRequestTimer = nil
local activeGhosttyApp = nil

local function alert(message)
    hs.alert.show(message, 2)
end

local function isGhosttyFrontmost()
    local frontmost = hs.application.frontmostApplication()
    return frontmost and frontmost:name() == config.ghosttyAppName
end

local function buildBridgeUrl(port, path)
    return string.format("http://127.0.0.1:%d%s", port, path)
end

local function typeIntoGhostty(remotePath)
    local ghostty = activeGhosttyApp
    if not ghostty then
        local frontmost = hs.application.frontmostApplication()
        if frontmost and frontmost:name() == config.ghosttyAppName then
            ghostty = frontmost
        end
    end

    if not ghostty then
        alert("Claudeboard: Ghostty app handle is unavailable")
        return
    end

    if not isGhosttyFrontmost() then
        ghostty:activate()
    end

    hs.timer.doAfter(config.typeDelaySeconds, function()
        if not isGhosttyFrontmost() then
            alert("Claudeboard: Ghostty is no longer focused")
            return
        end

        hs.eventtap.keyStrokes(remotePath)
    end)
end

local function clearActiveRequest(requestId)
    if requestId and activeRequestId ~= requestId then
        return
    end

    activeRequestId = nil

    if activeRequestTimer then
        activeRequestTimer:stop()
        activeRequestTimer = nil
    end
end

local function decodeJson(body)
    if type(body) ~= "string" or body == "" then
        return nil
    end

    local trimmed = body:match("^%s*(.-)%s*$")
    if trimmed:sub(1, 1) ~= "{" then
        return nil
    end

    local ok, payload = pcall(hs.json.decode, trimmed)
    if ok and type(payload) == "table" then
        return payload
    end

    return nil
end

local function shellQuote(value)
    return "'" .. string.gsub(value, "'", "'\"'\"'") .. "'"
end

local function loadBridgeCandidates()
    local command = "/bin/ls -1 " .. shellQuote(config.registryDir) .. "/*.json 2>/dev/null"
    local pipe = io.popen(command)
    if not pipe then
        return {}
    end

    local output = pipe:read("*a")
    pipe:close()

    local candidates = {}
    for filePath in string.gmatch(output, "[^\r\n]+") do
        local file = io.open(filePath, "r")
        if file then
            local body = file:read("*a")
            file:close()

            local payload = decodeJson(body)
            if payload
                and type(payload.port) == "number"
                and type(payload.uriScheme) == "string"
                and type(payload.priority) == "number"
                and type(payload.updatedAt) == "number" then
                payload.registryPath = filePath
                table.insert(candidates, payload)
            end
        end
    end

    table.sort(candidates, function(left, right)
        if left.priority ~= right.priority then
            return left.priority < right.priority
        end

        if left.focused ~= right.focused then
            return left.focused == true
        end

        return (left.updatedAt or 0) > (right.updatedAt or 0)
    end)

    return candidates
end

local function removeBridgeCandidate(candidate)
    if not candidate or type(candidate.registryPath) ~= "string" then
        return
    end

    os.remove(candidate.registryPath)
end

local function tryBridgeUpload(candidates, candidateIndex, requestId, imageBase64)
    local candidate = candidates[candidateIndex]
    if not candidate then
        clearActiveRequest(requestId)
        alert("Claudeboard: no reachable IDE bridge is available")
        return
    end

    local uploadUrl = buildBridgeUrl(candidate.port, config.bridgeUploadPath)
    local requestBody = hs.json.encode({
        action = "uploadClipboardImage",
        requestId = requestId,
        imageData = imageBase64,
    })

    if type(requestBody) ~= "string" or requestBody == "" then
        clearActiveRequest(requestId)
        alert("Claudeboard: failed to encode bridge request")
        return
    end

    hs.http.asyncPost(
        uploadUrl,
        requestBody,
        { ["Content-Type"] = "application/json" },
        function(status, responseBody, headers)
            if activeRequestId ~= requestId then
                return
            end

            if status < 0 then
                removeBridgeCandidate(candidate)
                tryBridgeUpload(candidates, candidateIndex + 1, requestId, imageBase64)
                return
            end

            local payload = decodeJson(responseBody)

            if not payload or payload.requestId ~= requestId then
                removeBridgeCandidate(candidate)
                tryBridgeUpload(candidates, candidateIndex + 1, requestId, imageBase64)
                return
            end

            clearActiveRequest(requestId)

            if payload.ok then
                if type(payload.remotePath) ~= "string" or payload.remotePath == "" then
                    alert("Claudeboard: response was missing remotePath")
                    return
                end

                typeIntoGhostty(payload.remotePath)
                return
            end

            alert("Claudeboard: " .. tostring(payload.error or "Upload failed"))
        end
    )
end

local function checkClipboardHasImage()
    local types = hs.pasteboard.contentTypes()
    if not types or #types == 0 then
        return false, "clipboard is empty"
    end

    for _, uti in ipairs(types) do
        if uti == "public.png"
            or uti == "public.tiff"
            or uti == "public.jpeg"
            or string.find(uti, "^public%.image") then
            return true, nil
        end
    end

    return false, "clipboard does not contain an image"
end

local function readClipboardImageBase64()
    local image = hs.pasteboard.readImage()
    if not image then
        return nil
    end

    local dataUrl = image:encodeAsURLString()
    if not dataUrl or dataUrl == "" then
        return nil
    end

    return string.match(dataUrl, "base64,(.+)")
end

local function startGhosttyUpload()
    if not isGhosttyFrontmost() then
        return
    end

    if activeRequestId then
        alert("Claudeboard: upload already in progress")
        return
    end

    activeGhosttyApp = hs.application.frontmostApplication()
    if not activeGhosttyApp then
        alert("Claudeboard: failed to capture Ghostty application")
        return
    end

    local hasImage, reason = checkClipboardHasImage()
    if not hasImage then
        alert("Claudeboard: " .. reason)
        return
    end

    local imageBase64 = readClipboardImageBase64()
    if not imageBase64 then
        alert("Claudeboard: failed to read clipboard image")
        return
    end

    local requestId = string.format("%d-%d", math.floor(hs.timer.secondsSinceEpoch()), math.random(100000, 999999))
    activeRequestId = requestId
    activeRequestTimer = hs.timer.doAfter(config.requestTimeoutSeconds, function()
        if activeRequestId == requestId then
            clearActiveRequest(requestId)
            alert("Claudeboard: upload timed out")
        end
    end)

    local candidates = loadBridgeCandidates()
    if #candidates == 0 then
        clearActiveRequest(requestId)
        alert("Claudeboard: no IDE bridge is available")
        return
    end

    tryBridgeUpload(candidates, 1, requestId, imageBase64)
end

uploadHotkey = hs.hotkey.bind(config.hotkey.mods, config.hotkey.key, function()
    if not isGhosttyFrontmost() then
        return
    end

    startGhosttyUpload()
end)

alert("Claudeboard Ghostty bridge loaded")
