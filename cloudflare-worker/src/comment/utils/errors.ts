export class ApiError extends Error {
  constructor(
    public code: number,
    message: string,
    public status: number
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
