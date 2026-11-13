-- Read-only REAPER API enumeration, run via REAPER command-line script argument.
-- Never changes session, FX parameters, or license state.
local base = os.getenv('VINYL_LAB_PROBE_DIR')
  or 'D:/dev/vinyl-physics-lab/.local-tools/reaper-probe/'
if base:sub(-1) ~= '/' then base = base .. '/' end
local output = base .. 'reference-inventory.tsv'
local f, err = io.open(output, 'w')
if not f then return end
f:write('index\tname\tident\n')
local count = 0
for i = 0, 40000 do
  local ok, name, ident = reaper.EnumInstalledFX(i)
  if not ok then break end
  if name and (name:lower():find('simulathe', 1, true)
    or name:lower():find('abbey road vinyl', 1, true)) then
    f:write(tostring(i), '\t', name:gsub('[\t\n\r]', ' '), '\t',
      (ident or ''):gsub('[\t\n\r]', ' '), '\n')
    count = count + 1
  end
end
f:write('matched\t', tostring(count), '\t\n')
f:close()
