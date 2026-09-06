/** Safe, static operational guidance; never construct this with database/input values. */
export class SetupError extends Error {
  constructor(message: string) { super(message); this.name = "SetupError"; }
}
