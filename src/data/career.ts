/**
 * The career, 1985 to 2025 (plan PR 9). Every tuning number for the career
 * lives here; `src/sim/career.ts` and `src/sim/teams.ts` use them. How it all
 * fits together: `docs/CAREER.md`.
 *
 * Money is in the game's money, written cr. (Kelbo's pick, `docs/NAMES.md`). Prices of parts are in
 * `src/data/parts.ts` and don't change with the years: the career gets
 * harder because the rivals' budgets grow and the parts get better.
 *
 * Names: the raids are Kelbo's picks; teams, drivers, sponsors and
 * privateers are still working names. All live only in `src/data/strings.ts`.
 */
import type { ClassId } from './classes'
import { FIRST_YEAR, LAST_YEAR, type SlotId, type SpareId } from './parts'
import type { DriverId, RaidId, RivalTrouble, Season } from './raids'
import type { StringKey } from './strings'

// ── The calendar ──

/** How big a raid is: it sets the entry fee, the prize money and who turns up. */
export type Tier = 'regional' | 'national' | 'long'

export interface CalendarEvent {
  raid: RaidId
  /** Day of the year the raid starts (1 is the first of January). */
  day: number
  tier: Tier
}

/**
 * The raids each year, in order: six a year (Kelbo, 26 November 2026; it was
 * eight). Two winter raids, three summer ones, then the finale. The first job
 * of a career is the three-stage Cold Start 300 (`winterSprint`), as the plan
 * has it. The Blackfly Classic (`summerSprint`) and the Gravel Pit Derby
 * (`midsummerSprint`) left the career here; the Blackfly Classic is still in
 * free play. Saves from the eight-raid calendar move across in
 * `src/persist/save.ts` (format 3).
 */
export const CALENDAR: readonly CalendarEvent[] = [
  { raid: 'winterSprint', day: 40, tier: 'regional' },
  { raid: 'winterRaid', day: 75, tier: 'regional' },
  { raid: 'summerRaid', day: 158, tier: 'regional' },
  { raid: 'nationalRaid', day: 186, tier: 'national' },
  { raid: 'autumnRaid', day: 244, tier: 'national' },
  { raid: 'longOne', day: 268, tier: 'long' },
]

/** A raid takes one day a stage, plus this many days to get there and back. */
export const TRAVEL_DAYS = 2

// ── Money ──

export const CAREER = {
  firstYear: FIRST_YEAR,
  lastYear: LAST_YEAR,
  /** In the bank on day one: the garage, two people and not much else (was 8,000 before the playtest of 26 November 2026). */
  startMoney: 10000,
  /** The career starts on this day of 1985, a few weeks before the first raid (the Cold Start 300). */
  startDay: 15,
  /** Selling a part back gets this share of its price; so does a truck that has raced a lot (`truckResale`). */
  resale: 0.5,
  /**
   * A truck that hasn't raced yet sells back for this share of what its
   * parts cost, and loses `perRaid` more for every raid it runs, down to
   * `resale` (playtest, 26 November 2026: it used to be worth half the
   * moment you bought it).
   */
  truckResale: { new: 0.9, perRaid: 0.08 },
  /** After a raid, putting a worn part right costs this share of its price for each unit of damage (1 = broken). Was 0.6. */
  repairShare: 0.45,
  /** Most news and results kept in the career's log. */
  logLength: 40,
} as const

/** Money scales by class: a heavy truck's parts, fees and prizes are about 3.5 times a light 4x4's. */
export const CLASS_MONEY: Readonly<Record<ClassId, number>> = { light4x4: 1, heavy: 3.5, sxs: 0.6 }

export interface TierRules {
  /** Entry fee for a light 4x4 (times `CLASS_MONEY`). */
  entryFee: number
  /** Prize money for a light 4x4 by finishing place, first to last paid place (times `CLASS_MONEY`). */
  prizes: readonly number[]
  /** Reputation it takes to enter your own truck. */
  rep: number
  /** A driver's fee is their `fee` times this. */
  driverFee: number
  /** Reputation for finishing, a podium and a win (own entry); contracts get half. */
  repFor: { finish: number; podium: number; win: number }
  /**
   * A big field pays deeper: with `from` trucks or more in your class
   * (counting yours), the places after `prizes` pay these too (light 4x4
   * money, times `CLASS_MONEY`).
   */
  bigField?: { from: number; more: readonly number[] }
}

