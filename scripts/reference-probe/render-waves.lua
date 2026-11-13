-- Controlled synthetic 48 kHz offline black-box RE probe. Creates a new
-- unsaved project tab in a distinct REAPER instance. Writes only to .local-tools.
local base = os.getenv('VINYL_LAB_PROBE_DIR')
  or 'D:/dev/vinyl-physics-lab/.local-tools/reaper-probe/'
if base:sub(-1) ~= '/' then base = base .. '/' end
local f = assert(io.open(base .. 'render-log.tsv', 'w'))
local function log(tag, detail)
  f:write(tag, '\t', tostring(detail or ''), '\n')
  f:flush()
end
local function setstr(key, value)
  local ok, returned = reaper.GetSetProjectInfo_String(0, key, value, true)
  log(key, tostring(ok) .. ':' .. tostring(returned))
end

-- Avoid modifying whatever project the REAPER profile would otherwise reopen.
reaper.Main_OnCommand(40859, 0)  -- File: New project tab
reaper.GetSetProjectInfo(0, 'PROJECT_SRATE', 48000, true)
reaper.GetSetProjectInfo(0, 'PROJECT_SRATE_USE', 1, true)
reaper.InsertTrackAtIndex(0, true)
local track = reaper.GetTrack(0, 0)
local item = reaper.AddMediaItemToTrack(track)
local take = reaper.AddTakeToMediaItem(item)
local source = reaper.PCM_Source_CreateFromFile(base .. 'reference-4s-48k.wav')
if not source then log('error', 'Cannot open test wav'); f:close(); return end
reaper.SetMediaItemTake_Source(take, source)
reaper.SetMediaItemInfo_Value(item, 'D_POSITION', 0)
reaper.SetMediaItemInfo_Value(item, 'D_LENGTH', 4)
reaper.UpdateArrange()

setstr('RENDER_FILE', base .. 'renders')
setstr('RENDER_FORMAT', 'evaw')
setstr('RENDER_FORMAT2', '')
reaper.GetSetProjectInfo(0, 'RENDER_SETTINGS', 0, true) -- master mix
reaper.GetSetProjectInfo(0, 'RENDER_BOUNDSFLAG', 0, true)
reaper.GetSetProjectInfo(0, 'RENDER_STARTPOS', 0, true)
reaper.GetSetProjectInfo(0, 'RENDER_ENDPOS', 4, true)
reaper.GetSetProjectInfo(0, 'RENDER_CHANNELS', 2, true)
reaper.GetSetProjectInfo(0, 'RENDER_SRATE', 48000, true)
reaper.GetSetProjectInfo(0, 'RENDER_TAILFLAG', 0, true)
reaper.GetSetProjectInfo(0, 'RENDER_NORMALIZE', 0, true)
reaper.GetSetProjectInfo(0, 'RENDER_DITHER', 16, true)

local function render(name)
  -- REAPER opens an overwrite prompt on existing filenames. Never overwrite
  -- reference data, or hang unattended with a modal dialog.
  local prior = io.open(base .. 'renders/' .. name .. '.wav', 'rb')
  if prior then
    prior:close()
    log('render_skipped_existing', name)
    return
  end
  setstr('RENDER_PATTERN', name)
  log('render_start', name)
  reaper.Main_OnCommand(42230, 0)  -- render with last settings, auto-close
  log('render_done', name)
end

render('baseline-bypass-v2')
local fx = reaper.TrackFX_AddByName(track,
  'VST3: Abbey Road Vinyl Stereo (Waves)', false, 1)
log('waves_fx', fx)
if fx >= 0 then
  local function set(param, norm)
    reaper.TrackFX_SetParamNormalized(track, fx, param, norm)
    local _, pretty = reaper.TrackFX_GetFormattedParamValue(track, fx, param, '')
    log('param_' .. param, pretty)
  end
  set(3, 0)   -- TG desk off
  set(4, 0)   -- lacquer
  set(5, 0)   -- Abbey Road turntable
  set(6, 0)   -- MM
  set(7, 0)   -- noise level minimum
  set(8, 0)   -- crackle level minimum
  set(9, 0)   -- clicks off
  set(12, 0.5)  -- wow depth zero
  set(14, 0.5)  -- flutter depth zero
  set(16, 0)  -- phase distortion off
  set(24, 0) -- input drive OFF (previous exploratory .5 was +50%)
  render('waves-mm-lacquer-drive0')
  set(6, .5) -- MC
  render('waves-mc-lacquer-drive0')
  set(6, 0) -- MM again
  set(3, 1) -- TG desk on
  render('waves-mm-tgdesk-on')
  set(3, 0)
  set(4, 1) -- pressed print
  render('waves-mm-print-drive0')
  reaper.TrackFX_Delete(track, fx)
end

local lathe = reaper.TrackFX_AddByName(track,
  'VST3: TDR SimuLathe REF (Tokyo Dawn Labs)', false, 1)
log('simulathe_fx', lathe)
if lathe >= 0 then
  for j = 0, 10 do
    local v = j / 10
    reaper.TrackFX_SetParamNormalized(track, lathe, 21, v)
    local _, desc = reaper.TrackFX_GetFormattedParamValue(track, lathe, 21, '')
    log('simulathe_pickup_' .. v, desc)
  end
  reaper.TrackFX_Delete(track, lathe)
end
log('__complete__', 'yes')
f:close()
