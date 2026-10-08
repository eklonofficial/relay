// The mechanical moments of each reload clip: [frame at 60 fps in the source clip, the sample to
// play, what happens]. WeaponRig maps the frames onto the gameplay reload clock; the viewmodel jolts
// the gun on each one. [short reload, reload from empty].
const OUT = 'out', IN = 'in', RACK = 'rack', PULL = 'pull', OPEN = 'open', LOAD = 'load', CLOSE = 'close';
const mag = (out, magIn, rack, ins = 'effect_136', outs = 'effect_137', rackSample = 'effect_135') => [
  [[out, outs, OUT], [magIn, ins, IN]],
  [[out, outs, OUT], [magIn, ins, IN], ...(rack ? [[rack, rackSample, RACK]] : [])],
];
export const RELOAD_CUES = {
  yolk47: mag(30, 123, 155),
  beater: mag(30, 150, 185, 'effect_136', 'effect_137', 'effect_179'),
  triBoil: mag(28, 118, 153, 'effect_075', 'effect_076', 'effect_073'),
  peck9mm: mag(15, 110, 155, 'effect_091', 'effect_092'),
  cageFree: [
    [[25, 'effect_137', OUT], [125, 'effect_136', IN]],
    [[30, 'effect_103', PULL], [75, 'effect_137', OUT], [160, 'effect_136', IN], [190, 'effect_104', RACK]],
  ],
  doubleYolker: Array(2).fill([[0, 'effect_122', OPEN], [80, 'effect_121', LOAD], [115, 'effect_119', CLOSE]]),
  poacher: Array(2).fill([[10, 'effect_152', OPEN], [75, 'effect_136', LOAD], [94, 'effect_151', CLOSE]]),
  yolkzooka: Array(2).fill([[115, 'effect_166', IN]]),
};
