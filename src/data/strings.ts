/**
 * Every bit of text a player reads lives here, so it can be checked and,
 * one day, translated. Canadian spelling.
 */
const STRINGS = {
  'game.name': 'Bump Stop',
  'game.tagline': 'Build a rally truck, find the speed where it breaks, then go racing.',
  'preview.kicker': 'A rally-raid truck builder',
  'preview.note': 'This is a look preview. The ride sim comes next, then wear and breaks, then the build screen.',

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

  'trace.title': 'Rear damper oil temperature',
  'trace.lead': 'Every lap of the washboard ladder runs 5 km/h faster. Hot oil damps less, and the wheels start to skip.',
  'trace.axisX': 'Lap',
  'trace.axisY': '°C',
  'trace.redline': 'Red line',
  'trace.cool': 'Normal',
  'trace.warm': 'Warm',
  'trace.hot': 'Over the limit',
  'trace.verdict': 'Damper fade on lap 6',
  'trace.sample': 'Sample numbers, not the sim yet.',
  'trace.alt':
    'Line chart: oil temperature climbs from 40 °C on lap 1 to 150 °C on lap 6, crossing the 130 °C red line on lap 6.',

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