/**
 * Playtest, 26 November 2026: your own truck lost money even on the podium
 * (a regional third paid 2,000 against 2,700 or more in fees, before the
 * repairs). Now the fees are lower and the prizes bigger, so a podium in a
 * stock truck about pays its way and a win pays well; finishing off the
 * podium still costs money. Before: regional fee 1,500, prizes 6,000 /
 * 3,500 / 2,000, drivers ×1; national 4,000, 15,000 / 9,000 / 5,000 /
 * 2,500, ×1.6; the finale 9,000, 40,000 / 22,000 / 12,000 / 6,000 / 3,000,
 * ×3. How it was checked: `docs/BALANCE.md`.
 *
 * Big fields (Kelbo picked it, 28 November 2026): late in a career the light
 * 4x4 earned about a third of the other classes for what its parts cost,
 * because its fields have eight trucks against five to seven, so mid-field
 * paid nothing at the national raids and the finale. Like a real rally,
 * whose purse grows with the entries, a field of eight or more now pays
 * every place down to eighth there (`bigField`). It touches only the light
 * 4x4, and only from about 2000, when its field reaches eight.
 */
export const TIERS: Readonly<Record<Tier, TierRules>> = {
  regional: { entryFee: 1000, prizes: [10000, 7000, 5000], rep: 0, driverFee: 0.6,
    repFor: { finish: 1, podium: 3, win: 5 } },
  national: { entryFee: 3000, prizes: [20000, 13000, 8500, 4500], rep: 15, driverFee: 1,
    repFor: { finish: 2, podium: 4, win: 7 }, bigField: { from: 8, more: [4000, 3000, 2500, 2000] } },
  long: { entryFee: 7000, prizes: [50000, 30000, 18000, 9000, 4500], rep: 60, driverFee: 2,
    repFor: { finish: 3, podium: 8, win: 15 }, bigField: { from: 8, more: [4000, 3500, 3000] } },
}

/** Each hired driver's fee for a regional raid in a light 4x4, and the reputation they want before they'll drive for you. */
export const DRIVER_TERMS: Readonly<Record<DriverId, { fee: number; rep: number }>> = {
  mechanic: { fee: 1200, rep: 0 },
  veteran: { fee: 2000, rep: 0 },
  charger: { fee: 2400, rep: 8 },
  gravelAce: { fee: 3200, rep: 20 },
}

/**
 * Spares used on a raid are bought again afterwards, at this price each for a
 * light 4x4 (times `CLASS_MONEY`).
 */
export const SPARE_PRICE = { tire: 300, shock: 500, cv: 400 } as const

// ── Sponsors and the works deal ──

export interface Sponsor {
  /** Reputation that brings them in. */
  rep: number
  /** Pays this for each raid you enter yourself (times `CLASS_MONEY`). */
  pay: number
  /** Parts cost this much less (0.25 = a quarter off): only the works deal does this. */
  discount: number
  /**
   * Who it is (Kelbo, 26 November 2026): two for each level, and each career
   * gets one of the pair (`sponsorName` in `src/sim/career.ts`).
   */
  names: readonly StringKey[]
}

/** The best one you qualify for is the one you have (they don't stack). */
export const SPONSORS: readonly Sponsor[] = [
  { rep: 10, pay: 1500, discount: 0, names: ['sponsor.twoPines', 'sponsor.loonlight'] },
  { rep: 35, pay: 4000, discount: 0, names: ['sponsor.muskegTire', 'sponsor.hoarfrost'] },
  { rep: 120, pay: 8000, discount: 0.25, names: ['sponsor.boreal', 'sponsor.ptarmigan'] },
]

// ── The shop ──

export type UpgradeId =
  | 'secondMechanic' | 'thirdMechanic' | 'press' | 'welder'
  | 'partsTruck' | 'dyno' | 'springRig' | 'nightShift' | 'machineShop'

export interface Upgrade {
  id: UpgradeId
  cost: number
  /** Reputation it takes before it's offered. */
  rep: number
  /** Mechanic hours added at each bivouac. */
  hours: number
  /** Taken off `CAREER.repairShare` after a raid. */
  repair: number
  /** Extra spares carried on every raid you enter yourself, on top of what the truck's spares part carries. */
  spares?: Readonly<Record<SpareId, number>>
  /** Shock oil tires this many times as fast over a raid (below 1 is slower; see `src/data/condition.ts`). */
  oilWear?: number
  /** Springs sag this many times as fast over a raid. */
  springSag?: number
  /** Needs this one first. */
  needs: UpgradeId | null
  name: StringKey
  text: StringKey
}

