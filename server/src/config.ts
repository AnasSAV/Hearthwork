/** Server configuration from environment variables (server/.env in development). */
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}. Copy server/.env.example to server/.env and fill it in.`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 2567),
  get supabaseUrl(): string {
    return required('SUPABASE_URL');
  },
  /** Service-role / secret key. Server only, never sent to clients, never committed. */
  get supabaseServiceKey(): string {
    return required('SUPABASE_SERVICE_ROLE_KEY');
  },
};
