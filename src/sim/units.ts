/** Unit changes for display and for setting up runs. The sim itself works in SI only. */
import { SIM } from '../data/ride'

export function toCelsius(kelvin: number): number {
  return kelvin - SIM.zeroCelsius
}

export function fromCelsius(celsius: number): number {
  return celsius + SIM.zeroCelsius
}

export function kmhToMs(kmh: number): number {
  return kmh / 3.6
}

export function msToKmh(ms: number): number {
  return ms * 3.6
}
