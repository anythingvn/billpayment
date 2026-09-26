/** The server could not be reached (or the browser is offline): nothing was saved. */
export class OfflineError extends Error {
  constructor() { super("Can't reach the server — your change wasn't saved"); this.name = 'OfflineError'; }
}
/** The session ended; the user must sign in again. */
export class SignInError extends Error {
  constructor() { super('Please sign in again'); this.name = 'SignInError'; }
}
/** Someone else saved the record first. */
export class ConflictError extends Error {
  constructor() { super('Someone else changed this — reload to see their changes'); this.name = 'ConflictError'; }
}
/** The server refused the data (the same rules the screens check). */
export class InvalidError extends Error {
  constructor(readonly messages: string[]) { super(messages.join('\n')); this.name = 'InvalidError'; }
}
/** Not allowed (e.g. an Admin-only action). */
export class ForbiddenError extends Error {
  constructor() { super('You are not allowed to do this'); this.name = 'ForbiddenError'; }
}
export class ServerError extends Error {
  constructor() { super('Something went wrong on the server'); this.name = 'ServerError'; }
}
