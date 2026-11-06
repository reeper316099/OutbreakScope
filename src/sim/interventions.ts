// Piecewise-constant intervention schedule. Overlap rules:
//   * contact reductions combine multiplicatively: c(t) = product of (1 - strength_i) over active events;
//   * vaccination campaigns add: nu(t) = sum of active rates.
// An event is active on the half-open interval [startDay, endDay).
import type { Intervention, ModelKind, ScheduleSegment } from '../shared/types';
import { ParamError } from './errors';
import { MAX_RATE_PER_DAY } from './params';

/** Returns every problem with an intervention list for the given model (empty = valid). */
export function validateInterventions(
  list: readonly Intervention[],
  model: ModelKind,
  horizonDays: number,
): ParamError[] {
  const issues: ParamError[] = [];
  list.forEach((iv, i) => {
    const field = `interventions[${i}]`;
    if (
      ![iv.startDay, iv.endDay, iv.strength].every(
        (x) => typeof x === 'number' && Number.isFinite(x),
      )
    ) {
      issues.push(
        new ParamError(
          field,
          'not_a_number',
          'Start day, end day and strength must be finite numbers.',
        ),
      );
      return;
    }
    if (iv.startDay < 0)
      issues.push(new ParamError(field, 'bad_interval', 'Start day cannot be negative.'));
    if (iv.endDay <= iv.startDay)
      issues.push(new ParamError(field, 'bad_interval', 'End day must be after start day.'));
    if (iv.startDay >= horizonDays)
      issues.push(new ParamError(field, 'bad_interval', 'Event starts after the simulation ends.'));
    if (iv.strength < 0 || iv.strength > 1)
      issues.push(new ParamError(field, 'out_of_range', 'Strength must be between 0 and 1.'));
    if (iv.type === 'vaccination' && model !== 'SEIRV') {
      issues.push(
        new ParamError(
          field,
          'unsupported_for_model',
          'Vaccination needs the SEIR + vaccination model.',
        ),
      );
    }
  });
  // The summed vaccination rate must also respect the stiffness limit.
  const segments = issues.length === 0 ? buildSchedule(list, horizonDays) : [];
  if (segments.some((s) => s.vaccinationRatePerDay > MAX_RATE_PER_DAY)) {
    issues.push(
      new ParamError(
        'interventions',
        'too_stiff',
        'Overlapping vaccination campaigns add up to too high a daily rate.',
      ),
    );
  }
  return issues;
}

/** Splits [0, horizon] at every event start/end and returns segments with constant c and nu. */
export function buildSchedule(
  list: readonly Intervention[],
  horizonDays: number,
): ScheduleSegment[] {
  const cuts = new Set<number>([0, horizonDays]);
  for (const iv of list) {
    if (iv.startDay > 0 && iv.startDay < horizonDays) cuts.add(iv.startDay);
    if (iv.endDay > 0 && iv.endDay < horizonDays) cuts.add(iv.endDay);
  }
  const points = [...cuts].sort((a, b) => a - b);
  const segments: ScheduleSegment[] = [];
  for (let k = 0; k + 1 < points.length; k++) {
    const a = points[k] as number; // index is in range by loop bound
    const b = points[k + 1] as number;
    let contactMultiplier = 1;
    let vaccinationRatePerDay = 0;
    for (const iv of list) {
      if (iv.startDay <= a && a < iv.endDay) {
        if (iv.type === 'contact_reduction') contactMultiplier *= 1 - iv.strength;
        else vaccinationRatePerDay += iv.strength;
      }
    }
    segments.push({ startDay: a, endDay: b, contactMultiplier, vaccinationRatePerDay });
  }
  return segments;
}

/** Looks up the segment active at time t (right-continuous; t = horizon maps to the last segment). */
export function segmentAt(segments: readonly ScheduleSegment[], t: number): ScheduleSegment {
  for (const s of segments) if (t >= s.startDay && t < s.endDay) return s;
  const last = segments[segments.length - 1];
  if (last === undefined) throw new ParamError('schedule', 'bad_interval', 'Empty schedule.');
  return last;
}