/**
 * The shop grows (plan): crew for more hours at the bivouac, tools for
 * cheaper repairs. Still one garage.
 *
 * The last five (Kelbo asked, 26 November 2026) are for late in a career,
 * when the garage has money and nothing to spend it on: a career bot in a
 * light 4x4 banks about 294,000 after eight seasons, against 54,000 for the
 * first four. They need a reputation of 50 to 160 (a steady garage gains
 * about 25 a season, so they come in from the third season to about the
 * seventh) and cost 35,000 to 60,000 each (235,000 together), and they
 * help on a raid rather than at the bank:
 * more spares, more hours, oil and springs that last longer. Only your own
 * truck gets them; a privateer's contract raid brings its own crew.
 */
export const UPGRADES: readonly Upgrade[] = [
  { id: 'secondMechanic', cost: 9000, rep: 5, hours: 2, repair: 0, needs: null, name: 'upgrade.secondMechanic', text: 'upgrade.secondMechanicText' },
  { id: 'press', cost: 7000, rep: 10, hours: 0, repair: 0.15, needs: null, name: 'upgrade.press', text: 'upgrade.pressText' },
  { id: 'thirdMechanic', cost: 22000, rep: 30, hours: 2, repair: 0, needs: 'secondMechanic', name: 'upgrade.thirdMechanic', text: 'upgrade.thirdMechanicText' },
  { id: 'welder', cost: 16000, rep: 40, hours: 0, repair: 0.15, needs: 'press', name: 'upgrade.welder', text: 'upgrade.welderText' },
  { id: 'partsTruck', cost: 35000, rep: 50, hours: 0, repair: 0, spares: { tire: 2, shock: 1, cv: 1 }, needs: null, name: 'upgrade.partsTruck', text: 'upgrade.partsTruckText' },
  { id: 'dyno', cost: 45000, rep: 70, hours: 0, repair: 0, oilWear: 0.65, needs: null, name: 'upgrade.dyno', text: 'upgrade.dynoText' },
  { id: 'springRig', cost: 40000, rep: 100, hours: 0, repair: 0, springSag: 0.6, needs: null, name: 'upgrade.springRig', text: 'upgrade.springRigText' },
  { id: 'nightShift', cost: 60000, rep: 130, hours: 3, repair: 0, needs: 'thirdMechanic', name: 'upgrade.nightShift', text: 'upgrade.nightShiftText' },
  { id: 'machineShop', cost: 55000, rep: 160, hours: 0, repair: 0.07, needs: 'welder', name: 'upgrade.machineShop', text: 'upgrade.machineShopText' },
]

// ── Prep contracts ──

export const CONTRACTS = {
  /** Offers at each raid. The first is always open to anyone, so a broke garage can get going again. */
  perEvent: 3,
  /** The privateer's budget, as a share of the class's test budget (`KITS`): the least and the most. */
  budget: [0.62, 0.95] as const,
  /**
   * Your fee, paid when you hand the truck over, as a share of their budget.
   * Was 0.11, with bonuses of 0.3, 0.8 and 1.5: an untouched stock truck
   * paid more than your own truck's podium (playtest, 26 November 2026).
   */
  fee: 0.08,
  /** Paid on top by result, as shares of the fee: finished without a tow, on the class podium, won the class. */
  bonus: { finish: 0.25, podium: 0.6, win: 1 },
  /** Money rounds to this. */
  round: 250,
  /** Reputation it takes before each class's privateers come to you. */
  classRep: { light4x4: 0, sxs: 0, heavy: 12 } as Readonly<Record<ClassId, number>>,
  /** A bigger raid pays more: fee and budget times this. */
  tierScale: { regional: 1, national: 1.3, long: 1.7 } as Readonly<Record<Tier, number>>,
  /**
   * The career's very first job, which the first-job guide walks through
   * (plan PR 11b): always a privateer's old light 4x4, as the plan has it,
   * with a budget that leaves room for studded tires on the winter raid.
   */
  firstJob: { cls: 'light4x4' as ClassId, budget: 0.85 },
  /**
   * The most of the privateer's own changes (`QUIRKS`) their truck comes
   * with: as many as hurt it in the raid's season, up to this. The first job
   * comes as the factory set it.
   */
  quirks: 2,
} as const

// ── The privateer's own changes ──

