// Typed errors for the simulation core: bad input never produces silent garbage.

export type ParamErrorCode =
  | 'not_a_number'
  | 'out_of_range'
  | 'not_integer'
  | 'too_stiff'
  | 'unsupported_for_model'
  | 'bad_interval';

/** Thrown (or collected) when a user-supplied value is unusable. */
export class ParamError extends Error {
  readonly field: string;
  readonly code: ParamErrorCode;
  constructor(field: string, code: ParamErrorCode, message: string) {
    super(message);
    this.name = 'ParamError';
    this.field = field;
    this.code = code;
  }
}

/** Thrown when the numerical integration itself goes wrong (NaN, large negative values, event cap). */
export class NumericalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NumericalError';
  }
}
