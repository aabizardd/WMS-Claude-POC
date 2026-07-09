/**
 * Resolve the JWT signing secret from the environment.
 *
 * Fails fast (throws at startup) when the secret is missing or still the
 * insecure development placeholder, so the app never runs in production with a
 * publicly-known secret that would let anyone forge admin tokens.
 */
export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.trim().length === 0 || secret === 'dev-secret') {
    throw new Error(
      'JWT_SECRET is not set (or is still the insecure default). ' +
        'Set a strong, unique JWT_SECRET environment variable before starting the server.',
    );
  }
  return secret;
}