/**
 * Playtest, 26 November 2026: a stock contract truck handed over untouched
 * finished second and third for the full pay. Now each privateer brings
 * their truck as they last ran it, with a setting or two of their own that
 * hurts it (measured with `scripts/harness/quirks.harness.ts`: each one
 * makes the stock truck slower, with more stops, on summer or winter
 * stages). The card says what they changed; putting it right is the job.
 */
export type QuirkId = 'softTires' | 'hardTires' | 'shortStops' | 'softSprings'

export interface Quirk {
  id: QuirkId
  /**
   * The classes it hurts in each season, from the sweep: soft tires cut and
   * bottom on summer rock and slide in winter; hard tires and short bump
   * stops only hurt on summer ground; soft springs don't hurt a
   * side-by-side, which is soft anyway.
   */
  hurts: Readonly<Record<Season, readonly ClassId[]>>
  /** Tire pressure: this share of the way from the factory's to the lowest (minus) or the highest (plus). */
  pressure?: number
  /** Bump stops at their shortest. */
  shortStops?: boolean
  /** Springs at their softest, with no preload. */
  softSprings?: boolean
  text: StringKey
}

export const QUIRKS: Readonly<Record<QuirkId, Quirk>> = {
  softTires: { id: 'softTires', hurts: { summer: ['light4x4', 'sxs'], winter: ['light4x4', 'sxs'] }, pressure: -0.8, text: 'quirk.softTires' },
  hardTires: { id: 'hardTires', hurts: { summer: ['light4x4', 'heavy', 'sxs'], winter: [] }, pressure: 0.8, text: 'quirk.hardTires' },
  shortStops: { id: 'shortStops', hurts: { summer: ['light4x4', 'heavy', 'sxs'], winter: [] }, shortStops: true, text: 'quirk.shortStops' },
  softSprings: { id: 'softSprings', hurts: { summer: ['light4x4', 'heavy'], winter: ['light4x4', 'heavy'] }, softSprings: true, text: 'quirk.softSprings' },
}
export const QUIRK_IDS = Object.keys(QUIRKS) as QuirkId[]

// ── Rival teams ──

export type TeamId = 'brannigan' | 'highbank' | 'hardpan' | 'jackrabbit'
export const TEAM_IDS: readonly TeamId[] = ['brannigan', 'highbank', 'hardpan', 'jackrabbit']

/** How a team spends its money when it buys parts for a new year. */
export type BuyHabit = 'newest' | 'strong' | 'light' | 'power'

export interface TeamSpec {
  id: TeamId
  name: StringKey
  habit: StringKey
  /** The classes they race, from which year, and their race number there. */
  classes: readonly { cls: ClassId; from: number; number: number }[]
  /** The tiers they enter. */
  tiers: readonly Tier[]
  /** Their driver's pace before the truck counts (share of par). */
  pace: number
  /** How hard they drive: more trouble, as a multiplier on the chance of it. */
  hardness: number
  buy: BuyHabit
  /** The slots they spend on first. */
  priority: readonly SlotId[]
  /** Budget as a share of the class's test budget (`KITS`), in their first year. */
  budget: number
  /** Chance, slot by slot, that they copy the class winner's part after a raid. */
  copy: number
  trouble: readonly RivalTrouble[]
}

