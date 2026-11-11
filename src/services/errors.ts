export type ServiceErrorCode = 'unauthorized' | 'forbidden' | 'validation' | 'not_found' | 'conflict' | 'unavailable';

/** Erro previsto da camada de serviços. A mensagem já é apresentável ao usuário. */
export class ServiceError extends Error {
  readonly code: ServiceErrorCode;
  readonly fieldErrors?: Record<string, string>;

  constructor(code: ServiceErrorCode, message: string, fieldErrors?: Record<string, string>) {
    super(message);
    this.name = 'ServiceError';
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof ServiceError) return err.message;
  return 'Ocorreu um erro inesperado. Tente novamente.';
}
