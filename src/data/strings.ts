/**
 * Every bit of text a player reads lives here, so it can be checked and,
 * one day, translated. Canadian spelling.
 */
const STRINGS = {
  'game.name': 'Bump Stop',
  'game.tagline': 'Build a rally truck, find the speed where it breaks, then go racing.',
  'preview.kicker': 'A rally-raid truck builder',
  'preview.note': 'This is a preview. The ride sim is in; wear and breaks come next, then the build screen.',

  'loop.title': 'The loop',
  'loop.build': 'Build it',
  'loop.buildText': 'Frame, springs, dampers, bump stops, axles and tires, under the class weight and your budget.',
  'loop.break': 'Break it',
  'loop.breakText': 'The test track speeds up lap by lap until something lets go.',
  'loop.tune': 'Tune it',
  'loop.tuneText': 'The report says what failed and why, and jumps to the setting that fixes it.',
  'loop.prove': 'Prove it',
  'loop.proveText': 'Enter a raid. Call the pace, patch the truck each night, and watch the damage stack up.',

  'roadbook.title': 'Roadbook',
  'roadbook.km': 'km',
  'roadbook.row1': 'Washboard for 2 km. Steady.',
  'roadbook.row2': 'Crest, then a jump. Caution.',
  'roadbook.row3': 'Rock garden. Tire pressure up.',
  'roadbook.tulipStraight': 'Straight on',
  'roadbook.tulipRight': 'Keep right',
  'roadbook.tulipLeft': 'Sharp left',

  'trace.redline': 'Red line',
  'trace.cool': 'Normal',
  'trace.warm': 'Warm',
  'trace.hot': 'Over the limit',

  'sim.title': 'Ride sim: test stage',
  'sim.lead':
    'The real ride sim drives a 12 km test stage, 500 steps a second. Every bump turns into heat in the dampers, and hot oil damps less. Pick a truck.',
  'sim.anotherRoad': 'Another road',
  'sim.road': 'Road {n}',
  'sim.chartTitle': 'Hottest damper oil temperature',
  'sim.axis': 'km → · °C ↑',
  'sim.alt': 'Line chart of the hottest damper oil temperature along the {km} km test stage, peaking at {temp} °C at km {at}.',
  'sim.peak': 'Peak {temp} °C at km {at}.',
  'sim.details': 'Bottomed out {bumps} times, {air} s with all four wheels in the air.',
  'sim.timing': 'Worked out in {ms} ms on this device.',
  'sim.segment': '{ground}, {speed} km/h',
  'sim.long': 'Run a 300 km stage',
  'sim.running': 'Running…',
  'sim.longResult':
    '300 km worked out in {ms} ms, finishing at {temp} °C. Only {pct}% ran in full detail; the rest was scaled from those samples.',

  'ground.graded': 'Graded road',
  'ground.washboard': 'Washboard',
  'ground.whoops': 'Whoops',
  'ground.rocks': 'Rock garden',
  'ground.jumps': 'Jumps',
  'ground.iceHeaves': 'Frost heaves',

  'classes.title': 'Three classes',
  'class.light4x4': 'Light 4x4',
  'class.light4x4Text': 'Nimble, fragile and cheap to fix. The career starts here.',
  'class.heavy': 'Heavy truck',
  'class.heavyText': 'Big and slow to heat-soak, but brutal on axles and ice.',
  'class.sxs': 'Side-by-side',
  'class.sxsText': 'Huge wheel travel and tiny dampers that cook fast.',
  'class.weight': 'Weight',

  'footer.studio': 'Longlight Interactive',
  'boot.failed': 'Bump Stop could not start. Reload to try again.',
} as const

export type StringKey = keyof typeof STRINGS

export function t(key: StringKey): string {
  return STRINGS[key]
}

/** A string with {name} gaps filled in: tf('sim.peak', { temp: '96', at: '7.2' }). */
export function tf(key: StringKey, vars: Record<string, string>): string {
  return STRINGS[key].replace(/\{(\w+)\}/g, (all, name: string) => vars[name] ?? all)
}