export const TEAMS: Readonly<Record<TeamId, TeamSpec>> = {
  brannigan: {
    id: 'brannigan', name: 'team.brannigan', habit: 'habit.brannigan',
    classes: [{ cls: 'light4x4', from: 1985, number: 7 }, { cls: 'sxs', from: 2010, number: 307 }],
    tiers: ['regional', 'national', 'long'],
    pace: 0.95, hardness: 1.5, buy: 'power',
    priority: ['engine', 'dampers', 'tires', 'frontSusp', 'rearSusp', 'wheels'],
    budget: 0.85, copy: 0.5, trouble: ['axle', 'tire', 'bottoming'],
  },
  highbank: {
    id: 'highbank', name: 'team.highbank', habit: 'habit.highbank',
    classes: [{ cls: 'light4x4', from: 1990, number: 11 }, { cls: 'heavy', from: 1994, number: 505 }, { cls: 'sxs', from: 2008, number: 305 }],
    tiers: ['regional', 'national', 'long'],
    pace: 0.96, hardness: 1.1, buy: 'newest',
    priority: ['dampers', 'frontSusp', 'rearSusp', 'frame', 'bumpStops', 'axles', 'engine', 'wheels'],
    budget: 1.1, copy: 0.25, trouble: ['fade', 'mount', 'lost'],
  },
  hardpan: {
    id: 'hardpan', name: 'team.hardpan', habit: 'habit.hardpan',
    classes: [{ cls: 'heavy', from: 1985, number: 501 }, { cls: 'light4x4', from: 2000, number: 21 }],
    tiers: ['regional', 'national', 'long'],
    pace: 0.94, hardness: 0.6, buy: 'strong',
    priority: ['frame', 'axles', 'tires', 'protection', 'bumpStops', 'spares', 'dampers'],
    budget: 0.95, copy: 0.2, trouble: ['tire', 'stuck'],
  },
  jackrabbit: {
    id: 'jackrabbit', name: 'team.jackrabbit', habit: 'habit.jackrabbit',
    classes: [{ cls: 'sxs', from: 2005, number: 301 }, { cls: 'light4x4', from: 1996, number: 33 }],
    tiers: ['regional', 'national', 'long'],
    pace: 0.935, hardness: 1.3, buy: 'light',
    priority: ['frame', 'wheels', 'frontSusp', 'rearSusp', 'dampers', 'engine'],
    budget: 0.8, copy: 0.4, trouble: ['fade', 'fade', 'bottoming'],
  },
}

export const TEAM_TUNING = {
  /** Every team's budget grows by this share of its first year's each year, so newer, dearer parts come within reach. */
  budgetGrowth: 0.04,
  /**
   * How a truck's parts change a rival's pace and trouble (see `teams.ts`).
   * Pace: share of par taken off for each rating: times the log of the heat
   * and power ratings (so doubling counts the same at any level), times the
   * travel over 1.
   */
  paceFromHeat: 0.02,
  paceFromTravel: 0.04,
  paceFromPower: 0.07,
  /** Trouble: chance times (strength rating) to the power of minus this, and (heat rating) too. */
  riskFromStrength: 1.5,
  riskFromHeat: 0.8,
  /** A rival's pace and chance of trouble stay inside these. */
  paceLimits: [0.85, 1.15] as const,
  riskLimits: [0.03, 0.8] as const,
  /** Base chance of trouble on an average 100 km stage, before hardness and the truck. */
  risk: 0.12,
  /** Each team's clean runs wander this much either way. */
  spread: 0.025,
  /** Hours lost to trouble: the least and the most. */
  delay: [0.2, 1] as const,
} as const

/** Privateers in every raid, three per class, on stock trucks: known by race number. */
export const PRIVATEERS: readonly { cls: ClassId; number: number; pace: number; risk: number; trouble: readonly RivalTrouble[] }[] = [
  { cls: 'light4x4', number: 31, pace: 0.99, risk: 0.2, trouble: ['tire', 'stuck', 'fade'] },
  { cls: 'light4x4', number: 47, pace: 1.03, risk: 0.25, trouble: ['tire', 'axle', 'lost'] },
  { cls: 'light4x4', number: 58, pace: 1.07, risk: 0.3, trouble: ['fade', 'bottoming', 'stuck'] },
  // Heavy privateers are a little quicker: their trucks rarely break.
  { cls: 'heavy', number: 512, pace: 0.96, risk: 0.2, trouble: ['tire', 'axle', 'stuck'] },
  { cls: 'heavy', number: 518, pace: 1, risk: 0.25, trouble: ['tire', 'stuck', 'lost'] },
  { cls: 'heavy', number: 527, pace: 1.04, risk: 0.3, trouble: ['axle', 'stuck', 'mount'] },
  { cls: 'sxs', number: 318, pace: 0.99, risk: 0.2, trouble: ['tire', 'stuck', 'axle'] },
  { cls: 'sxs', number: 322, pace: 1.03, risk: 0.25, trouble: ['tire', 'fade', 'lost'] },
  { cls: 'sxs', number: 326, pace: 1.07, risk: 0.3, trouble: ['fade', 'tire', 'bottoming'] },
]

// ── The hall of fame (end of the career) ──

export const HALL = {
  /** How many seasons the recap lists as the best. */
  bestSeasons: 3,
  /** Most photos kept in a career's album. */
  albumMax: 24,
  /** An album photo's longer side (pixels): big enough for a phone screen, small enough to keep two dozen. */
  albumSize: 1280,
  /** JPEG quality for album photos (0 to 1). */
  albumQuality: 0.85,
} as const
