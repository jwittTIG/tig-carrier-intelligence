/** Service-layer errors. API routes map them to HTTP status codes (src/server/http.ts). */
export class AppError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
    this.name = new.target.name;
  }
}
export class UnauthorizedError extends AppError {
  constructor(message = "Sign in required.") { super(message, 401, "unauthorized"); }
}
export class ForbiddenError extends AppError {
  constructor(message = "You don't have permission to do that.") { super(message, 403, "forbidden"); }
}
export class NotFoundError extends AppError {
  constructor(message = "Not found.") { super(message, 404, "not_found"); }
}
export class ValidationError extends AppError {
  constructor(message: string, readonly issues?: { path: string; message: string }[]) { super(message, 400, "validation_error"); }
}
export class ConflictError extends AppError {
  constructor(message: string) { super(message, 409, "conflict"); }
}
