/**
 * Every bit of text a player reads lives here, so it can be checked and,
 * one day, translated. Canadian spelling.
 */
const STRINGS = {
  'game.name': 'Bump Stop',
  'game.tagline': 'Build a rally truck, find the speed where it breaks, then go racing.',
  'preview.kicker': 'A rally-raid truck builder',
  'preview.note': 'This is a preview. The ride sim, wear and breaks are in; the build screen comes next.',

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

  'break.title': 'Break test',
  'break.lead':
    'The test truck runs a loop 5 km/h faster every lap until something lets go. Then you see what broke, why, the last few seconds before it did, and where to fix it.',
  'break.torture': 'Torture loop',
  'break.ladder': 'Washboard ladder',
  'break.run': 'Run until it breaks',
  'break.result': 'Lap {lap}, {speed} km/h: {what}, {where}.',
  'break.whereFrame': '{zone} of the frame',
  'break.none': 'It lasted every lap without breaking.',
  'break.fixes': 'Where to fix it',
  'break.limit': 'Limit',
  'break.axis': 'last 3 s →',
  'break.alt': 'Line chart of {channel} in the last 3 seconds before the {what}, crossing its limit of {limit}.',
  'break.chOil': 'damper oil temperature (°C)',
  'break.chTravel': 'wheel travel (cm)',
  'break.chDamage': 'damage (%)',
  'break.chAngle': 'joint angle (degrees)',
  'break.chStrength': 'share of the axle’s strength in use (%)',
  'break.chSquash': 'tire squash (cm)',
  'break.timing': '{laps} laps worked out in {ms} ms on this device.',

  'fail.fade': 'Damper fade',
  'fail.fadeCause': 'The oil got too hot, so the damper stopped damping and the wheel started to skip.',
  'fail.fadeTrace': 'Oil temperature crossing the red line, then wheel travel going wild.',
  'fail.bottoming': 'Bottomed out',
  'fail.bottomingCause': 'The spring and bump stop ran out of travel and the wheel hit metal to metal.',
  'fail.bottomingTrace': 'Wheel travel hitting the stop, with a spike in load.',
  'fail.mount': 'Cracked mount',
  'fail.mountCause': 'Hit after hit wore out a shock and spring mount until it cracked.',
  'fail.mountTrace': 'The mount’s damage bar filling up over the laps.',
  'fail.axle': 'Snapped axle',
  'fail.axleCause': 'Too much torque through the axle or CV joint, worse at a steep angle or landing on a spinning wheel.',
  'fail.axleTrace': 'Joint angle and torque at the moment it let go.',
  'fail.tire': 'Cut tire',
  'fail.tireCause': 'The tire squashed onto a sharp rock and the casing gave.',
  'fail.tireTrace': 'How far the tire squashed, and how sharp the hit was.',
  'fail.frame': 'Cracked frame',
  'fail.frameCause': 'The frame flexed one time too many and a crack opened.',
  'fail.frameTrace': 'The damage map along the frame.',

  'fix.damperSize': 'Bigger damper or a remote reservoir',
  'fix.lessCompression': 'Fewer clicks of compression',
  'fix.slower': 'A slower pace',
  'fix.stifferSprings': 'Stiffer springs',
  'fix.bumpStops': 'Longer or hydraulic bump stops',
  'fix.rideHeight': 'More ride height',
  'fix.mounts': 'Stronger mounts',
  'fix.softerBumpStops': 'Softer bump stops',
  'fix.limitStraps': 'Shorter limit straps (less droop)',
  'fix.axles': 'Stronger axles or CVs',
  'fix.tirePressure': 'More tire pressure',
  'fix.tireCasing': 'A tougher casing',
  'fix.beadlocks': 'Beadlocks',
  'fix.frame': 'A stiffer frame',
  'fix.gussets': 'Gussets',

  'corner.0': 'front left',
  'corner.1': 'front right',
  'corner.2': 'rear left',
  'corner.3': 'rear right',
  'zone.front': 'front',
  'zone.centre': 'centre',
  'zone.rear': 'rear',

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
