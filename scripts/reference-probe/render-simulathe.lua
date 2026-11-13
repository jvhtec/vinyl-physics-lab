-- One-shot REAPER 48 kHz black-box render for TDR SimuLathe REF.
-- Uses a new unsaved project tab, no third-party assets, no project files saved.
local base = os.getenv('VINYL_LAB_PROBE_DIR')
  or 'D:/dev/vinyl-physics-lab/.local-tools/reaper-probe/'
if base:sub(-1) ~= '/' then base = base .. '/' end
local f = assert(io.open(base .. 'simulathe-render-log.tsv', 'w'))
local function log(tag, value)
  f:write(tag, '\t', tostring(value or ''), '\n'); f:flush()
end
local function setstr(key, value)
  local ok, value2 = reaper.GetSetProjectInfo_String(0, key, value, true)
  log(key, tostring(ok) .. ':' .. tostring(value2))
end
reaper.Main_OnCommand(40859, 0)
reaper.GetSetProjectInfo(0, 'PROJECT_SRATE', 48000, true)
reaper.GetSetProjectInfo(0, 'PROJECT_SRATE_USE', 1, true)
reaper.InsertTrackAtIndex(0, true)
local track = reaper.GetTrack(0, 0)
local item = reaper.AddMediaItemToTrack(track)
local take = reaper.AddTakeToMediaItem(item)
local source = reaper.PCM_Source_CreateFromFile(base .. 'reference-4s-48k.wav')
if not source then log('error','Missing reference WAV'); f:close();return end
reaper.SetMediaItemTake_Source(take, source)
reaper.SetMediaItemInfo_Value(item,'D_POSITION',0)
reaper.SetMediaItemInfo_Value(item,'D_LENGTH',4)
reaper.UpdateArrange()
setstr('RENDER_FILE',base .. 'renders')
setstr('RENDER_FORMAT','evaw')
setstr('RENDER_FORMAT2','')
reaper.GetSetProjectInfo(0, 'RENDER_SETTINGS', 0, true)
reaper.GetSetProjectInfo(0, 'RENDER_BOUNDSFLAG', 0, true)
reaper.GetSetProjectInfo(0, 'RENDER_STARTPOS', 0, true)
reaper.GetSetProjectInfo(0, 'RENDER_ENDPOS', 4, true)
reaper.GetSetProjectInfo(0, 'RENDER_CHANNELS', 2, true)
reaper.GetSetProjectInfo(0, 'RENDER_SRATE', 48000, true)
reaper.GetSetProjectInfo(0, 'RENDER_TAILFLAG', 0, true)
reaper.GetSetProjectInfo(0, 'RENDER_NORMALIZE', 0, true)
reaper.GetSetProjectInfo(0, 'RENDER_DITHER', 16, true)
local function render(name)
  local prior = io.open(base .. 'renders/' .. name .. '.wav', 'rb')
  if prior then
    prior:close()
    log('render_skipped_existing', name)
    return
  end
  setstr('RENDER_PATTERN',name)
  log('render_start',name)
  reaper.Main_OnCommand(42230,0)
  log('render_done',name)
end

local fx = reaper.TrackFX_AddByName(track,
  'VST3: TDR SimuLathe REF (Tokyo Dawn Labs)', false, 1)
log('simulathe_fx',fx)
if fx >= 0 then
  local function set(p, value)
    reaper.TrackFX_SetParamNormalized(track, fx, p, value)
    local _, label = reaper.TrackFX_GetFormattedParamValue(track, fx, p, '')
    log('p' .. p, label)
  end
  set(0,1) -- host playhead sync
  set(6,0) -- preprocessors off
  set(17,1) -- virtual lathe on
  set(23,0) -- wear off
  set(25,0) -- dust off
  set(29,0) -- noise off
  set(34,0) -- defects off
  set(46,1) -- report preview latency to REAPER
  set(21,.2) -- cutter feedback
  render('tdr-feedback-v1')
  set(21,.5) -- physically modelled Hifi pickup
  render('tdr-hifi-v1')
  reaper.TrackFX_Delete(track, fx)
end
log('__complete__','yes')
f:close()
