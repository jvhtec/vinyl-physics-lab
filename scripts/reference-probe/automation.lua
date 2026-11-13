-- One-shot non-persistent FX automation discovery in a separate REAPER process.
-- No user project is saved. The temporary track is deleted after the probe.
local base = os.getenv('VINYL_LAB_PROBE_DIR')
  or 'D:/dev/vinyl-physics-lab/.local-tools/reaper-probe/'
if base:sub(-1) ~= '/' then base = base .. '/' end
local out = base .. 'parameters.tsv'
local f = assert(io.open(out, 'w'))
f:write('plugin\tindex\tname\tnormalized\tformatted\n')
local names = {
  'VST3: TDR SimuLathe REF (Tokyo Dawn Labs)',
  'VST3: Abbey Road Vinyl Stereo (Waves)',
  'VST3: Abbey Road Vinyl Light Stereo (Waves)'
}
local idx = reaper.CountTracks(0)
reaper.InsertTrackAtIndex(idx, true)
local track = reaper.GetTrack(0, idx)
for _,name in ipairs(names) do
  local fx = reaper.TrackFX_AddByName(track, name, false, 1)
  if fx >= 0 then
    local n = reaper.TrackFX_GetNumParams(track, fx)
    f:write(name, '\tCOUNT\t', tostring(n), '\t\t\n')
    for p=0,n-1 do
      local _, label = reaper.TrackFX_GetParamName(track, fx, p, '')
      local normalized = reaper.TrackFX_GetParamNormalized(track, fx, p)
      local _, formatted = reaper.TrackFX_GetFormattedParamValue(track, fx, p, '')
      f:write(name, '\t', tostring(p), '\t',
        (label or ''):gsub('[\t\n\r]', ' '), '\t', tostring(normalized or ''),
        '\t', (formatted or ''):gsub('[\t\n\r]', ' '), '\n')
    end
    reaper.TrackFX_Delete(track, fx)
  else
    f:write(name, '\tERROR\tCannot instantiate\t\t\n')
  end
end
reaper.DeleteTrack(track)
f:write('__complete__\tDONE\tprobe finished\t\t\n')
f:close()
