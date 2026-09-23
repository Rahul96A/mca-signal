export class AppError extends Error {
  constructor(public code: string, message: string, public status: number) {
    super(message);
    this.name = "AppError";
  }
}
export class NotFoundError extends AppError {
  constructor(message = "Not found") {
    super("not_found", message, 404);
  }
}
export class ValidationError extends AppError {
  constructor(message: string) {
    super("invalid_request", message, 400);
  }
}
export class UnauthorizedError extends AppError {
  constructor(message = "Authentication required") {
    super("unauthorized", message, 401);
  }
}
export class UpstreamUnavailableError extends AppError {
  constructor(message = "Upstream data provider unavailable") {
    super("upstream_unavailable", message, 502);
  }
}
